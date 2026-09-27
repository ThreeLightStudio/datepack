import type { DateEvent, DatePlan } from './types';
import type { DatePackIssue } from './i18n/core';
import { parseTime } from './utils/time';

/**
 * Deterministic sanity checks for a (re)planned day: inverted ranges, overlaps
 * between neighbors, and travel times that don't fit the gap. Advisory only —
 * the caller decides whether to surface them as warnings; nothing here blocks.
 */
export function findPlanConflicts(plan: DatePlan): DatePackIssue[] {
  const issues: DatePackIssue[] = [];
  const events = [...plan.events].sort(
    (a, b) => (parseTime(a.start) ?? 0) - (parseTime(b.start) ?? 0),
  );

  let prev: DateEvent | null = null;
  for (const event of events) {
    const start = parseTime(event.start);
    if (start === null) {
      prev = null;
      continue;
    }
    const end = event.end ? parseTime(event.end) : null;

    if (end !== null && end < start) {
      issues.push({ key: 'warn.conflict.endBeforeStart', params: { title: event.title } });
    }

    const prevEnd = prev?.end ? parseTime(prev.end) : null;
    if (prev && prevEnd !== null) {
      const travel = event.travelMinutes ?? 0;
      if (start < prevEnd) {
        issues.push({
          key: 'warn.conflict.overlap',
          params: { prev: prev.title, next: event.title },
        });
      } else if (travel > 0 && start < prevEnd + travel) {
        issues.push({
          key: 'warn.conflict.travel',
          params: { next: event.title, minutes: travel },
        });
      }
    }
    prev = event;
  }
  return issues;
}
