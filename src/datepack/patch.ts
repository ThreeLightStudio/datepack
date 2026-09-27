import type { DatePackPatch, DatePackPatchNewEvent, DatePlan, DateEvent } from './types';
import { validatePatch } from './validate';
import { createEvent } from './create';
import type { I18nIssue } from '../i18n/core';

export type PatchParseResult =
  | { ok: true; patch: DatePackPatch; warnings: I18nIssue[] }
  | { ok: false; errors: I18nIssue[]; warnings: I18nIssue[] };

export function parsePatch(raw: string): PatchParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          key: 'err.patch.badJson',
          params: { detail: error instanceof Error ? error.message : String(error) },
        },
      ],
      warnings: [],
    };
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
  | { op: 'replace'; target: string; title: string; details: PatchChangeDetail[] }
  | {
      op: 'move';
      target: string;
      title: string;
      from?: string;
      to?: string;
      fromEnd?: string;
      toEnd?: string;
    }
  | { op: 'remove'; target: string; title: string }
  | {
      op: 'insertBefore' | 'insertAfter';
      target: string;
      title: string;
      newTitle: string;
      newStart: string;
    };

export type PatchOutcome = {
  plan: DatePlan;
  /** Human-renderable list of what changed — the UI localizes these. */
  applied: PatchChange[];
  /** Operations that could not be applied (e.g. unknown target). */
  errors: I18nIssue[];
};

/** Preview what a patch would change, without mutating anything. */
export function describePatch(plan: DatePlan, patch: DatePackPatch): PatchOutcome {
  return applyPatch(plan, patch, { dryRun: true });
}

/** Apply a validated patch to a plan. Returns a new plan; the input is not mutated. */
export function applyPatch(
  plan: DatePlan,
  patch: DatePackPatch,
  options: { dryRun?: boolean } = {},
): PatchOutcome {
  const next: DatePlan = options.dryRun ? plan : structuredClone(plan);
  const applied: PatchChange[] = [];
  const errors: I18nIssue[] = [];

  for (const op of patch.operations) {
    const targetId = op.target.startsWith('event:') ? op.target.slice(6) : op.target;
    // Tolerate the common "event-<id>" id style when the AI writes "event:<id>".
    const index = next.events.findIndex((e) => e.id === targetId || e.id === `event-${targetId}`);

    switch (op.op) {
      case 'replace': {
        const event = next.events[index];
        if (!event) {
          errors.push({ key: 'err.patch.unknownTarget', params: { target: op.target } });
          break;
        }
        const { value } = op;
        const record = event as unknown as Record<string, unknown>;
        const details: PatchChangeDetail[] = [];
        for (const [key, newValue] of Object.entries(value)) {
          if (newValue === undefined || newValue === null) continue;
          details.push(detailFor(key, record[key], newValue));
        }
        if (!options.dryRun) Object.assign(event, sanitizeReplaceValue(value));
        if (details.length > 0)
          applied.push({ op: 'replace', target: event.id, title: event.title, details });
        break;
      }
      case 'move': {
        const event = next.events[index];
        if (!event) {
          errors.push({ key: 'err.patch.unknownTarget', params: { target: op.target } });
          break;
        }
        const { start, end } = op.value;
        const change: PatchChange = {
          op: 'move',
          target: event.id,
          title: event.title,
          from: start ? event.start : undefined,
          to: start,
          fromEnd: end !== undefined ? event.end : undefined,
          toEnd: end !== undefined ? end || undefined : undefined,
        };
        if (!options.dryRun) {
          if (start) event.start = start;
          if (end !== undefined) event.end = end || undefined;
        }
        applied.push(change);
        break;
      }
      case 'remove': {
        const event = next.events[index];
        if (!event) {
          errors.push({ key: 'err.patch.unknownTarget', params: { target: op.target } });
          break;
        }
        if (!options.dryRun) next.events.splice(index, 1);
        applied.push({ op: 'remove', target: event.id, title: event.title });
        break;
      }
      case 'insertBefore':
      case 'insertAfter': {
        const event = next.events[index];
        if (!event) {
          errors.push({ key: 'err.patch.noAnchor', params: { target: op.target } });
          break;
        }
        const created = createEventFromPatchValue(op.value);
        if (!options.dryRun) {
          next.events.splice(op.op === 'insertBefore' ? index : index + 1, 0, created);
        }
        applied.push({
          op: op.op,
          target: event.id,
          title: event.title,
          newTitle: created.title,
          newStart: created.start,
        });
        break;
      }
    }
  }

  return { plan: next, applied, errors };
}

function createEventFromPatchValue(value: DatePackPatchNewEvent): DateEvent {
  return createEvent({
    title: value.title,
    start: value.start,
    end: value.end,
    type: value.type ?? 'place',
    note: value.note,
    placeId: value.placeId,
    travelMinutes: value.travelMinutes,
  });
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
    if (value[key] !== undefined) {
      (out as Record<string, unknown>)[key] = value[key];
    }
  }
  return out;
}
