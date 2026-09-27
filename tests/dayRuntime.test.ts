import { describe, expect, it } from 'vitest';
import { computeDayContext, emptyRuntime, getRuntimeEntry } from '../src/features/day/dayRuntime';
import { createEvent } from '../src/datepack/create';
import type { DatePackRuntimeState, DatePlan } from '../src/datepack/types';

const DAY = '2026-09-28';

function makePlan(): DatePlan {
  return {
    id: 'p1',
    title: '대전 데이트',
    date: DAY,
    events: [
      createEvent({
        id: 'e1',
        title: '대전역 도착',
        start: '09:34',
        end: '09:50',
        type: 'transport',
      }),
      createEvent({
        id: 'e2',
        title: '성심당 본점',
        start: '10:00',
        end: '11:20',
        type: 'cafe',
        travelMinutes: 9,
      }),
      createEvent({ id: 'e3', title: '디아로마', start: '12:45', end: '14:50', type: 'cafe' }),
      createEvent({
        id: 'e4',
        title: '성심당 본점 재방문',
        start: '15:30',
        type: 'place',
        travelMinutes: 9,
      }),
      createEvent({
        id: 'e5',
        title: '대전역 출발',
        start: '22:42',
        type: 'transport',
        fixed: true,
      }),
    ],
    places: [],
  };
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 8, 28, hour, minute);
}

describe('computeDayContext — today', () => {
  it('finds NOW and NEXT mid-date (14:42, like the mockup)', () => {
    const ctx = computeDayContext(makePlan(), emptyRuntime('p1'), at(14, 42));
    expect(ctx.isToday).toBe(true);
    expect(ctx.current?.event.id).toBe('e3');
    expect(ctx.next?.event.id).toBe('e4');
    // remaining in current: 14:50 − 14:42 = 8분
    expect(ctx.remainingInCurrent).toBe(8);
    // departure: 15:30 − 9분 = 15:21 → floored 15:20 (phrasing lives in i18n)
    expect(ctx.departure?.departureMinutes).toBe(15 * 60 + 20);
  });

  it('marks earlier events past and honours completed/skipped runtime', () => {
    const runtime: DatePackRuntimeState = {
      planId: 'p1',
      updatedAt: '',
      events: {
        e1: { eventId: 'e1', status: 'completed' },
        e2: { eventId: 'e2', status: 'skipped' },
      },
    };
    const ctx = computeDayContext(makePlan(), runtime, at(14, 42));
    const byId = new Map(ctx.events.map((v) => [v.event.id, v.status]));
    expect(byId.get('e1')).toBe('completed');
    expect(byId.get('e2')).toBe('skipped');
    expect(ctx.completedCount).toBe(1);
    expect(ctx.skippedCount).toBe(1);
  });

  it('treats a long-overdue unsettled event as past once the next event nears', () => {
    // 15:10: 디아로마 ended 14:50 and 성심당 재방문(15:30) is coming up.
    const ctx = computeDayContext(makePlan(), emptyRuntime('p1'), at(15, 10));
    expect(ctx.current).toBeNull();
    expect(ctx.next?.event.id).toBe('e4');
    const byId = new Map(ctx.events.map((v) => [v.event.id, v.status]));
    expect(byId.get('e3')).toBe('past');
    // the Today view needs the unrecorded events to stay honest about the day
    expect(ctx.overdueUnsettled.map((v) => v.event.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('keeps showing an overdue event as NOW when nothing follows', () => {
    const plan = makePlan();
    plan.events = plan.events.filter((e) => ['e1', 'e2', 'e3'].includes(e.id));
    const ctx = computeDayContext(plan, emptyRuntime('p1'), at(15, 10));
    expect(ctx.current?.event.id).toBe('e3');
    expect(ctx.remainingInCurrent).toBeLessThan(0);
  });

  it('marks earlier started events past while one is current', () => {
    const ctx = computeDayContext(makePlan(), emptyRuntime('p1'), at(14, 42));
    const byId = new Map(ctx.events.map((v) => [v.event.id, v.status]));
    expect(byId.get('e1')).toBe('past');
    expect(byId.get('e2')).toBe('past');
    expect(byId.get('e3')).toBe('current');
  });

  it('handles delays: current event runs longer, next departure shifts', () => {
    const runtime: DatePackRuntimeState = {
      planId: 'p1',
      updatedAt: '',
      events: {
        e3: { eventId: 'e3', status: 'pending', delayedByMinutes: 15 },
        e4: { eventId: 'e4', status: 'pending', delayedByMinutes: 15 },
      },
    };
    const ctx = computeDayContext(makePlan(), runtime, at(14, 42));
    // remaining: 14:50 + 15 − 14:42 = 23분
    expect(ctx.remainingInCurrent).toBe(23);
    // departure: 15:30 + 15 − 9 = 15:36 → floored 15:35
    expect(ctx.departure?.departureMinutes).toBe(15 * 60 + 35);
  });

  it('flags the night as cleared past a grace window after the last stop', () => {
    // 마지막 일정 22:42, 종료 없음 → 23:42(=+60분)부터 마무리 상태
    expect(computeDayContext(makePlan(), emptyRuntime('p1'), at(23, 10)).nightCleared).toBe(false);
    expect(computeDayContext(makePlan(), emptyRuntime('p1'), at(23, 50)).nightCleared).toBe(true);
    // 모든 일정을 기록하면 nightCleared가 아니라 allSettled가 된다
    const runtime: DatePackRuntimeState = {
      planId: 'p1',
      updatedAt: '',
      events: Object.fromEntries(
        makePlan().events.map((e) => [e.id, { eventId: e.id, status: 'completed' as const }]),
      ),
    };
    expect(computeDayContext(makePlan(), runtime, at(23, 50)).nightCleared).toBe(false);
    expect(computeDayContext(makePlan(), runtime, at(23, 50)).allSettled).toBe(true);
  });

  it('reports all done when every event is settled', () => {
    const runtime: DatePackRuntimeState = {
      planId: 'p1',
      updatedAt: '',
      events: Object.fromEntries(
        makePlan().events.map((e) => [e.id, { eventId: e.id, status: 'completed' as const }]),
      ),
    };
    const ctx = computeDayContext(makePlan(), runtime, at(14, 42));
    expect(ctx.allSettled).toBe(true);
    expect(ctx.current).toBeNull();
    expect(ctx.next).toBeNull();
  });

  it('shows nothing as current before the first event', () => {
    const ctx = computeDayContext(makePlan(), emptyRuntime('p1'), at(8, 0));
    expect(ctx.current).toBeNull();
    expect(ctx.next?.event.id).toBe('e1');
  });
});

describe('computeDayContext — not today', () => {
  it('does not highlight NOW/NEXT on other days', () => {
    const plan = makePlan();
    plan.date = '2026-09-30';
    const ctx = computeDayContext(plan, emptyRuntime('p1'), at(14, 42));
    expect(ctx.isToday).toBe(false);
    expect(ctx.current).toBeNull();
    expect(ctx.next).toBeNull();
    expect(ctx.departure).toBeNull();
    expect(ctx.events.every((v) => v.status === 'upcoming')).toBe(true);
  });
});

describe('runtime helpers', () => {
  it('defaults to pending/A for unknown events', () => {
    const entry = getRuntimeEntry(emptyRuntime('p1'), 'ghost');
    expect(entry.status).toBe('pending');
    expect(entry.activePlan).toBe('A');
    expect(entry.delayedByMinutes).toBe(0);
  });
});
