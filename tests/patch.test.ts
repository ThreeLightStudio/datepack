import { describe, expect, it } from 'vitest';
import { applyPatch, describePatch, parsePatch, type PatchChange } from '../src/datepack/patch';
import { createEvent } from '../src/datepack/create';
import { validatePatch } from '../src/datepack/validate';
import { format } from '../src/i18n/core';
import type { DatePlan } from '../src/datepack/types';

function makePlan(): DatePlan {
  return {
    id: 'p1',
    title: '대전 데이트',
    date: '2026-09-28',
    events: [
      createEvent({ id: 'event-station', title: '대전역 도착', start: '09:34', type: 'transport' }),
      createEvent({
        id: 'event-sungsimdang',
        title: '성심당 본점',
        start: '15:30',
        end: '16:30',
        type: 'place',
      }),
      createEvent({ id: 'event-walk', title: '야외 산책', start: '17:00', type: 'activity' }),
    ],
    places: [],
  };
}

describe('patch validation', () => {
  it('parses a valid patch', () => {
    const parsed = parsePatch(
      JSON.stringify({
        type: 'datepack.patch',
        version: 1,
        operations: [{ op: 'move', target: 'event:sungsimdang', value: { start: '16:10' } }],
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it('rejects wrong type/version and bad ops', () => {
    expect(parsePatch('not json').ok).toBe(false);
    expect(parsePatch('{}').ok).toBe(false);
    const bad = validatePatch({ type: 'datepack.patch', version: 2, operations: [] });
    expect(bad.ok).toBe(false);
    const unknownOp = validatePatch({
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'destroy', target: 'x' }],
    });
    expect(unknownOp.ok).toBe(false);
  });

  it('emits keyed errors (localizable) for bad times and missing titles', () => {
    const result = validatePatch({
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'move', target: 'event:a', value: { start: '30:00' } },
        { op: 'insertAfter', target: 'event:a', value: { title: '', start: '10:00' } },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const keys = result.errors.map((e) => e.key);
      expect(keys).toContain('err.patch.badTime');
      expect(keys).toContain('err.patch.needTitle');
      // and they render per locale
      expect(
        format('ko', { key: 'err.patch.badTime', params: { index: 0, field: 'start' } }),
      ).toContain('HH:mm');
      expect(
        format('en', { key: 'err.patch.badTime', params: { index: 0, field: 'start' } }),
      ).toContain('HH:mm');
    }
  });
});

describe('patch apply', () => {
  it('applies the exact spec example (target "event:sungsimdang-2")', () => {
    const plan = makePlan();
    plan.events[1].id = 'sungsimdang-2'; // id as in the spec example
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:sungsimdang-2', value: { start: '16:10' } }],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.plan.events[1].start).toBe('16:10');
  });

  it('reports unknown targets as keyed errors', () => {
    const plan = makePlan();
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:does-not-exist', value: { start: '16:10' } }],
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatchObject({ key: 'err.patch.unknownTarget' });
    expect(result.applied).toHaveLength(0);
  });

  it('moves with event: prefix and reports the change as data', () => {
    const plan = makePlan();
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'move', target: 'event:event-sungsimdang', value: { start: '16:10', end: '17:10' } },
      ],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.plan.events[1].start).toBe('16:10');
    expect(result.plan.events[1].end).toBe('17:10');
    const change = result.applied[0] as Extract<PatchChange, { op: 'move' }>;
    expect(change.title).toBe('성심당 본점');
    expect(change.from).toBe('15:30');
    expect(change.to).toBe('16:10');
    // ...and renders per locale
    expect(
      format('ko', 'change.move', {
        title: change.title,
        from: change.from ?? '',
        to: change.to ?? '',
      }),
    ).toBe('"성심당 본점" 시간을 15:30 → 16:10으로 이동');
    expect(
      format('en', 'change.move', {
        title: change.title,
        from: change.from ?? '',
        to: change.to ?? '',
      }),
    ).toBe('"성심당 본점" moved 15:30 → 16:10');
  });

  it('replaces fields without touching the rest', () => {
    const plan = makePlan();
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        {
          op: 'replace',
          target: 'event:event-walk',
          value: { title: '실내 카페', type: 'cafe', note: '비 오니까 실내로' },
        },
      ],
    });
    expect(result.errors).toHaveLength(0);
    const walk = result.plan.events[2];
    expect(walk.title).toBe('실내 카페');
    expect(walk.type).toBe('cafe');
    expect(walk.note).toBe('비 오니까 실내로');
    expect(walk.start).toBe('17:00'); // untouched
    const change = result.applied[0] as Extract<PatchChange, { op: 'replace' }>;
    expect(change.details.map((d) => d.field)).toEqual(['title', 'type', 'note']);
  });

  it('inserts before and after a target', () => {
    const plan = makePlan();
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        {
          op: 'insertBefore',
          target: 'event:event-sungsimdang',
          value: { title: '커피 대신 실내 카페', start: '15:00', type: 'cafe' },
        },
        {
          op: 'insertAfter',
          target: 'event:event-walk',
          value: { title: '아이스크림', start: '17:40' },
        },
      ],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.plan.events).toHaveLength(5);
    expect(result.plan.events[1].title).toBe('커피 대신 실내 카페');
    expect(result.plan.events[4].title).toBe('아이스크림');
  });

  it('removes an event', () => {
    const plan = makePlan();
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'remove', target: 'event:event-walk' }],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.plan.events).toHaveLength(2);
    expect(result.plan.events.find((e) => e.id === 'event-walk')).toBeUndefined();
    expect(result.applied[0]).toMatchObject({ op: 'remove', title: '야외 산책' });
  });

  it('does not mutate the original plan', () => {
    const plan = makePlan();
    const snapshot = JSON.stringify(plan);
    applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:event-sungsimdang', value: { start: '16:10' } }],
    });
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it('describe() previews without mutating and reports unknown targets', () => {
    const plan = makePlan();
    const preview = describePatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'move', target: 'event:event-sungsimdang', value: { start: '16:10' } },
        { op: 'remove', target: 'event:ghost' },
      ],
    });
    expect(preview.applied).toHaveLength(1);
    expect(preview.errors).toHaveLength(1);
    expect(plan.events[1].start).toBe('15:30');
  });
});

describe('patch target tolerance', () => {
  it('accepts "event:<id>" against ids that already start with "event-"', () => {
    const plan = makePlan(); // ids: event-station, event-sungsimdang, event-walk
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:sungsimdang', value: { start: '16:10' } }],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.plan.events[1].start).toBe('16:10');
  });
});
