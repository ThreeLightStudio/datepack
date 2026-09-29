import { describe, expect, it } from 'vitest';
import { applyPatch, describePatch, parsePatch, type PatchChange } from '../src/patch';
import { createEvent } from '../src/create';
import { validatePatch } from '../src/validate';
import { format } from '../src/i18n/core';
import type { DatePlan } from '../src/types';

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
    expect(result.skipped).toHaveLength(0);
    expect(result.plan.events[1].start).toBe('16:10');
  });

  it('reports unknown targets as skipped ops (the rest still applies)', () => {
    const plan = makePlan();
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:does-not-exist', value: { start: '16:10' } }],
    });
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]).toMatchObject({ key: 'err.patch.unknownTarget' });
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
    expect(result.skipped).toHaveLength(0);
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
    expect(result.skipped).toHaveLength(0);
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
    expect(result.skipped).toHaveLength(0);
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
    expect(result.skipped).toHaveLength(0);
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
    expect(preview.skipped).toHaveLength(1);
    expect(plan.events[1].start).toBe('15:30');
  });

  it('prepares a cloned complete result for sequential operations', () => {
    const plan = makePlan();
    const preview = describePatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'move', target: 'event:event-walk', value: { start: '18:00' } },
        {
          op: 'insertAfter',
          target: 'event:event-walk',
          value: { title: '저녁 식사', start: '18:30', type: 'meal' },
        },
      ],
    });
    const applied = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'move', target: 'event:event-walk', value: { start: '18:00' } },
        {
          op: 'insertAfter',
          target: 'event:event-walk',
          value: { title: '저녁 식사', start: '18:30', type: 'meal' },
        },
      ],
    });
    expect(preview.canApply).toBe(true);
    expect(preview.plan.events.map((event) => event.title)).toContain('저녁 식사');
    expect(preview.plan.events.find((event) => event.id === 'event-walk')?.start).toBe('18:00');
    expect(preview.plan.events.map(({ id: _id, ...event }) => event)).toEqual(
      applied.plan.events.map(({ id: _id, ...event }) => event),
    );
    expect(plan.events.find((event) => event.id === 'event-walk')?.start).toBe('17:00');
  });

  it.each([
    ['move', [{ op: 'move', target: 'event:event-walk', value: { start: '18:00' } }]],
    ['remove', [{ op: 'remove', target: 'event:event-walk' }]],
    ['unlock', [{ op: 'replace', target: 'event:event-walk', value: { fixed: false } }]],
    ['edit', [{ op: 'replace', target: 'event:event-walk', value: { title: '다른 일정' } }]],
  ] as const)('blocks a protected event %s and preserves the full plan', (_name, operations) => {
    const plan = makePlan();
    plan.events[2].fixed = true;
    const snapshot = structuredClone(plan);
    const result = describePatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'replace', target: 'event:event-station', value: { title: '변경된 역' } },
        ...operations,
      ],
    });
    expect(result.canApply).toBe(false);
    expect(result.skipped.some((issue) => issue.key === 'err.patch.protected')).toBe(true);
    expect(result.plan).toEqual(snapshot);
    expect(plan).toEqual(snapshot);
  });

  it('blocks indirect reordering across a protected event', () => {
    const plan = makePlan();
    plan.events[1].fixed = true;
    const result = describePatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:event-walk', value: { start: '14:00' } }],
    });
    expect(result.canApply).toBe(false);
    expect(result.skipped.some((issue) => issue.key === 'err.patch.protectedOrder')).toBe(true);
    expect(result.plan).toEqual(plan);
  });

  it('reports only newly introduced conflicts in the proposed result', () => {
    const plan = makePlan();
    const result = describePatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:event-walk', value: { start: '16:00' } }],
    });
    expect(result.canApply).toBe(true);
    expect(result.newConflicts.some((issue) => issue.key === 'warn.conflict.overlap')).toBe(true);
  });

  it('does not apply valid operations when another operation has no target', () => {
    const plan = makePlan();
    const snapshot = structuredClone(plan);
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'move', target: 'event:event-walk', value: { start: '18:00' } },
        { op: 'remove', target: 'event:missing' },
      ],
    });
    expect(result.canApply).toBe(false);
    expect(result.skipped).toHaveLength(1);
    expect(result.plan).toEqual(snapshot);
    expect(plan).toEqual(snapshot);
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
    expect(result.skipped).toHaveLength(0);
    expect(result.plan.events[1].start).toBe('16:10');
  });
});

describe('patch reply tolerance', () => {
  it('parses a reply wrapped in markdown fences and commentary', () => {
    const patch = {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:event-sungsimdang', value: { start: '16:10' } }],
    };
    const parsed = parsePatch(
      `수정된 일정입니다!\n\`\`\`json\n${JSON.stringify(patch, null, 2)}\n\`\`\`\n좋은 하루 되세요`,
    );
    expect(parsed.ok).toBe(true);
  });

  it('normalizes loose times ("9:30" → "09:30") on move and insert', () => {
    const plan = makePlan();
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'move', target: 'event:event-sungsimdang', value: { start: '9:30', end: '10:45' } },
        {
          op: 'insertAfter',
          target: 'event:event-walk',
          value: { title: '아이스크림', start: '8:05' },
        },
      ],
    });
    expect(result.skipped).toHaveLength(0);
    const moved = result.plan.events.find((e) => e.id === 'event-sungsimdang');
    expect(moved?.start).toBe('09:30');
    expect(moved?.end).toBe('10:45');
    const inserted = result.plan.events.find((e) => e.title === '아이스크림');
    expect(inserted?.start).toBe('08:05');
    const move = result.applied[0] as Extract<PatchChange, { op: 'move' }>;
    expect(move.to).toBe('09:30'); // the preview shows the canonical form too
  });

  it('rejects unmatched targets without applying the rest', () => {
    const plan = makePlan();
    const snapshot = structuredClone(plan);
    const result = applyPatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [
        { op: 'move', target: 'event:event-walk', value: { start: '14:00' } },
        { op: 'move', target: 'event:ghost', value: { start: '12:00' } }, // skipped
        {
          op: 'insertAfter',
          target: 'event:event-walk',
          value: { title: '아이스크림', start: '14:40' },
        },
      ],
    });
    expect(result.canApply).toBe(false);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ key: 'err.patch.unknownTarget' });
    expect(result.plan).toEqual(snapshot);
  });

  it('rejects protected stops in the preview so approval cannot bypass the lock', () => {
    const plan = makePlan();
    plan.events[2].fixed = true; // 야외 산책
    const preview = describePatch(plan, {
      type: 'datepack.patch',
      version: 1,
      operations: [{ op: 'move', target: 'event:event-walk', value: { start: '16:40' } }],
    });
    expect(preview.canApply).toBe(false);
    expect(preview.skipped[0]).toMatchObject({ key: 'err.patch.protected' });
    expect(format('ko', preview.skipped[0])).toContain('보호된 일정');
    expect(format('en', preview.skipped[0])).toContain('protected stop');
  });

  it('rejects an insert whose end is not a valid time', () => {
    const bad = validatePatch({
      type: 'datepack.patch',
      version: 1,
      operations: [
        {
          op: 'insertAfter',
          target: 'event:a',
          value: { title: 'X', start: '10:00', end: '10-11' },
        },
      ],
    });
    expect(bad.ok).toBe(false);
  });
});
