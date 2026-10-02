import { localPointMinutes, sortEventsByOrder } from '@datepack/core';
import type { DatePlan, LocalPoint } from '@datepack/core';

/** beforeId=null means the end. Drop in the current gap is a no-op. */
export function reorderPlan(
  plan: DatePlan,
  eventId: string,
  beforeId: string | null,
): DatePlan | null {
  const events = sortEventsByOrder(plan.events);
  const originalIds = events.map((event) => event.id);
  const from = events.findIndex((event) => event.id === eventId);
  if (
    from < 0 ||
    beforeId === eventId ||
    (beforeId !== null && !events.some((e) => e.id === beforeId))
  )
    return null;
  const [event] = events.splice(from, 1);
  const to = beforeId === null ? events.length : events.findIndex((e) => e.id === beforeId);
  events.splice(to, 0, event);
  if (events.every((e, index) => e.id === originalIds[index])) return null;
  return {
    ...structuredClone(plan),
    events: events.map((e, order) => ({ ...structuredClone(e), order })),
  };
}

const point = (minutes: number): LocalPoint => ({
  dayOffset: minutes >= 1440 ? 1 : 0,
  time: `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
});

/** Optional preview only: resolve time inversions without guessing travel or filling unset times.
 * Fixed/time-protected stops stay unchanged; full route validation still decides acceptance. */
export function adjustReorderedTimes(plan: DatePlan): DatePlan | null {
  const next = structuredClone(plan);
  let cursor = plan.availableFrom ? localPointMinutes(plan.availableFrom)! : null;
  let changed = false;
  for (const event of sortEventsByOrder(next.events)) {
    const timing = event.timing;
    if (timing.kind === 'unscheduled') {
      if (cursor !== null && event.estimatedDurationMinutes !== undefined)
        cursor += event.estimatedDurationMinutes;
      continue;
    }
    const start = localPointMinutes(timing.kind === 'exact' ? timing.start : timing.earliestStart)!;
    const end = localPointMinutes(
      timing.kind === 'exact' ? (timing.end ?? timing.start) : timing.latestStart,
    )!;
    const shift = cursor === null ? 0 : Math.max(0, Math.ceil(cursor - start));
    if (shift && !event.fixed && !event.protectedFields?.includes('time')) {
      if (end + shift >= 2880) return null;
      event.timing =
        timing.kind === 'exact'
          ? {
              kind: 'exact',
              start: point(start + shift),
              ...(timing.end ? { end: point(end + shift) } : {}),
            }
          : {
              kind: 'window',
              earliestStart: point(start + shift),
              latestStart: point(end + shift),
            };
      // Keep compatibility aliases consistent, without adding aliases to modern events.
      if (event.start !== undefined) event.start = point(start + shift).time;
      if (event.end !== undefined) event.end = point(end + shift).time;
      changed = true;
    }
    const appliedShift = event.timing === timing ? 0 : shift;
    cursor = Math.max(
      cursor ?? 0,
      end +
        appliedShift +
        (timing.kind === 'exact' && timing.end ? 0 : (event.estimatedDurationMinutes ?? 0)),
    );
  }
  return changed ? next : null;
}
