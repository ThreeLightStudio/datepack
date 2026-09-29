import type {
  Candidate,
  DateEvent,
  DateEventType,
  DatePackRuntimeState,
  DatePlan,
} from '@datepack/core';
import { createEvent } from '@datepack/core';

export function isSettledNextEvent(runtime: DatePackRuntimeState | null, eventId: string): boolean {
  const status = runtime?.events[eventId]?.status;
  return status === 'completed' || status === 'skipped';
}

export function selectableNextEvents(
  events: DateEvent[],
  runtime: DatePackRuntimeState | null,
): DateEvent[] {
  return events.filter((event) => !isSettledNextEvent(runtime, event.id));
}

export function promoteCandidateToNextActivity(
  plan: DatePlan,
  candidateId: string,
): DateEvent | null {
  const eventId = `next-${candidateId}`;
  const existing = plan.events.find((event) => event.id === eventId);
  if (existing) return existing;
  const candidate = plan.candidates?.find((item) => item.id === candidateId && !item.excluded);
  if (!candidate) return null;
  const event = eventFromCandidate(candidate, plan.events.length, eventId);
  plan.events.push(event);
  plan.candidates = (plan.candidates ?? []).filter((item) => item.id !== candidate.id);
  return event;
}

export function addNextActivity(
  plan: DatePlan,
  title: string,
  type: DateEventType,
  eventId?: string,
): DateEvent {
  const existing = eventId ? plan.events.find((event) => event.id === eventId) : undefined;
  if (existing) return existing;
  const event = createEvent({
    id: eventId,
    title: title.trim(),
    type,
    timing: { kind: 'unscheduled' },
    order: plan.events.length,
  });
  plan.events.push(event);
  return event;
}

function eventFromCandidate(candidate: Candidate, order: number, eventId: string): DateEvent {
  return createEvent({
    id: eventId,
    title: candidate.title,
    type: candidate.type ?? 'place',
    placeId: candidate.placeId,
    note: candidate.note,
    timing: { kind: 'unscheduled' },
    order,
  });
}
