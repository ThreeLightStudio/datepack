import { describe, expect, it } from 'vitest';
import type { DatePackRuntimeState, DatePlan } from '@datepack/core';
import { createEvent } from '@datepack/core';
import {
  computeDayContext,
  emptyRuntime,
  getRemainingPlanEvents,
  getRuntimeEntry,
  timeRangeLabel,
} from '../src/features/day/dayRuntime';

const DAY = '2026-09-28';
function plan(): DatePlan {
  return {
    id: 'p',
    title: 'Day out',
    date: DAY,
    events: [
      createEvent({
        id: 'later-first',
        title: 'Late stop',
        timing: { kind: 'exact', start: { dayOffset: 0, time: '15:30' } },
        order: 0,
      }),
      createEvent({
        id: 'earlier-second',
        title: 'Lunch',
        timing: {
          kind: 'exact',
          start: { dayOffset: 0, time: '12:00' },
          end: { dayOffset: 0, time: '13:00' },
        },
        order: 1,
      }),
      createEvent({
        id: 'loose',
        title: 'Walk',
        timing: { kind: 'unscheduled', label: 'After lunch' },
        order: 2,
      }),
    ],
  };
}
const at = (hour: number, minute: number) =>
  new Date(
    `2026-09-28T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`,
  );

describe('dayRuntime', () => {
  it('preserves manual order even when clock times disagree', () => {
    const ctx = computeDayContext(plan(), emptyRuntime('p'), at(10, 0));
    expect(ctx.events.map((v) => v.event.id)).toEqual(['later-first', 'earlier-second', 'loose']);
    expect(ctx.next?.event.id).toBe('later-first');
  });

  it('keeps elapsed planned events explicitly unknown until the user records an outcome', () => {
    const ctx = computeDayContext(plan(), emptyRuntime('p'), at(14, 0));
    expect(ctx.events.find((v) => v.event.id === 'earlier-second')?.status).toBe('unknown-past');
    expect(ctx.completedCount).toBe(0);
    expect(ctx.skippedCount).toBe(0);
    expect(ctx.overdueUnsettled.map((v) => v.event.id)).toEqual(['earlier-second']);
  });

  it('uses explicit completion and skip runtime, never elapsed time', () => {
    const runtime: DatePackRuntimeState = {
      planId: 'p',
      updatedAt: '',
      events: {
        'earlier-second': { eventId: 'earlier-second', status: 'completed' },
        'later-first': { eventId: 'later-first', status: 'skipped' },
      },
    };
    const ctx = computeDayContext(plan(), runtime, at(16, 0));
    expect(ctx.completedCount).toBe(1);
    expect(ctx.skippedCount).toBe(1);
    expect(ctx.events.find((v) => v.event.id === 'earlier-second')?.status).toBe('completed');
    expect(ctx.events.find((v) => v.event.id === 'later-first')?.status).toBe('skipped');
  });

  it('keeps timing windows as start windows and unscheduled activities out of clock inference', () => {
    const p = plan();
    p.events = [
      createEvent({
        id: 'window',
        title: 'Meet',
        order: 0,
        timing: {
          kind: 'window',
          earliestStart: { dayOffset: 0, time: '14:00' },
          latestStart: { dayOffset: 0, time: '16:00' },
        },
      }),
      createEvent({
        id: 'loose',
        title: 'Coffee',
        order: 1,
        timing: { kind: 'unscheduled', label: 'After the gallery' },
      }),
    ];
    const ctx = computeDayContext(p, emptyRuntime('p'), at(15, 0));
    expect(ctx.current).toBeNull();
    expect(ctx.events[0].status).toBe('unknown-past');
    expect(timeRangeLabel(ctx.events[0])).toContain('start window');
    expect(ctx.events[1].startMinutes).toBeNull();
  });

  it('handles next-day timing as the entered day offset', () => {
    const p = plan();
    p.events = [
      createEvent({
        id: 'night',
        title: 'Night walk',
        order: 0,
        timing: { kind: 'exact', start: { dayOffset: 1, time: '00:20' } },
      }),
    ];
    const ctx = computeDayContext(p, emptyRuntime('p'), at(23, 0));
    expect(ctx.current).toBeNull();
    expect(ctx.next?.startMinutes).toBe(1460);
  });

  it('keeps next-day dawn activities in the date plan after midnight', () => {
    const p = plan();
    p.events = [
      createEvent({
        id: 'after-midnight',
        title: 'Late café',
        order: 0,
        timing: { kind: 'exact', start: { dayOffset: 1, time: '00:20' } },
      }),
    ];
    const beforeStart = computeDayContext(
      p,
      emptyRuntime('p'),
      new Date('2026-09-29T00:05:00+09:00'),
    );
    expect(beforeStart.isToday).toBe(false);
    expect(beforeStart.isWithinPlanDays).toBe(true);
    expect(beforeStart.next?.event.id).toBe('after-midnight');
    expect(beforeStart.events[0].status).toBe('upcoming');

    const afterStart = computeDayContext(
      p,
      emptyRuntime('p'),
      new Date('2026-09-29T00:21:00+09:00'),
    );
    expect(afterStart.isWithinPlanDays).toBe(true);
    expect(afterStart.events[0].status).toBe('unknown-past');
    expect(afterStart.overdueUnsettled.map((view) => view.event.id)).toEqual(['after-midnight']);
    const lateNextDay = computeDayContext(
      p,
      emptyRuntime('p'),
      new Date('2026-09-29T23:00:00+09:00'),
    );
    expect(lateNextDay.isWithinPlanDays).toBe(false);
    expect(lateNextDay.events[0].status).toBe('unknown-past');
    expect(lateNextDay.next).toBeNull();
  });

  it('preserves explicit re-inclusion on an elapsed unconfirmed activity', () => {
    const runtime: DatePackRuntimeState = {
      ...emptyRuntime('p'),
      events: {
        'earlier-second': {
          eventId: 'earlier-second',
          status: 'pending',
          includeInRemaining: true,
        },
      },
    };
    const ctx = computeDayContext(plan(), runtime, at(14, 0));
    expect(ctx.overdueUnsettled[0].includeInRemaining).toBe(true);
    expect(ctx.overdueUnsettled[0].status).toBe('unknown-past');
    expect(getRemainingPlanEvents(ctx).map((view) => view.event.id)).toEqual([
      'earlier-second',
      'later-first',
      'loose',
    ]);
  });

  it('puts the user-chosen next place first in the remaining order', () => {
    const ctx = computeDayContext(plan(), emptyRuntime('p'), at(10, 0));
    expect(getRemainingPlanEvents(ctx, 'loose').map((view) => view.event.id)).toEqual([
      'loose',
      'later-first',
      'earlier-second',
    ]);
  });

  it('ignores a completed or skipped live-context destination', () => {
    const runtime: DatePackRuntimeState = {
      ...emptyRuntime('p'),
      events: {
        'later-first': { eventId: 'later-first', status: 'completed' },
        loose: { eventId: 'loose', status: 'skipped' },
      },
    };
    const ctx = computeDayContext(plan(), runtime, at(10, 0));
    expect(getRemainingPlanEvents(ctx, 'later-first').map((view) => view.event.id)).toEqual([
      'earlier-second',
    ]);
  });

  it('shows next-day offsets in the plan time label', () => {
    const p = plan();
    p.events = [
      createEvent({
        id: 'overnight',
        title: 'Late dinner',
        order: 0,
        timing: {
          kind: 'exact',
          start: { dayOffset: 0, time: '23:20' },
          end: { dayOffset: 1, time: '00:10' },
        },
      }),
    ];
    const [view] = computeDayContext(p, emptyRuntime('p'), at(10, 0)).events;
    expect(timeRangeLabel(view, 'en')).toBe('23:20 – 00:10 (next day)');
    expect(timeRangeLabel(view, 'ko')).toBe('23:20 – 00:10 (다음 날)');
  });

  it('does not surface a current event on another calendar day', () => {
    const p = plan();
    p.date = '2026-09-30';
    const ctx = computeDayContext(p, emptyRuntime('p'), at(16, 0));
    expect(ctx.isToday).toBe(false);
    expect(ctx.current).toBeNull();
    expect(ctx.next).toBeNull();
  });

  it('defaults missing runtime entries to pending', () => {
    expect(getRuntimeEntry(emptyRuntime('p'), 'unknown').status).toBe('pending');
  });
});
