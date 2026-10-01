import type {
  DateEvent,
  OutingDatePack,
  DatePlan,
  OutingConditions,
  LocalPoint,
  EventTiming,
  Place,
  Experience,
  MemoriesDatePack,
} from './types';
import { DATE_EVENT_TYPES } from './types';
import { makeManifest } from './schema';
import { createId } from './utils/id';
import { timingStartMinutes } from './utils/time';

export function createEvent(
  partial: Partial<DateEvent> & Pick<DateEvent, 'title'> & { timing?: EventTiming },
): DateEvent {
  const type = partial.type ?? 'place';
  return {
    id: partial.id ?? createId('event'),
    order: partial.order ?? 0,
    title: partial.title,
    type: (DATE_EVENT_TYPES as readonly string[]).includes(type) ? type : 'place',
    timing:
      partial.timing ??
      (partial.start
        ? {
            kind: 'exact',
            start: { dayOffset: 0, time: partial.start },
            ...(partial.end ? { end: { dayOffset: 0, time: partial.end } } : {}),
          }
        : { kind: 'unscheduled' }),
    ...(partial.placeId !== undefined ? { placeId: partial.placeId } : {}),
    ...(partial.note !== undefined ? { note: partial.note } : {}),
    ...(partial.assetIds !== undefined ? { assetIds: partial.assetIds } : {}),
    ...(partial.importance !== undefined ? { importance: partial.importance } : {}),
    ...((partial.protectedFields ??
    (partial.fixed ? ['time', 'place', 'content', 'delete', 'order'] : undefined))
      ? {
          protectedFields: partial.protectedFields ?? [
            'time',
            'place',
            'content',
            'delete',
            'order',
          ],
        }
      : {}),
    ...(partial.estimatedDurationMinutes !== undefined
      ? { estimatedDurationMinutes: partial.estimatedDurationMinutes }
      : {}),
    ...(partial.planB !== undefined ? { planB: partial.planB } : {}),
    ...(partial.start !== undefined ? { start: partial.start } : {}),
    ...(partial.end !== undefined ? { end: partial.end } : {}),
    ...(partial.fixed !== undefined ? { fixed: partial.fixed } : {}),
    ...(partial.travelMinutes !== undefined ? { travelMinutes: partial.travelMinutes } : {}),
  };
}

export function createPlace(name: string, mapQuery?: string): Place {
  return { id: createId('place'), name, mapQuery: mapQuery ?? name };
}

export function createDatePack(input: {
  title: string;
  date?: string;
  outingConditions?: OutingConditions;
  availableFrom?: LocalPoint;
  mustEndBy?: LocalPoint;
}): OutingDatePack {
  const plan: DatePlan = {
    id: createId('plan'),
    title: input.title,
    date: input.date,
    outingConditions: input.outingConditions,
    availableFrom: input.availableFrom,
    mustEndBy: input.mustEndBy,
    events: [],
    places: [],
    candidates: [],
  };
  return {
    id: plan.id,
    kind: 'outing',
    meta: {
      title: plan.title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    manifest: makeManifest(),
    plan,
    originalPlan: structuredClone(plan),
    experiences: [],
    revision: 0,
    assets: [],
  };
}

/** @deprecated In v3, event order is explicit and independent of its timing. */
export function sortEventsByStart(events: DateEvent[]): DateEvent[] {
  return sortEventsByOrder(events);
}

export function sortEventsByOrder(events: DateEvent[]): DateEvent[] {
  return [...events].sort((a, b) => a.order - b.order);
}

/** A standalone collection starts with real content, never an empty plan wrapper. */
export function createMemoriesPack(
  experiences: Experience[],
  assets: MemoriesDatePack['assets'] = [],
): MemoriesDatePack {
  return {
    id: createId('memories'),
    kind: 'memories',
    manifest: makeManifest(),
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    experiences: structuredClone(experiences),
    revision: 0,
    assets: structuredClone(assets),
  };
}
