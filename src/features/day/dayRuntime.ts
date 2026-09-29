import type { DateEvent, DatePackRuntimeState, DatePlan, EventRuntimeState } from '@datepack/core';
import { floorTo5, formatTime, localPointMinutes, minutesOfDay, todayISO } from '@datepack/core';

export type DayEventStatus = 'completed' | 'skipped' | 'current' | 'unknown-past' | 'upcoming';
export type DayEventView = {
  event: DateEvent;
  status: DayEventStatus;
  startMinutes: number | null;
  endMinutes: number | null;
  delayedByMinutes: number;
  activePlan: 'A' | 'B';
  includeInRemaining?: boolean;
};
export type DayDeparture = {
  eventId: string;
  departureMinutes: number;
  travelMinutes: number | null;
};
export type DayContext = {
  isToday: boolean;
  isWithinPlanDays: boolean;
  events: DayEventView[];
  current: DayEventView | null;
  next: DayEventView | null;
  departure: DayDeparture | null;
  remainingInCurrent: number | null;
  /** Clock has passed these planned starts; actual outcome is still unknown. */
  overdueUnsettled: DayEventView[];
  nightCleared: false;
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

function plannedStart(event: DateEvent): number | null {
  const timing = event.timing;
  if (timing.kind === 'exact') return localPointMinutes(timing.start);
  if (timing.kind === 'window') return localPointMinutes(timing.earliestStart);
  return null;
}

function plannedEnd(event: DateEvent): number | null {
  return event.timing.kind === 'exact' && event.timing.end
    ? localPointMinutes(event.timing.end)
    : null;
}

function latestTimingMinute(timing: DateEvent['timing']): number | null {
  if (timing.kind === 'unscheduled') return null;
  if (timing.kind === 'window') return (localPointMinutes(timing.latestStart) ?? 0) + 60;
  const start = localPointMinutes(timing.start);
  if (timing.end) return localPointMinutes(timing.end);
  return start === null ? null : start + 60;
}

function latestPlanMinute(plan: DatePlan): number | null {
  const endpoints = plan.events
    .map((event) => latestTimingMinute(event.timing))
    .filter((minute): minute is number => minute !== null);
  if (plan.mustEndBy) endpoints.push(localPointMinutes(plan.mustEndBy) ?? 0);
  if (plan.meeting?.timing) {
    const meetingEnd = latestTimingMinute(plan.meeting.timing);
    if (meetingEnd !== null) endpoints.push(meetingEnd);
  }
  return endpoints.length ? Math.max(...endpoints) : null;
}

/** Calendar-day difference from the plan's date to the current local date. */
function calendarDayDifference(currentDate: string, planDate: string): number {
  const [currentYear, currentMonth, currentDay] = currentDate.split('-').map(Number);
  const [planYear, planMonth, planDay] = planDate.split('-').map(Number);
  const current = Date.UTC(currentYear, currentMonth - 1, currentDay);
  const planned = Date.UTC(planYear, planMonth - 1, planDay);
  return Math.round((current - planned) / 86_400_000);
}

export function computeDayContext(
  plan: DatePlan,
  runtime: DatePackRuntimeState | null,
  now: Date,
): DayContext {
  const isToday = plan.date === todayISO(now);
  const nowMinutes = minutesOfDay(now);
  const planDayOffset = plan.date ? calendarDayDifference(todayISO(now), plan.date) : null;
  const inferenceWithinPlanDays =
    planDayOffset !== null && planDayOffset >= 0 && planDayOffset <= 1;
  const withinPlanDays =
    planDayOffset === 0 ||
    (planDayOffset === 1 &&
      latestPlanMinute(plan) !== null &&
      1440 + nowMinutes <= latestPlanMinute(plan)!);
  const elapsedPlanMinutes =
    planDayOffset === null ? nowMinutes : planDayOffset * 1440 + nowMinutes;
  const views = [...plan.events]
    .sort((a, b) => a.order - b.order)
    .map((event): DayEventView => {
      const state = getRuntimeEntry(runtime, event.id);
      const startMinutes = plannedStart(event);
      return {
        event,
        status:
          state.status === 'completed' || state.status === 'skipped' ? state.status : 'upcoming',
        startMinutes,
        endMinutes: plannedEnd(event),
        delayedByMinutes: state.delayedByMinutes ?? 0,
        activePlan: state.activePlan ?? 'A',
        includeInRemaining: state.includeInRemaining ?? false,
      };
    });

  for (const view of views) {
    if (view.status !== 'upcoming' || view.startMinutes === null || !inferenceWithinPlanDays)
      continue;
    view.status = view.startMinutes < elapsedPlanMinutes ? 'unknown-past' : 'upcoming';
  }
  // A planned time cannot establish that someone is currently at a place.
  // Only explicit runtime facts can resolve actual status; live context is separate.
  const current = null;
  const next = inferenceWithinPlanDays
    ? (views.find((v) => v.status === 'upcoming' && v.startMinutes !== null) ?? null)
    : null;
  const departure =
    next?.startMinutes !== null && next?.startMinutes !== undefined
      ? {
          eventId: next.event.id,
          travelMinutes: null,
          departureMinutes: floorTo5(next.startMinutes + next.delayedByMinutes),
        }
      : null;
  const remainingInCurrent = null;
  const completedCount = views.filter((v) => v.status === 'completed').length;
  const skippedCount = views.filter((v) => v.status === 'skipped').length;
  const overdueUnsettled = views.filter((v) => v.status === 'unknown-past');

  return {
    isToday,
    isWithinPlanDays: withinPlanDays,
    events: views,
    current,
    next,
    departure,
    remainingInCurrent,
    overdueUnsettled,
    nightCleared: false,
    completedCount,
    skippedCount,
    totalCount: views.length,
    allSettled:
      views.length > 0 && views.every((v) => v.status === 'completed' || v.status === 'skipped'),
  };
}

/** Keep explicit choices ahead of inferred order while retaining manual order for the rest. */
export function getRemainingPlanEvents(
  context: DayContext,
  preferredEventId?: string,
): DayEventView[] {
  const eligible = context.events.filter(
    (view) =>
      view.status !== 'completed' &&
      view.status !== 'skipped' &&
      (view.status !== 'unknown-past' ||
        view.includeInRemaining ||
        view.event.id === preferredEventId),
  );
  const next =
    eligible.find((view) => view.event.id === preferredEventId) ??
    eligible.find((view) => view.status === 'unknown-past' && view.includeInRemaining) ??
    eligible.find((view) => view.event.id === context.next?.event.id) ??
    eligible.find((view) => view.event.timing.kind === 'unscheduled') ??
    (!context.isWithinPlanDays ? eligible[0] : undefined);
  return next ? [next, ...eligible.filter((view) => view.event.id !== next.event.id)] : eligible;
}

export function timeRangeLabel(view: DayEventView, locale: 'ko' | 'en' = 'en'): string {
  const dayLabel = (offset: 0 | 1) =>
    offset === 1 ? (locale === 'ko' ? '다음 날' : 'next day') : '';
  if (view.event.timing.kind === 'unscheduled')
    return view.event.timing.label ?? (locale === 'ko' ? '시간 미정' : 'Unscheduled');
  if (view.event.timing.kind === 'window') {
    const from = view.event.timing.earliestStart;
    const to = view.event.timing.latestStart;
    const a = `${formatTime(localPointMinutes(from) ?? 0)}${from.dayOffset ? ` (${dayLabel(from.dayOffset)})` : ''}`;
    const b = `${formatTime(localPointMinutes(to) ?? 0)}${to.dayOffset ? ` (${dayLabel(to.dayOffset)})` : ''}`;
    return `${a}–${b} ${locale === 'ko' ? '시작 시간대' : 'start window'}`;
  }
  const startMinutes = localPointMinutes(view.event.timing.start);
  const start = `${formatTime(startMinutes ?? 0)}${view.event.timing.start.dayOffset ? ` (${dayLabel(view.event.timing.start.dayOffset)})` : ''}`;
  if (!view.event.timing.end) return start;
  const endMinutes = localPointMinutes(view.event.timing.end);
  const end = `${formatTime(endMinutes ?? 0)}${view.event.timing.end.dayOffset ? ` (${dayLabel(view.event.timing.end.dayOffset)})` : ''}`;
  return `${start} – ${end}`;
}
