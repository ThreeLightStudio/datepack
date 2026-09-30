import { describe, expect, it } from 'vitest';
import { createEvent } from '../src/create';
import { describePatch, parsePatch } from '../src/patch';
import { validatePlan } from '../src/validate';
import type { DatePlan } from '../src/types';

function plan(): DatePlan {
  return {
    id: 'extended',
    title: 'Rain',
    date: '2026-10-01',
    places: [{ id: 'old', name: 'Old cafe' }],
    events: [
      {
        ...createEvent({ id: 'cafe', title: 'Cafe', order: 0, start: '16:50', end: '17:10' }),
        placeId: 'old',
      },
      createEvent({
        id: 'booking',
        title: 'Booking',
        order: 1,
        start: '18:00',
        end: '19:00',
        protectedFields: ['time', 'place', 'order'],
      }),
    ],
  };
}
function parse(operations: unknown[]) {
  return parsePatch(JSON.stringify({ type: 'datepack.patch', version: 1, operations }));
}
describe('extended patch parser to application', () => {
  it('inserts unscheduled stops before/after without forcing HH:mm and retains duration, place and protection', () => {
    const before = plan();
    const parsed = parse([
      {
        op: 'insertBefore',
        target: 'cafe',
        value: {
          title: 'Read indoors',
          place: 'Public bookstore',
          estimatedDurationMinutes: 20,
          protectedFields: ['content'],
          timing: { kind: 'unscheduled', label: 'After meeting' },
        },
      },
      {
        op: 'insertAfter',
        target: 'cafe',
        value: { title: 'Walk later', estimatedDurationMinutes: 0 },
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = describePatch(before, parsed.patch);
    expect(result.canApply).toBe(true);
    expect(result.plan.events.map((e) => e.title)).toEqual([
      'Read indoors',
      'Cafe',
      'Walk later',
      'Booking',
    ]);
    expect(result.plan.events.map((e) => e.order)).toEqual([0, 1, 2, 3]);
    expect(result.plan.events[0]).toMatchObject({
      timing: { kind: 'unscheduled', label: 'After meeting' },
      estimatedDurationMinutes: 20,
      protectedFields: ['content'],
    });
    expect(result.plan.events[0].start).toBeUndefined();
    expect(result.plan.places?.find((p) => p.id === result.plan.events[0].placeId)?.name).toBe(
      'Public bookstore',
    );
    expect(validatePlan(result.plan).ok).toBe(true);
    expect(before.events).toHaveLength(2);
    expect(before.places).toHaveLength(1);
  });
  it('applies searchable place, window timing and duration in a single replacement', () => {
    const parsed = parse([
      {
        op: 'replace',
        target: 'cafe',
        value: {
          place: 'New cafe',
          estimatedDurationMinutes: 30,
          timing: {
            kind: 'window',
            earliestStart: { dayOffset: 0, time: '16:50' },
            latestStart: { dayOffset: 0, time: '17:10' },
          },
        },
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const before = plan();
    const result = describePatch(before, parsed.patch);
    expect(result.canApply).toBe(true);
    const event = result.plan.events[0];
    expect(event).toMatchObject({ timing: { kind: 'window' }, estimatedDurationMinutes: 30 });
    expect(event.start).toBeUndefined();
    expect(event.end).toBeUndefined();
    expect(result.plan.places?.find((p) => p.id === event.placeId)?.mapQuery).toBe('New cafe');
    expect(result.plan.places?.find((p) => p.id === 'old')?.name).toBe('Old cafe');
    expect(validatePlan(result.plan).ok).toBe(true);
    const change = result.applied[0];
    if (change.op === 'replace')
      expect(change.details.map((d) => d.field)).toEqual(['place', 'duration', 'timing']);
  });
  it('preserves explicit next-day timing while normalizing compatible legacy aliases', () => {
    const timing = {
      kind: 'exact',
      start: { dayOffset: 1, time: '0:10' },
      end: { dayOffset: 1, time: '0:30' },
    };
    const parsed = parse([
      { op: 'replace', target: 'cafe', value: { start: '00:10', end: '00:30', timing } },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = describePatch(plan(), parsed.patch);
    expect(result.plan.events[0]).toMatchObject({
      start: '00:10',
      end: '00:30',
      timing: {
        kind: 'exact',
        start: { dayOffset: 1, time: '00:10' },
        end: { dayOffset: 1, time: '00:30' },
      },
    });
    expect(result.canApply).toBe(true);
    expect(validatePlan(result.plan).ok).toBe(true);
  });
  it('supports first/new window entries, explicit unscheduling and legacy overnight inputs', () => {
    const before = plan();
    before.events = [];
    const parsed = parse([
      {
        op: 'insertFirst',
        value: {
          title: 'Night walk',
          timing: {
            kind: 'window',
            earliestStart: { dayOffset: 0, time: '23:50' },
            latestStart: { dayOffset: 1, time: '0:20' },
          },
          protectedFields: ['order'],
        },
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = describePatch(before, parsed.patch);
    expect(result.plan.events[0].timing).toEqual({
      kind: 'window',
      earliestStart: { dayOffset: 0, time: '23:50' },
      latestStart: { dayOffset: 1, time: '00:20' },
    });
    const unset = parse([
      { op: 'move', target: 'cafe', value: { timing: { kind: 'unscheduled' } } },
    ]);
    if (!unset.ok) throw new Error('Expected unscheduling to parse');
    const unscheduled = describePatch(plan(), unset.patch).plan.events[0];
    expect(unscheduled.timing).toEqual({ kind: 'unscheduled' });
    expect(unscheduled.start).toBeUndefined();
    expect(unscheduled.end).toBeUndefined();
    const legacy = parse([
      { op: 'insertAfter', target: 'cafe', value: { title: 'Night', start: '23:50', end: '0:20' } },
    ]);
    if (!legacy.ok) throw new Error('Expected legacy HH:mm to parse');
    expect(describePatch(plan(), legacy.patch).plan.events[1].timing).toEqual({
      kind: 'exact',
      start: { dayOffset: 0, time: '23:50' },
      end: { dayOffset: 1, time: '00:20' },
    });
  });
  it.each([
    { start: '16:50', timing: { kind: 'unscheduled' } },
    {
      start: '16:50',
      timing: {
        kind: 'window',
        earliestStart: { dayOffset: 0, time: '16:50' },
        latestStart: { dayOffset: 0, time: '17:00' },
      },
    },
    { start: '16:50', timing: { kind: 'exact', start: { dayOffset: 0, time: '17:00' } } },
    { end: '17:20', timing: { kind: 'exact', start: { dayOffset: 0, time: '17:00' } } },
    { timing: { kind: 'exact', start: { dayOffset: 2, time: '17:00' } } },
    { estimatedDurationMinutes: -1 },
    { protectedFields: ['everything'] },
    { place: 'Cafe', placeId: 'old' },
    { place: 123 },
    { coordinate: { lat: 37 } },
  ])(
    'rejects contradictory or unsupported new values rather than silently dropping them',
    (value) => {
      expect(
        parse([{ op: 'insertBefore', target: 'cafe', value: { title: 'New', ...value } }]).ok,
      ).toBe(false);
    },
  );
  it('blocks attempts to change protection settings and atomically rejects protected place/timing edits', () => {
    expect(parse([{ op: 'replace', target: 'cafe', value: { protectedFields: [] } }]).ok).toBe(
      false,
    );
    const before = plan();
    const parsed = parse([
      { op: 'replace', target: 'cafe', value: { note: 'Valid memo' } },
      {
        op: 'replace',
        target: 'booking',
        value: { place: 'Another restaurant', timing: { kind: 'unscheduled' } },
      },
    ]);
    if (!parsed.ok) throw new Error('Expected protected attempt to reach the application guard');
    const result = describePatch(before, parsed.patch);
    expect(result.canApply).toBe(false);
    expect(result.skipped.some((issue) => issue.key === 'err.patch.protected')).toBe(true);
    expect(result.plan).toEqual(before);
    expect(before.places).toHaveLength(1);
  });
});
