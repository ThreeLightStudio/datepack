import type { DateEvent, DatePack, DatePlan, Place } from './types';
import { DATE_EVENT_TYPES } from './types';
import { makeManifest } from './schema';
import { createId } from './utils/id';
import { parseTime } from './utils/time';

export function createEvent(
  partial: Partial<DateEvent> & Pick<DateEvent, 'title' | 'start'>,
): DateEvent {
  const type = partial.type ?? 'place';
  return {
    id: partial.id ?? createId('event'),
    start: partial.start,
    end: partial.end,
    title: partial.title,
    type: (DATE_EVENT_TYPES as readonly string[]).includes(type) ? type : 'place',
    placeId: partial.placeId,
    note: partial.note,
    assetIds: partial.assetIds,
    travelMinutes: partial.travelMinutes,
    fixed: partial.fixed,
    planB: partial.planB,
  };
}

export function createPlace(name: string, mapQuery?: string): Place {
  return { id: createId('place'), name, mapQuery: mapQuery ?? name };
}

export function createDatePack(input: { title: string; date: string }): DatePack {
  const plan: DatePlan = {
    id: createId('plan'),
    title: input.title,
    date: input.date,
    events: [],
    places: [],
  };
  return { manifest: makeManifest(), plan, assets: [] };
}

/** Sort events by start time (stable). */
export function sortEventsByStart(events: DateEvent[]): DateEvent[] {
  return [...events].sort((a, b) => (parseTime(a.start) ?? 0) - (parseTime(b.start) ?? 0));
}
