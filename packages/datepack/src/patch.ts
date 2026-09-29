import type { DatePackPatch, DatePackPatchNewEvent, DatePlan, DateEvent } from './types';
import { validatePatch } from './validate';
import { createEvent, createPlace } from './create';
import { extractJsonObject } from './json';
import { isValidTime, normalizeTime, parseTime } from './utils/time';
import type { DatePackIssue } from './i18n/core';
import { findIntroducedPlanConflicts, findPlanConflicts } from './consistency';

export type PatchParseResult =
  | { ok: true; patch: DatePackPatch; warnings: DatePackIssue[] }
  | { ok: false; errors: DatePackIssue[]; warnings: DatePackIssue[] };

export function parsePatch(raw: string): PatchParseResult {
  const parsed = extractJsonObject(raw);
  if (parsed === undefined) {
    return { ok: false, errors: [{ key: 'err.patch.notJson' }], warnings: [] };
  }
  const result = validatePatch(parsed);
  if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings };
  return { ok: true, patch: result.patch, warnings: result.warnings };
}

/** One field-level edit inside a replace, as renderable data (no copy — the UI localizes). */
export type PatchChangeDetail = {
  field:
    | 'start'
    | 'end'
    | 'title'
    | 'type'
    | 'note'
    | 'travelMinutes'
    | 'fixedOn'
    | 'fixedOff'
    | 'other';
  from?: string;
  to?: string;
};

export type PatchChange =
  | { op: 'replace'; target: string; title: string; fixed?: boolean; details: PatchChangeDetail[] }
  | {
      op: 'move';
      target: string;
      title: string;
      fixed?: boolean;
      from?: string;
      to?: string;
      fromEnd?: string;
      toEnd?: string;
    }
  | { op: 'remove'; target: string; title: string; fixed?: boolean }
  | {
      op: 'insertBefore' | 'insertAfter';
      target: string;
      title: string;
      fixed?: boolean;
      newTitle: string;
      newStart: string;
      newPlace?: string;
    };

export type PatchOutcome = {
  plan: DatePlan;
  /** Complete prepared plan; false means the original plan was preserved. */
  canApply: boolean;
  conflicts: DatePackIssue[];
  newConflicts: DatePackIssue[];
  /** Human-renderable list of what changed — the UI localizes these. */
  applied: PatchChange[];
  /**
   * Operations that could not safely apply. Any skipped operation blocks the
   * whole patch so a partial proposal can never be committed.
   */
  skipped: DatePackIssue[];
};

/** Prepare a complete patch result on a clone, without mutating the input. */
export function describePatch(plan: DatePlan, patch: DatePackPatch): PatchOutcome {
  const next: DatePlan = structuredClone(plan);
  const protectedIds = new Set(
    plan.events
      .filter((event) => event.fixed || event.protectedFields?.includes('order'))
      .map((e) => e.id),
  );
  const applied: PatchChange[] = [];
  const skipped: DatePackIssue[] = [];

  for (const op of patch.operations) {
    const targetId = op.target.startsWith('event:') ? op.target.slice(6) : op.target;
    // Tolerate the common "event-<id>" id style when the AI writes "event:<id>".
    const index = next.events.findIndex((e) => e.id === targetId || e.id === `event-${targetId}`);

    switch (op.op) {
      case 'replace': {
        const event = next.events[index];
        if (!event) {
          skipped.push({ key: 'err.patch.unknownTarget', params: { target: op.target } });
          break;
        }
        const { value } = op;
        const protectedFields = Object.keys(value).some(
          (key) => key !== 'fixed' && isFieldProtected(event, key),
        );
        if (
          protectedFields ||
          (value.fixed === false && (event.fixed || (event.protectedFields?.length ?? 0) > 0))
        ) {
          skipped.push({ key: 'err.patch.protected', params: { title: event.title } });
          break;
        }
        const record = event as unknown as Record<string, unknown>;
        const details: PatchChangeDetail[] = [];
        for (const [key, newValue] of Object.entries(value)) {
          if (newValue === undefined || newValue === null) continue;
          details.push(detailFor(key, record[key], displayValue(key, newValue)));
        }
        Object.assign(event, sanitizeReplaceValue(value));
        if (value.fixed === true)
          event.protectedFields = ['time', 'place', 'content', 'delete', 'order'];
        syncTimingFromAliases(event, value.end !== undefined);
        if (details.length > 0)
          applied.push({
            op: 'replace',
            target: event.id,
            title: event.title,
            fixed: event.fixed === true,
            details,
          });
        break;
      }
      case 'move': {
        const event = next.events[index];
        if (!event) {
          skipped.push({ key: 'err.patch.unknownTarget', params: { target: op.target } });
          break;
        }
        if (isFieldProtected(event, 'start')) {
          skipped.push({ key: 'err.patch.protected', params: { title: event.title } });
          break;
        }
        const start = isValidTime(op.value.start) ? normalizeTime(op.value.start) : op.value.start;
        const end = isValidTime(op.value.end) ? normalizeTime(op.value.end) : op.value.end;
        const change: PatchChange = {
          op: 'move',
          target: event.id,
          title: event.title,
          fixed: event.fixed === true,
          from: start ? event.start : undefined,
          to: start,
          fromEnd: end !== undefined ? event.end : undefined,
          toEnd: end !== undefined ? end || undefined : undefined,
        };
        if (start) event.start = start;
        if (end !== undefined) event.end = end || undefined;
        syncTimingFromAliases(event, op.value.end !== undefined);
        applied.push(change);
        break;
      }
      case 'remove': {
        const event = next.events[index];
        if (!event) {
          skipped.push({ key: 'err.patch.unknownTarget', params: { target: op.target } });
          break;
        }
        if (
          (event.fixed && !event.protectedFields?.length) ||
          event.protectedFields?.includes('delete')
        ) {
          skipped.push({ key: 'err.patch.protected', params: { title: event.title } });
          break;
        }
        next.events.splice(index, 1);
        applied.push({
          op: 'remove',
          target: event.id,
          title: event.title,
          fixed: event.fixed === true,
        });
        break;
      }
      case 'insertBefore':
      case 'insertAfter': {
        const event = next.events[index];
        if (!event) {
          skipped.push({ key: 'err.patch.noAnchor', params: { target: op.target } });
          break;
        }
        const created = createEventFromPatchValue(op.value, next);
        next.events.splice(op.op === 'insertBefore' ? index : index + 1, 0, created);
        applied.push({
          op: op.op,
          target: event.id,
          title: event.title,
          newTitle: created.title,
          newStart: created.start ?? '',
          ...(op.value.place ? { newPlace: op.value.place.trim() } : {}),
        });
        break;
      }
    }
  }

  next.events.forEach((event, order) => {
    event.order = order;
  });

  // Moving another item across a protected event also changes its order.
  const originalOrder = plan.events.map((event) => event.id);
  const proposedOrder = next.events.map((event) => event.id);
  const originalIds = new Set(originalOrder);
  const changedProtectedOrder = [...protectedIds].some((protectedId) => {
    for (const otherId of originalIds) {
      if (otherId === protectedId || !proposedOrder.includes(otherId)) continue;
      if (
        originalOrder.indexOf(protectedId) < originalOrder.indexOf(otherId) !==
        proposedOrder.indexOf(protectedId) < proposedOrder.indexOf(otherId)
      )
        return true;
    }
    return false;
  });
  if (changedProtectedOrder) skipped.push({ key: 'err.patch.protectedOrder' });

  const canApply = skipped.length === 0 && applied.length > 0;
  if (!canApply) {
    return {
      plan: structuredClone(plan),
      applied,
      skipped,
      canApply,
      conflicts: [],
      newConflicts: [],
    };
  }
  const conflicts = findPlanConflicts(next);
  const newConflicts = findIntroducedPlanConflicts(plan, next);
  return { plan: next, applied, skipped, canApply, conflicts, newConflicts };
}

/** Applying returns the same prepared clone as preview. */
export function applyPatch(
  plan: DatePlan,
  patch: DatePackPatch,
  _options: { dryRun?: boolean } = {},
): PatchOutcome {
  return describePatch(plan, patch);
}

function createEventFromPatchValue(value: DatePackPatchNewEvent, plan: DatePlan): DateEvent {
  let placeId = value.placeId;
  if (value.place?.trim()) {
    const name = value.place.trim();
    const existing = plan.places?.find(
      (place) => place.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (existing) placeId = existing.id;
    else {
      const place = createPlace(name, name);
      plan.places = [...(plan.places ?? []), place];
      placeId = place.id;
    }
  }
  return createEvent({
    title: value.title,
    start: normalizeTime(value.start),
    end: value.end !== undefined && isValidTime(value.end) ? normalizeTime(value.end) : undefined,
    type: value.type ?? 'place',
    note: value.note,
    placeId,
    travelMinutes: value.travelMinutes,
  });
}

/** Times arrive as "9:30" as often as "09:30" — preview the canonical form. */
function displayValue(key: string, value: unknown): unknown {
  if ((key === 'start' || key === 'end') && typeof value === 'string' && isValidTime(value)) {
    return normalizeTime(value);
  }
  return value;
}

function detailFor(key: string, oldValue: unknown, newValue: unknown): PatchChangeDetail {
  switch (key) {
    case 'start':
      return { field: 'start', from: String(oldValue ?? ''), to: String(newValue) };
    case 'end':
      return { field: 'end', from: String(oldValue ?? ''), to: String(newValue) };
    case 'title':
      return { field: 'title', from: String(oldValue ?? ''), to: String(newValue) };
    case 'type':
      return { field: 'type', from: String(oldValue ?? ''), to: String(newValue) };
    case 'note':
      return { field: 'note' };
    case 'travelMinutes':
      return { field: 'travelMinutes', from: String(oldValue ?? ''), to: String(newValue) };
    case 'fixed':
      return { field: newValue === true ? 'fixedOn' : 'fixedOff' };
    default:
      return { field: 'other', from: undefined, to: String(newValue) };
  }
}

function isFieldProtected(event: DateEvent, key: string): boolean {
  if (event.fixed && !event.protectedFields?.length) return true;
  const field = key === 'start' || key === 'end' ? 'time' : key === 'placeId' ? 'place' : 'content';
  return event.protectedFields?.includes(field) ?? false;
}

function syncTimingFromAliases(event: DateEvent, changedEnd = false): void {
  if (!event.start || !isValidTime(event.start)) return;
  const previous = event.timing.kind === 'exact' ? event.timing : undefined;
  const startOffset = previous?.start.dayOffset ?? 0;
  const endOffset = previous?.end?.dayOffset ?? startOffset;
  const endTime = event.end && isValidTime(event.end) ? normalizeTime(event.end) : undefined;
  const safeEndOffset =
    changedEnd &&
    endTime &&
    endOffset === startOffset &&
    (parseTime(endTime) ?? 0) < (parseTime(event.start) ?? 0)
      ? (Math.min(1, startOffset + 1) as 0 | 1)
      : endOffset;
  event.timing = {
    kind: 'exact',
    start: { dayOffset: startOffset, time: normalizeTime(event.start) },
    ...(endTime ? { end: { dayOffset: safeEndOffset, time: endTime } } : {}),
  };
}

function sanitizeReplaceValue(value: Record<string, unknown>): Partial<DateEvent> {
  const out: Partial<DateEvent> = {};
  const keys: Array<keyof DateEvent> = [
    'title',
    'start',
    'end',
    'type',
    'note',
    'travelMinutes',
    'placeId',
    'fixed',
  ];
  for (const key of keys) {
    const v = value[key];
    if (v === undefined || v === null) continue;
    if ((key === 'start' || key === 'end') && isValidTime(String(v))) {
      (out as Record<string, unknown>)[key] = normalizeTime(String(v));
      continue;
    }
    (out as Record<string, unknown>)[key] = v;
  }
  return out;
}
