import type { DateEvent, DatePlan, EventTiming } from './types';
import type { DatePackIssue } from './i18n/core';
import { localPointMinutes } from './utils/time';

function startMinute(timing: EventTiming): number | null {
  if (timing.kind === 'exact') return localPointMinutes(timing.start);
  if (timing.kind === 'window') return localPointMinutes(timing.earliestStart);
  return null;
}
function endMinute(timing: EventTiming): number | null {
  if (timing.kind !== 'exact' || !timing.end) return null;
  return localPointMinutes(timing.end);
}

/** Advisory checks for exact scheduled events, including next-day dayOffset values. */
export function findPlanConflicts(plan: DatePlan): DatePackIssue[] {
  const issues: DatePackIssue[] = [];
  const events = [...plan.events].sort((a, b) => {
    const as = startMinute(a.timing),
      bs = startMinute(b.timing);
    return as === null || bs === null ? a.order - b.order : as - bs;
  });
  let prev: DateEvent | null = null;
  for (const event of events) {
    const start = startMinute(event.timing);
    if (start === null) {
      prev = null;
      continue;
    }
    const end = endMinute(event.timing);
    if (end !== null && end < start)
      issues.push({ key: 'warn.conflict.endBeforeStart', params: { title: event.title } });
    const prevEnd = prev ? endMinute(prev.timing) : null;
    if (prev && prevEnd !== null) {
      const travel =
        plan.sharedTravel?.find((t) => t.toPlaceId === event.placeId)?.estimatedMinutes ??
        event.travelMinutes ??
        0;
      if (start < prevEnd)
        issues.push({
          key: 'warn.conflict.overlap',
          params: { prev: prev.title, next: event.title },
        });
      else if (travel > 0 && start < prevEnd + travel)
        issues.push({
          key: 'warn.conflict.travel',
          params: { next: event.title, minutes: travel },
        });
    }
    prev = event;
  }
  return issues;
}

export function findIntroducedPlanConflicts(
  baseline: DatePlan,
  proposed: DatePlan,
): DatePackIssue[] {
  const counts = new Map<string, number>();
  for (const issue of findPlanConflicts(baseline)) {
    const key = JSON.stringify([issue.key, issue.params ?? {}]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return findPlanConflicts(proposed).filter((issue) => {
    const key = JSON.stringify([issue.key, issue.params ?? {}]);
    const n = counts.get(key) ?? 0;
    if (!n) return true;
    counts.set(key, n - 1);
    return false;
  });
}
