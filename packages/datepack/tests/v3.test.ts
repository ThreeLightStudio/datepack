import { describe, expect, it } from 'vitest';
import { createDatePack, createEvent } from '../src/create';
import { migrateLegacyDatePack } from '../src/migration';
import { readDatePack, DatePackReadError } from '../src/read';
import { validateDatePack, validatePlan } from '../src/validate';
import { DatePackWriteError, writeDatePack } from '../src/write';
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
      recordedAt: '2026-09-28T18:00:00Z',
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

  it('rejects a referenced photo with no asset registry entry', async () => {
    const pack = createDatePack({ title: 'Photos' });
    pack.plan.events.push(createEvent({ id: 'cafe', title: 'Cafe', assetIds: ['photo-missing'] }));
    expect(validateDatePack(pack).errors).toContainEqual({
      key: 'err.plan.brokenReference',
      params: { id: 'photo-missing', field: 'plan.events.cafe.assetIds' },
    });
    await expect(writeDatePack(pack, () => null)).rejects.toBeInstanceOf(DatePackWriteError);
  });

  it('rejects duplicate asset registry IDs', () => {
    const pack = createDatePack({ title: 'Duplicate assets' });
    pack.assets.push(
      { id: 'photo', filename: 'a.png', mimeType: 'image/png' },
      { id: 'photo', filename: 'b.png', mimeType: 'image/png' },
    );
    expect(validateDatePack(pack).errors).toContainEqual({
      key: 'err.plan.dupAssetId',
      params: { id: 'photo' },
    });
  });

  it('rejects missing place and Plan B references', () => {
    const pack = createDatePack({ title: 'References' });
    pack.plan.places = [{ id: 'known-place', name: 'Known' }];
    pack.plan.events.push(
      createEvent({
        id: 'anchor',
        title: 'Anchor',
        placeId: 'missing-event-place',
        planB: { title: 'Backup', replacementEventIds: ['missing-event'] },
      }),
    );
    pack.plan.candidates = [{ id: 'choice', title: 'Choice', placeId: 'missing-candidate-place' }];
    pack.plan.meeting = { placeId: 'missing-meeting-place' };
    pack.plan.sharedTravel = [
      { id: 'trip', fromPlaceId: 'missing-origin', toPlaceId: 'known-place' },
    ];
    const result = validateDatePack(pack);
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.params?.id)).toEqual(
      expect.arrayContaining([
        'missing-event',
        'missing-event-place',
        'missing-candidate-place',
        'missing-meeting-place',
        'missing-origin',
      ]),
    );
  });

  it('rejects malformed recorded time and malformed experience timing', () => {
    const pack = createDatePack({ title: 'Facts' });
    pack.experiences.push({
      id: 'fact-bad',
      title: 'A memory',
      outcome: 'note',
      recordedAt: 'not-a-timestamp',
      timing: { kind: 'exact', at: { dayOffset: 2, time: '25:00' } },
    } as unknown as (typeof pack.experiences)[number]);
    pack.experiences.push({
      id: 'fact-approximate-bad',
      title: 'Another memory',
      outcome: 'note',
      recordedAt: '2026-09-28T18:00:00Z',
      timing: { kind: 'approximate', period: '   ' },
    });
    expect(validateDatePack(pack).ok).toBe(false);
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
        places: [
          { id: 'place-first', name: 'First stop' },
          { id: 'place-next', name: 'Next stop' },
        ],
        events: [
          {
            id: 'old-event',
            title: 'Cafe',
            type: 'cafe',
            start: '15:00',
            placeId: 'place-first',
            fixed: true,
            travelMinutes: 20,
          },
          {
            id: 'next-event',
            title: 'Museum',
            type: 'place',
            start: '16:00',
            placeId: 'place-next',
            travelMinutes: 15,
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
    expect(first.experiences[0].recordedAt).toBe(runtime.updatedAt);
    expect(first.plan.sharedTravel?.[0]).toMatchObject({
      source: 'legacy',
      estimatedMinutes: 20,
      toPlaceId: 'place-first',
    });
    expect(first.plan.sharedTravel?.[0].fromPlaceId).toBeUndefined();
    expect(first.plan.sharedTravel?.[1]).toMatchObject({
      source: 'legacy',
      estimatedMinutes: 15,
      fromPlaceId: 'place-first',
      toPlaceId: 'place-next',
    });
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
