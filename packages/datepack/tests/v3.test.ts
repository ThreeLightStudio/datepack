import { describe, expect, it } from 'vitest';
import { createDatePack, createEvent } from '../src/create';
import { migrateLegacyDatePack } from '../src/migration';
import { readDatePack, DatePackReadError } from '../src/read';
import { validateDatePack, validatePlan } from '../src/validate';
import { writeDatePack } from '../src/write';
import { describePatch } from '../src/patch';
import type { LegacyDatePack } from '../src/types';

describe('DatePack v3 model', () => {
  it('allows an undated plan with unscheduled events and a half-day window', () => {
    const pack = createDatePack({ title: 'Afternoon together' });
    pack.plan.availableFrom = { dayOffset: 0, time: '14:00' };
    pack.plan.mustEndBy = { dayOffset: 0, time: '17:00' };
    pack.plan.events.push(
      createEvent({
        id: 'meal',
        order: 0,
        title: 'Late lunch',
        timing: { kind: 'unscheduled', label: 'After meeting' },
      }),
    );
    pack.plan.candidates?.push({ id: 'gallery', title: 'Gallery', excluded: true });
    expect(validateDatePack(pack)).toMatchObject({ ok: true, errors: [] });
    expect(pack.plan.date).toBeUndefined();
    expect(pack.plan.candidates?.[0].excluded).toBe(true);
  });

  it('accepts an event that ends after midnight using dayOffset 1', () => {
    const plan = createDatePack({ title: 'Late evening' }).plan;
    plan.events.push(
      createEvent({
        title: 'Concert',
        timing: {
          kind: 'exact',
          start: { dayOffset: 0, time: '23:00' },
          end: { dayOffset: 1, time: '01:00' },
        },
      }),
    );
    expect(validatePlan(plan)).toMatchObject({ ok: true, errors: [] });
  });

  it('roundtrips v3 timing, plan metadata, experiences, revision, and assets', async () => {
    const pack = createDatePack({ title: 'Night out' });
    pack.plan.events.push(
      createEvent({
        id: 'show',
        order: 0,
        title: 'Show',
        timing: {
          kind: 'exact',
          start: { dayOffset: 0, time: '23:30' },
          end: { dayOffset: 1, time: '00:30' },
        },
      }),
    );
    pack.baselinePlan = structuredClone(pack.plan);
    pack.revision = 4;
    pack.experiences.push({
      id: 'fact-1',
      eventId: 'show',
      title: 'Show',
      outcome: 'completed',
      occurredOn: '2026-09-28',
      timing: { kind: 'approximate', period: 'late evening' },
    });
    pack.assets.push({ id: 'photo-1', filename: 'show.png', mimeType: 'image/png' });
    const sourcePhoto = new Blob(['photo'], { type: 'image/png' });
    const file = await writeDatePack(pack, (id) => (id === 'photo-1' ? sourcePhoto : null));
    const raw = JSON.parse(await file.blob.text()) as {
      version: string;
      baselinePlan: unknown;
      revision: number;
      plan: { events: Array<Record<string, unknown>> };
    };
    expect(raw.version).toBe('3.0');
    expect(raw.baselinePlan).toBeDefined();
    expect(raw.revision).toBe(4);
    expect(raw.plan.events[0]).not.toHaveProperty('start');
    const read = await readDatePack(file.blob);
    expect(read.pack.plan.events[0].timing).toEqual(pack.plan.events[0].timing);
    expect(read.pack.experiences).toEqual(pack.experiences);
    expect(read.pack.revision).toBe(4);
    expect(read.blobs.get('photo-1')?.type).toBe('image/png');
  });

  it('warns when a referenced photo has no asset registry entry', () => {
    const pack = createDatePack({ title: 'Photos' });
    pack.plan.events.push(createEvent({ title: 'Cafe', assetIds: ['photo-missing'] }));
    expect(validateDatePack(pack).warnings).toContainEqual({
      key: 'err.plan.assetMissing',
      params: { id: 'photo-missing' },
    });
  });

  it('keeps field protection granular when adapting the preview/apply API', () => {
    const pack = createDatePack({ title: 'Protected timing' });
    pack.plan.events.push(
      createEvent({
        id: 'fixed-time',
        order: 0,
        title: 'Meet',
        timing: { kind: 'exact', start: { dayOffset: 0, time: '14:00' } },
        protectedFields: ['time'],
      }),
    );
    const titleChange = describePatch(pack.plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'replace', target: 'fixed-time', value: { title: 'Meet at the entrance' } },
      ],
    });
    expect(titleChange.canApply).toBe(true);
    const timeChange = describePatch(pack.plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'fixed-time', value: { start: '15:00' } }],
    });
    expect(timeChange.canApply).toBe(false);
  });

  it('converts legacy runtime facts deterministically and preserves event identity', () => {
    const legacy: LegacyDatePack = {
      manifest: { format: 'datepack', version: '2.0', entry: 'plan.json' },
      plan: {
        id: 'old-plan',
        title: 'Old plan',
        date: '2026-09-28',
        events: [
          {
            id: 'old-event',
            title: 'Cafe',
            type: 'cafe',
            start: '15:00',
            fixed: true,
            travelMinutes: 20,
          },
        ],
      },
      assets: [],
    };
    const runtime = {
      planId: 'old-plan',
      updatedAt: '2026-09-28T15:00:00Z',
      events: { 'old-event': { eventId: 'old-event', status: 'completed' as const } },
    };
    const first = migrateLegacyDatePack(legacy, runtime).pack;
    const second = migrateLegacyDatePack(legacy, runtime).pack;
    expect(first).toEqual(second);
    expect(first.plan.events[0]).toMatchObject({
      id: 'old-event',
      order: 0,
      protectedFields: ['time', 'place', 'content', 'delete', 'order'],
    });
    expect(first.experiences[0].id).toBe('experience-legacy-old-plan-old-event');
    expect(first.experiences[0].source?.format).toBe('2.0');
    expect(first.plan.sharedTravel?.[0]).toMatchObject({ source: 'legacy', estimatedMinutes: 20 });
  });

  it('returns unsupported future file bytes unchanged for safe preservation', async () => {
    const bytes = '{ "format": "datepack", "version": "9.0", "private": "keep" }';
    const original = new Blob([bytes]);
    const error = await readDatePack(original).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DatePackReadError);
    if (error instanceof DatePackReadError) expect(await error.originalFile?.text()).toBe(bytes);
  });
});
