import type { DateEvent, DatePackRuntimeState, DatePlan, EventRuntimeState } from '@datepack/core';
import { floorTo5, formatTime, minutesOfDay, parseTime, todayISO } from '@datepack/core';

export type DayEventStatus = 'completed' | 'skipped' | 'current' | 'past' | 'upcoming';

export type DayEventView = {
  event: DateEvent;
  status: DayEventStatus;
  /** effective start/end in minutes since midnight (delay included for departure math) */
  startMinutes: number;
  endMinutes: number | null;
  delayedByMinutes: number;
  activePlan: 'A' | 'B';
};

export type DayDeparture = {
  eventId: string;
  /** Recommended departure in minutes since midnight (already floored for display). */
  departureMinutes: number;
  travelMinutes: number | null;
};

export type DayContext = {
  isToday: boolean;
  events: DayEventView[];
  current: DayEventView | null;
  next: DayEventView | null;
  departure: DayDeparture | null;
  /** minutes left in the current event (negative = overdue) */
  remainingInCurrent: number | null;
  /** started but never marked completed/skipped — the Today view must stay honest about these */
  overdueUnsettled: DayEventView[];
  /** the day has run past its last stop by a grace window and stops went unlogged */
  nightCleared: boolean;
  completedCount: number;
  skippedCount: number;
  totalCount: number;
  allSettled: boolean;
};

export function emptyRuntime(planId: string): DatePackRuntimeState {
  return { planId, updatedAt: new Date().toISOString(), events: {} };
}

export function getRuntimeEntry(
  runtime: DatePackRuntimeState | null,
  eventId: string,
): EventRuntimeState {
  return (
    runtime?.events[eventId] ?? { eventId, status: 'pending', delayedByMinutes: 0, activePlan: 'A' }
  );
}

export function computeDayContext(
  plan: DatePlan,
  runtime: DatePackRuntimeState | null,
  now: Date,
): DayContext {
  const isToday = plan.date === todayISO(now);
  const nowMinutes = minutesOfDay(now);

  const views: DayEventView[] = [...plan.events]
    .sort((a, b) => (parseTime(a.start) ?? 0) - (parseTime(b.start) ?? 0))
    .map((event) => {
      const state = getRuntimeEntry(runtime, event.id);
      const start = parseTime(event.start) ?? 0;
      const end = event.end ? parseTime(event.end) : null;
      return {
        event,
        status: 'upcoming' as DayEventStatus,
        startMinutes: start,
        endMinutes: end,
        delayedByMinutes: state.delayedByMinutes ?? 0,
        activePlan: state.activePlan ?? 'A',
      };
    });

  if (!isToday) {
    const completed = views.filter(
      (v) => getRuntimeEntry(runtime, v.event.id).status === 'completed',
    ).length;
    const skipped = views.filter(
      (v) => getRuntimeEntry(runtime, v.event.id).status === 'skipped',
    ).length;
    return {
      isToday: false,
      events: views,
      current: null,
      next: null,
      departure: null,
      remainingInCurrent: null,
      overdueUnsettled: [],
      nightCleared: false,
      completedCount: completed,
      skippedCount: skipped,
      totalCount: views.length,
      allSettled: false,
    };
  }

  // 1st pass: runtime-settled events
  for (const view of views) {
    const state = getRuntimeEntry(runtime, view.event.id);
    if (state.status === 'completed') view.status = 'completed';
    if (state.status === 'skipped') view.status = 'skipped';
  }

  // 2nd pass: NOW is the *latest* unsettled event that already started.
  // If it ran over its end time but the next event is coming up, it reads as
  // past and the upcoming event takes over (departure card instead of NOW).
  const unsettled = views.filter((v) => v.status === 'upcoming');
  const started = unsettled.filter((v) => v.startMinutes <= nowMinutes);
  const upcoming = unsettled.filter((v) => v.startMinutes > nowMinutes);
  const next = upcoming[0] ?? null;

  let current: DayEventView | null = null;
  if (started.length > 0) {
    const last = started[started.length - 1];
    const endEffective = last.endMinutes === null ? null : last.endMinutes + last.delayedByMinutes;
    const overdue = endEffective !== null && endEffective < nowMinutes;
    if (!overdue || upcoming.length === 0) current = last;
  }

  for (const view of started) {
    if (view === current) view.status = 'current';
    else view.status = 'past';
  }

  let remainingInCurrent: number | null = null;
  if (current?.endMinutes !== null && current?.endMinutes !== undefined) {
    remainingInCurrent = current.endMinutes + current.delayedByMinutes - nowMinutes;
  }

  let departure: DayDeparture | null = null;
  if (next) {
    const travel = next.event.travelMinutes ?? null;
    const departureMinutes = next.startMinutes + next.delayedByMinutes - (travel ?? 0);
    departure = {
      eventId: next.event.id,
      departureMinutes: floorTo5(departureMinutes),
      travelMinutes: travel,
    };
  }

  const overdueUnsettled = views.filter((v) => v.status === 'past');

  // Night closure: well past the last stop's start (45 min after its end when it
  // has one, 60 min after its start when it doesn't) with stops still unlogged.
  let nightCleared = false;
  const last = views[views.length - 1];
  if (last && overdueUnsettled.length > 0) {
    const lastStart = last.startMinutes + last.delayedByMinutes;
    const graceEnd =
      last.endMinutes !== null ? last.endMinutes + last.delayedByMinutes + 45 : lastStart + 60;
    nightCleared = nowMinutes >= graceEnd;
  }

  const completedCount = views.filter((v) => v.status === 'completed').length;
  const skippedCount = views.filter((v) => v.status === 'skipped').length;

  return {
    isToday,
    events: views,
    current,
    next,
    departure,
    remainingInCurrent,
    overdueUnsettled,
    nightCleared,
    completedCount,
    skippedCount,
    totalCount: views.length,
    allSettled: !current && !next && views.length > 0,
  };
}

/** Caption under an event: "09:34 – 09:50" */
export function timeRangeLabel(view: DayEventView): string {
  const start = formatTime(view.startMinutes);
  if (view.endMinutes === null) return start;
  return `${start} – ${formatTime(view.endMinutes)}`;
}
