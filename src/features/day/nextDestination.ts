import type { Candidate, DateEvent, DateEventType, DatePlan } from '@datepack/core';
import { createEvent } from '@datepack/core';

export function promoteCandidateToNextActivity(
  plan: DatePlan,
  candidateId: string,
): DateEvent | null {
  const candidate = plan.candidates?.find((item) => item.id === candidateId && !item.excluded);
  if (!candidate) return null;
  const event = eventFromCandidate(candidate, plan.events.length);
  plan.events.push(event);
  plan.candidates = (plan.candidates ?? []).filter((item) => item.id !== candidate.id);
  return event;
}

export function addNextActivity(plan: DatePlan, title: string, type: DateEventType): DateEvent {
  const event = createEvent({
    title: title.trim(),
    type,
    timing: { kind: 'unscheduled' },
    order: plan.events.length,
  });
  plan.events.push(event);
  return event;
}

function eventFromCandidate(candidate: Candidate, order: number): DateEvent {
  return createEvent({
    title: candidate.title,
    type: candidate.type ?? 'place',
    placeId: candidate.placeId,
    note: candidate.note,
    timing: { kind: 'unscheduled' },
    order,
  });
}
