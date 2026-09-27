import type { DateEventType, DatePack, PlanConstraints } from './types';
import { DATE_EVENT_TYPES } from './types';
import { createEvent, createPlace, sortEventsByStart } from './create';
import { makeManifest } from './schema';
import { extractJsonObject } from './json';
import { createId } from '../utils/id';
import { isValidTime, isValidDateISO, normalizeTime } from '../utils/time';
import type { I18nIssue } from '../i18n/core';

/**
 * A plan authored by an external AI ("datepack.plan" JSON) before it becomes a
 * DatePack. Human-readable values only — the app assigns all ids and links
 * places by name, so the AI never has to invent identifiers.
 */
export type PlanDraftEvent = {
  title: string;
  start: string; // HH:mm
  end?: string; // HH:mm
  type?: DateEventType;
  /** Exact place name as it is searchable on real maps. */
  place?: string;
  note?: string;
  travelMinutes?: number;
};

export type PlanDraft = {
  title: string;
  date: string; // YYYY-MM-DD
  memo?: string;
  constraints?: PlanConstraints;
  events: PlanDraftEvent[];
};

export type PlanDraftParse =
  | { ok: true; draft: PlanDraft; warnings: I18nIssue[] }
  | { ok: false; errors: I18nIssue[]; warnings: I18nIssue[] };

/**
 * Parse an AI reply into a PlanDraft. Tolerates markdown code fences and
 * commentary around the JSON object — the reply is pasted as-is from a chat.
 */
export function parsePlanDraft(raw: string): PlanDraftParse {
  const parsed = extractJsonObject(raw);
  if (parsed === undefined) {
    return { ok: false, errors: [{ key: 'err.planDraft.notJson' }], warnings: [] };
  }
  return validatePlanDraft(parsed);
}

function validatePlanDraft(raw: unknown): PlanDraftParse {
  const warnings: I18nIssue[] = [];
  const errors: I18nIssue[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: [{ key: 'err.planDraft.notJson' }], warnings };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.type !== 'datepack.plan') {
    errors.push({ key: 'err.planDraft.wrongType', params: { value: String(obj.type) } });
  }
  if (obj.version !== 1) {
    errors.push({ key: 'err.planDraft.badVersion', params: { value: String(obj.version) } });
  }
  if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
    errors.push({ key: 'err.planDraft.noTitle' });
  }
  if (typeof obj.date !== 'string' || !isValidDateISO(obj.date)) {
    errors.push({ key: 'err.planDraft.badDate' });
  }
  if (!Array.isArray(obj.events)) {
    errors.push({ key: 'err.planDraft.eventsArray' });
    return { ok: false, errors, warnings };
  }
  if (obj.events.length === 0) {
    errors.push({ key: 'err.planDraft.noEvents' });
  }
  if (obj.memo !== undefined && obj.memo !== null && typeof obj.memo !== 'string') {
    errors.push({ key: 'err.planDraft.memo' });
  }

  const constraints = validateConstraints(obj.constraints);
  if (constraints === false) errors.push({ key: 'err.planDraft.constraints' });

  obj.events.forEach((event, index) => {
    if (typeof event !== 'object' || event === null) {
      errors.push({ key: 'err.planDraft.eventTitle', params: { index } });
      return;
    }
    const e = event as Record<string, unknown>;
    if (typeof e.title !== 'string' || e.title.trim().length === 0) {
      errors.push({ key: 'err.planDraft.eventTitle', params: { index } });
    }
    if (!isValidTime(typeof e.start === 'string' ? e.start : undefined)) {
      errors.push({ key: 'err.planDraft.startInvalid', params: { index } });
    }
    if (e.end !== undefined && e.end !== null && !isValidTime(e.end as string)) {
      errors.push({ key: 'err.planDraft.endInvalid', params: { index } });
    }
    if (
      e.type !== undefined &&
      e.type !== null &&
      !(DATE_EVENT_TYPES as readonly string[]).includes(e.type as string)
    ) {
      errors.push({ key: 'err.planDraft.typeInvalid', params: { index, value: String(e.type) } });
    }
    if (e.place !== undefined && e.place !== null && typeof e.place !== 'string') {
      errors.push({ key: 'err.planDraft.placeString', params: { index } });
    }
    if (
      e.travelMinutes !== undefined &&
      e.travelMinutes !== null &&
      (typeof e.travelMinutes !== 'number' ||
        !Number.isFinite(e.travelMinutes) ||
        e.travelMinutes < 0)
    ) {
      errors.push({ key: 'err.planDraft.travelInvalid', params: { index } });
    }
  });

  if (errors.length > 0) return { ok: false, errors, warnings };

  return {
    ok: true,
    warnings,
    draft: {
      title: (obj.title as string).trim(),
      date: obj.date as string,
      memo: typeof obj.memo === 'string' && obj.memo.trim() ? obj.memo.trim() : undefined,
      constraints: constraints || undefined,
      events: obj.events.map((event) => eventFromRaw(event as Record<string, unknown>)),
    },
  };
}

function eventFromRaw(e: Record<string, unknown>): PlanDraftEvent {
  const out: PlanDraftEvent = {
    title: (e.title as string).trim(),
    start: normalizeTime(e.start as string),
  };
  if (typeof e.end === 'string' && e.end.trim()) out.end = normalizeTime(e.end);
  if (typeof e.type === 'string' && (DATE_EVENT_TYPES as readonly string[]).includes(e.type)) {
    out.type = e.type as DateEventType;
  }
  if (typeof e.place === 'string' && e.place.trim()) out.place = e.place.trim();
  if (typeof e.note === 'string' && e.note.trim()) out.note = e.note.trim();
  if (
    typeof e.travelMinutes === 'number' &&
    Number.isFinite(e.travelMinutes) &&
    e.travelMinutes >= 0
  ) {
    out.travelMinutes = e.travelMinutes;
  }
  return out;
}

function validateConstraints(raw: unknown): PlanConstraints | undefined | false {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  const out: PlanConstraints = {};
  for (const field of ['must', 'prefer', 'avoid'] as const) {
    const value = obj[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return false;
    const list = (value as string[]).map((item) => item.trim()).filter(Boolean);
    if (list.length > 0) out[field] = list;
  }
  return out;
}

/** Turn a validated draft into a full DatePack: generated ids, linked places, sorted events. */
export function buildPlanFromDraft(draft: PlanDraft): DatePack {
  const places = new Map<string, ReturnType<typeof createPlace>>();
  const events = draft.events.map((event) => {
    let placeId: string | undefined;
    if (event.place) {
      let place = places.get(event.place);
      if (!place) {
        place = createPlace(event.place);
        places.set(event.place, place);
      }
      placeId = place.id;
    }
    return createEvent({
      title: event.title,
      start: event.start,
      end: event.end,
      type: event.type ?? 'place',
      note: event.note,
      travelMinutes: event.travelMinutes,
      placeId,
    });
  });
  const plan = {
    id: createId('plan'),
    title: draft.title,
    date: draft.date,
    memo: draft.memo,
    constraints: draft.constraints,
    events: sortEventsByStart(events),
    places: [...places.values()],
  };
  return { manifest: makeManifest(), plan, assets: [] };
}
