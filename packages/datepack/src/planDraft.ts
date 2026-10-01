import type {
  DateEventType,
  OutingDatePack,
  EventTiming,
  PlanConstraints,
  ProtectedField,
} from './types';
import { DATE_EVENT_TYPES } from './types';
import { createEvent, createPlace } from './create';
import { makeManifest } from './schema';
import { extractJsonObject } from './json';
import { createId } from './utils/id';
import { isValidTime, isValidDateISO, isValidTiming, normalizeTime } from './utils/time';
import type { DatePackIssue } from './i18n/core';

/**
 * A plan authored by an external AI ("datepack.plan" JSON) before it becomes a
 * DatePack. Human-readable values only — the app assigns all ids and links
 * places by name, so the AI never has to invent identifiers.
 */
export type PlanDraftEvent = {
  title: string;
  start?: string; // Legacy HH:mm; omit when undecided
  end?: string; // HH:mm
  timing?: EventTiming;
  estimatedDurationMinutes?: number;
  protectedFields?: ProtectedField[];
  type?: DateEventType;
  /** Exact place name as it is searchable on real maps. */
  place?: string;
  note?: string;
  travelMinutes?: number;
};

export type PlanDraft = {
  title: string;
  date?: string; // YYYY-MM-DD; omitted for an undated plan
  memo?: string;
  constraints?: PlanConstraints;
  events: PlanDraftEvent[];
};

export type PlanDraftParse =
  | { ok: true; draft: PlanDraft; warnings: DatePackIssue[] }
  | { ok: false; errors: DatePackIssue[]; warnings: DatePackIssue[] };

/**
 * Parse an AI reply into a PlanDraft. Tolerates markdown code fences and
 * commentary around the JSON object — the reply is pasted as-is from a chat.
 */
export function parsePlanDraft(
  raw: string,
  options: { allowEmpty?: boolean; allowUndated?: boolean } = {},
): PlanDraftParse {
  const parsed = extractJsonObject(raw);
  if (parsed === undefined) {
    return { ok: false, errors: [{ key: 'err.planDraft.notJson' }], warnings: [] };
  }
  return validatePlanDraft(parsed, options.allowEmpty === true, options.allowUndated === true);
}

function validatePlanDraft(
  raw: unknown,
  allowEmpty: boolean,
  allowUndated: boolean,
): PlanDraftParse {
  const warnings: DatePackIssue[] = [];
  const errors: DatePackIssue[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ key: 'err.planDraft.notJson' }], warnings };
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownFields(
    obj,
    ['type', 'version', 'title', 'date', 'memo', 'constraints', 'events'],
    '',
    errors,
  );
  if (obj.type !== 'datepack.plan') {
    errors.push({ key: 'err.planDraft.wrongType', params: { value: String(obj.type) } });
  }
  if (obj.version !== 1) {
    errors.push({ key: 'err.planDraft.badVersion', params: { value: String(obj.version) } });
  }
  if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
    errors.push({ key: 'err.planDraft.noTitle' });
  }
  const dateMissing = obj.date === undefined || obj.date === null || obj.date === '';
  if (dateMissing ? !allowUndated : typeof obj.date !== 'string' || !isValidDateISO(obj.date)) {
    errors.push({ key: 'err.planDraft.badDate' });
  }
  if (!Array.isArray(obj.events)) {
    errors.push({ key: 'err.planDraft.eventsArray' });
    return { ok: false, errors, warnings };
  }
  if (obj.events.length === 0 && !allowEmpty) {
    errors.push({ key: 'err.planDraft.noEvents' });
  }
  if (obj.memo !== undefined && obj.memo !== null && typeof obj.memo !== 'string') {
    errors.push({ key: 'err.planDraft.memo' });
  }

  const constraints = validateConstraints(obj.constraints);
  if (constraints === false) errors.push({ key: 'err.planDraft.constraints' });

  obj.events.forEach((event, index) => {
    if (typeof event !== 'object' || event === null || Array.isArray(event)) {
      errors.push({ key: 'err.planDraft.eventTitle', params: { index } });
      return;
    }
    const e = event as Record<string, unknown>;
    rejectUnknownFields(
      e,
      [
        'title',
        'start',
        'end',
        'timing',
        'type',
        'place',
        'note',
        'travelMinutes',
        'estimatedDurationMinutes',
        'protectedFields',
      ],
      `events[${index}].`,
      errors,
    );
    if (typeof e.title !== 'string' || e.title.trim().length === 0) {
      errors.push({ key: 'err.planDraft.eventTitle', params: { index } });
    }
    if (e.start !== undefined && !isValidTime(e.start as string)) {
      errors.push({ key: 'err.planDraft.startInvalid', params: { index } });
    }
    if (e.end !== undefined && e.end !== null && !isValidTime(e.end as string)) {
      errors.push({ key: 'err.planDraft.endInvalid', params: { index } });
    }
    if (e.timing !== undefined) {
      if (!isValidTiming(e.timing) || !hasSupportedTimingFields(e.timing)) {
        errors.push({ key: 'err.planDraft.timingInvalid', params: { index } });
      } else {
        for (const field of ['start', 'end'] as const) {
          if (e[field] === undefined || e[field] === null) continue;
          if (
            e.timing.kind !== 'exact' ||
            !e.timing[field] ||
            !isValidTime(e[field] as string) ||
            normalizeTime(e[field] as string) !== normalizeTime(e.timing[field]!.time)
          )
            errors.push({ key: 'err.planDraft.timingInvalid', params: { index } });
        }
      }
    } else if (e.end != null && e.start === undefined) {
      errors.push({ key: 'err.planDraft.timingInvalid', params: { index } });
    } else if (
      isValidTime(e.start as string) &&
      isValidTime(e.end as string) &&
      !isValidTiming({
        kind: 'exact',
        start: { dayOffset: 0, time: e.start },
        end: { dayOffset: 0, time: e.end },
      })
    ) {
      errors.push({ key: 'err.planDraft.timingInvalid', params: { index } });
    }
    if (e.note !== undefined && e.note !== null && typeof e.note !== 'string') {
      errors.push({ key: 'err.planDraft.note', params: { index } });
    }
    if (
      e.estimatedDurationMinutes !== undefined &&
      (typeof e.estimatedDurationMinutes !== 'number' ||
        !Number.isFinite(e.estimatedDurationMinutes) ||
        e.estimatedDurationMinutes < 0)
    ) {
      errors.push({ key: 'err.planDraft.durationInvalid', params: { index } });
    }
    if (
      e.protectedFields !== undefined &&
      (!Array.isArray(e.protectedFields) ||
        e.protectedFields.some(
          (field) => !['time', 'place', 'content', 'delete', 'order'].includes(field),
        ))
    ) {
      errors.push({ key: 'err.planDraft.protectionInvalid', params: { index } });
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
      ...(typeof obj.date === 'string' && obj.date ? { date: obj.date } : {}),
      memo: typeof obj.memo === 'string' && obj.memo.trim() ? obj.memo.trim() : undefined,
      constraints: constraints || undefined,
      events: obj.events.map((event) => eventFromRaw(event as Record<string, unknown>)),
    },
  };
}

function eventFromRaw(e: Record<string, unknown>): PlanDraftEvent {
  const out: PlanDraftEvent = { title: (e.title as string).trim() };
  if (typeof e.start === 'string') out.start = normalizeTime(e.start);
  if (typeof e.end === 'string' && e.end.trim()) out.end = normalizeTime(e.end);
  if (isValidTiming(e.timing)) out.timing = normalizeTiming(e.timing);
  if (typeof e.estimatedDurationMinutes === 'number')
    out.estimatedDurationMinutes = e.estimatedDurationMinutes;
  if (Array.isArray(e.protectedFields))
    out.protectedFields = [...e.protectedFields] as ProtectedField[];
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
  if (typeof raw !== 'object' || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).some((key) => !['must', 'prefer', 'avoid'].includes(key))) return false;
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

function rejectUnknownFields(
  obj: Record<string, unknown>,
  allowed: string[],
  prefix: string,
  errors: DatePackIssue[],
): void {
  for (const field of Object.keys(obj)) {
    if (!allowed.includes(field))
      errors.push({
        key: 'err.planDraft.unsupportedField',
        params: { field: `${prefix}${field}` },
      });
  }
}

function hasSupportedTimingFields(timing: EventTiming): boolean {
  const allowed =
    timing.kind === 'exact'
      ? ['kind', 'start', 'end']
      : timing.kind === 'window'
        ? ['kind', 'earliestStart', 'latestStart']
        : ['kind', 'label'];
  if (Object.keys(timing).some((key) => !allowed.includes(key))) return false;
  const points =
    timing.kind === 'exact'
      ? [timing.start, timing.end]
      : timing.kind === 'window'
        ? [timing.earliestStart, timing.latestStart]
        : [];
  return points.every(
    (point) => !point || Object.keys(point).every((key) => ['dayOffset', 'time'].includes(key)),
  );
}

function normalizeTiming(timing: EventTiming): EventTiming {
  if (timing.kind === 'unscheduled') return { ...timing };
  if (timing.kind === 'exact')
    return {
      kind: 'exact',
      start: { ...timing.start, time: normalizeTime(timing.start.time) },
      ...(timing.end ? { end: { ...timing.end, time: normalizeTime(timing.end.time) } } : {}),
    };
  return {
    kind: 'window',
    earliestStart: { ...timing.earliestStart, time: normalizeTime(timing.earliestStart.time) },
    latestStart: { ...timing.latestStart, time: normalizeTime(timing.latestStart.time) },
  };
}

/** Turn a validated draft into a full OutingDatePack, preserving the AI's explicit array order. */
export function buildPlanFromDraft(draft: PlanDraft): OutingDatePack {
  const places = new Map<string, ReturnType<typeof createPlace>>();
  const events = draft.events.map((event, order) => {
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
      order,
      title: event.title,
      start: event.start,
      end: event.end,
      timing: event.timing,
      estimatedDurationMinutes: event.estimatedDurationMinutes,
      protectedFields: event.protectedFields,
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
    events,
    places: [...places.values()],
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
