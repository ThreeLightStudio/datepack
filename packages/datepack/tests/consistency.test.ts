import { describe, expect, it } from 'vitest';
import { findIntroducedPlanConflicts, findPlanConflicts } from '../src/consistency';
import { createEvent } from '../src/create';
import { format } from '../src/i18n/core';
import type { DatePlan } from '../src/types';

function planFrom(events: Parameters<typeof createEvent>[0][]): DatePlan {
  return {
    id: 'p1',
    title: '대전 데이트',
    date: '2026-09-28',
    events: events.map((e) => createEvent(e)),
    places: [],
  };
}

describe('findPlanConflicts', () => {
  it('passes a clean schedule', () => {
    const plan = planFrom([
      { title: 'A', start: '10:00', end: '11:00' },
      { title: 'B', start: '11:30', end: '12:30' },
    ]);
    expect(findPlanConflicts(plan)).toEqual([]);
  });

  it('reports time/order inversions without sorting the plan', () => {
    const plan = planFrom([
      { title: 'Chosen first', start: '14:00' },
      { title: 'Chosen second', start: '11:00' },
    ]);
    expect(plan.events.map((event) => event.title)).toEqual(['Chosen first', 'Chosen second']);
    expect(findPlanConflicts(plan)).toContainEqual({
      key: 'warn.conflict.orderTime',
      params: { previous: 'Chosen first', next: 'Chosen second' },
    });
  });

  it('detects overlapping neighbors', () => {
    const plan = planFrom([
      { title: 'A', start: '10:00', end: '11:00' },
      { title: 'B', start: '10:30', end: '12:00' },
    ]);
    const issues = findPlanConflicts(plan);
    expect(issues.map((i) => i.key)).toEqual(['warn.conflict.overlap']);
    expect(issues[0].params).toMatchObject({ prev: 'A', next: 'B' });
  });

  it('detects a travel time that does not fit the gap', () => {
    const plan = planFrom([
      { title: 'A', start: '10:00', end: '11:00' },
      { title: 'B', start: '11:10', end: '12:00', travelMinutes: 30 },
    ]);
    const issues = findPlanConflicts(plan);
    expect(issues.map((i) => i.key)).toEqual(['warn.conflict.travel']);
    expect(issues[0].params).toMatchObject({ next: 'B', minutes: 30 });
  });

  it('lets a travel time that fits the gap pass', () => {
    const plan = planFrom([
      { title: 'A', start: '10:00', end: '11:00' },
      { title: 'B', start: '11:30', end: '12:30', travelMinutes: 30 },
    ]);
    expect(findPlanConflicts(plan)).toEqual([]);
  });

  it('detects an end earlier than its start', () => {
    const plan = planFrom([{ title: 'A', start: '10:00', end: '09:00' }]);
    expect(findPlanConflicts(plan).map((i) => i.key)).toEqual(['warn.conflict.endBeforeStart']);
  });

  it('renders per locale', () => {
    expect(
      format('ko', { key: 'warn.conflict.overlap', params: { prev: '성심당', next: '카페' } }),
    ).toBe('"성심당"과(와) "카페" 일정이 겹쳐요.');
    expect(format('en', { key: 'warn.conflict.overlap', params: { prev: 'A', next: 'B' } })).toBe(
      '"A" and "B" overlap.',
    );
  });

  it('returns conflicts introduced beyond those already in the baseline', () => {
    const baseline = planFrom([
      { title: 'A', start: '10:00', end: '11:00' },
      { title: 'B', start: '10:30', end: '12:00' },
    ]);
    const proposed = planFrom([
      { title: 'A', start: '10:00', end: '11:00' },
      { title: 'B', start: '10:30', end: '12:00' },
      { title: 'C', start: '11:30', end: '12:30' },
    ]);
    expect(findIntroducedPlanConflicts(baseline, proposed)).toEqual([
      { key: 'warn.conflict.overlap', params: { prev: 'B', next: 'C' } },
    ]);
  });
});
