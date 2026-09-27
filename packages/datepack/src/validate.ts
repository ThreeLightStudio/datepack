import type { DateEvent, DatePack, DatePackPatch, DatePlan } from './types';
import { DATE_EVENT_TYPES } from './types';
import { isValidTime, isValidDateISO } from './utils/time';
import type { DatePackIssue } from './i18n/core';

export type ValidationResult = { ok: boolean; errors: DatePackIssue[]; warnings: DatePackIssue[] };

function ok(warnings: DatePackIssue[] = []): ValidationResult {
  return { ok: true, errors: [], warnings };
}

function fail(errors: DatePackIssue[], warnings: DatePackIssue[] = []): ValidationResult {
  return { ok: false, errors, warnings };
}

export function validatePlan(plan: unknown): ValidationResult {
  if (typeof plan !== 'object' || plan === null) {
    return fail([{ key: 'err.read.badPlan' }]);
  }
  const p = plan as Partial<DatePlan>;
  const errors: DatePackIssue[] = [];

  if (typeof p.id !== 'string' || p.id.length === 0) errors.push({ key: 'err.plan.noId' });
  if (typeof p.title !== 'string' || p.title.trim().length === 0)
    errors.push({ key: 'err.plan.noTitle' });
  if (typeof p.date !== 'string' || !isValidDateISO(p.date))
    errors.push({ key: 'err.plan.badDate' });
  if (!Array.isArray(p.events)) {
    errors.push({ key: 'err.plan.eventsArray' });
    return fail(errors);
  }

  const seenIds = new Set<string>();
  p.events.forEach((event, index) => {
    if (typeof event?.id !== 'string' || event.id.length === 0) {
      errors.push({ key: 'err.plan.eventId', params: { index } });
    } else if (seenIds.has(event.id)) {
      errors.push({ key: 'err.plan.dupId', params: { index, id: event.id } });
    } else {
      seenIds.add(event.id);
    }
    if (!isValidTime(event?.start)) {
      errors.push({ key: 'err.plan.startInvalid', params: { index } });
    }
    if (typeof event?.title !== 'string' || event.title.trim().length === 0) {
      errors.push({ key: 'err.plan.eventTitle', params: { index } });
    }
    if (event?.type === undefined || event?.type === null) {
      // Required since 1.0 readers render type-driven icons; a missing type would crash.
      errors.push({ key: 'err.plan.typeRequired', params: { index } });
    } else if (!(DATE_EVENT_TYPES as readonly string[]).includes(event.type)) {
      errors.push({ key: 'err.plan.typeInvalid', params: { index, value: String(event.type) } });
    }
    if (event?.end !== undefined && event.end !== null && !isValidTime(event.end)) {
      errors.push({ key: 'err.plan.endInvalid', params: { index } });
    }
    if (event?.planB !== undefined && event.planB !== null) {
      if (typeof event.planB.title !== 'string' || event.planB.title.trim().length === 0) {
        errors.push({ key: 'err.plan.planBTitle', params: { index } });
      }
    }
    if (event?.travelMinutes !== undefined && event.travelMinutes !== null) {
      if (
        typeof event.travelMinutes !== 'number' ||
        !Number.isFinite(event.travelMinutes) ||
        event.travelMinutes < 0
      ) {
        errors.push({ key: 'err.plan.travelInvalid', params: { index } });
      }
    }
    if (event?.assetIds !== undefined && !Array.isArray(event.assetIds)) {
      errors.push({ key: 'err.plan.assetIds', params: { index } });
    }
  });

  if (p.places !== undefined && !Array.isArray(p.places)) {
    errors.push({ key: 'err.plan.placesArray' });
  }

  return errors.length > 0 ? fail(errors) : ok();
}

export function validateDatePack(pack: DatePack): ValidationResult {
  const planResult = validatePlan(pack.plan);
  if (!planResult.ok) return planResult;

  const warnings: DatePackIssue[] = [];
  const errors: DatePackIssue[] = [];
  if (typeof pack.manifest?.version !== 'string') {
    errors.push({ key: 'err.plan.manifestVersion' });
  }

  // Referenced assets should exist in the pack (missing → warning, not fatal).
  const assetIds = new Set(pack.assets.map((a) => a.id));
  const referenced: string[] = [];
  if (pack.plan.coverAssetId) referenced.push(pack.plan.coverAssetId);
  for (const id of pack.plan.galleryAssetIds ?? []) referenced.push(id);
  for (const event of pack.plan.events) for (const id of event.assetIds ?? []) referenced.push(id);
  for (const id of referenced) {
    if (!assetIds.has(id)) warnings.push({ key: 'err.plan.assetMissing', params: { id } });
  }

  return errors.length > 0 ? fail(errors, warnings) : ok(warnings);
}

// ---------------------------------------------------------------------------
// Patch validation
// ---------------------------------------------------------------------------

const PATCH_OPS = ['replace', 'move', 'remove', 'insertBefore', 'insertAfter'] as const;

export type PatchValidation =
  | { ok: true; patch: DatePackPatch; warnings: DatePackIssue[] }
  | { ok: false; patch: null; errors: DatePackIssue[]; warnings: DatePackIssue[] };

export function validatePatch(raw: unknown): PatchValidation {
  const warnings: DatePackIssue[] = [];
  const errors: DatePackIssue[] = [];

  if (typeof raw !== 'object' || raw === null) {
    errors.push({ key: 'err.patch.notJson' });
    return { ok: false, patch: null, errors, warnings };
  }
  const obj = raw as Partial<DatePackPatch>;
  if (obj.type !== 'datepack.patch') {
    errors.push({ key: 'err.patch.wrongType', params: { value: String(obj.type) } });
  }
  if (obj.version !== 1) {
    errors.push({ key: 'err.patch.badVersion', params: { value: String(obj.version) } });
  }
  if (!Array.isArray(obj.operations)) {
    errors.push({ key: 'err.patch.opsArray' });
    return { ok: false, patch: null, errors, warnings };
  }

  obj.operations.forEach((op, index) => {
    if (typeof op !== 'object' || op === null || !('op' in op)) {
      errors.push({ key: 'err.patch.notOperation', params: { index } });
      return;
    }
    if (!(PATCH_OPS as readonly string[]).includes(op.op)) {
      errors.push({
        key: 'err.patch.unknownOp',
        params: { index, value: String((op as { op: unknown }).op) },
      });
      return;
    }
    if (typeof op.target !== 'string' || op.target.length === 0) {
      errors.push({ key: 'err.patch.noTarget', params: { index } });
    }
    if (op.op === 'remove') return;

    const value = (op as { value?: unknown }).value;
    if (typeof value !== 'object' || value === null) {
      errors.push({ key: 'err.patch.noValue', params: { index } });
      return;
    }
    const v = value as Record<string, unknown>;
    if (op.op === 'insertBefore' || op.op === 'insertAfter') {
      if (typeof v.title !== 'string' || v.title.trim().length === 0) {
        errors.push({ key: 'err.patch.needTitle', params: { index } });
      }
      if (!isValidTime(typeof v.start === 'string' ? v.start : undefined)) {
        errors.push({ key: 'err.patch.needStart', params: { index } });
      }
      if (v.end !== undefined && v.end !== null && !isValidTime(v.end as string)) {
        errors.push({ key: 'err.patch.badTime', params: { index, field: 'end' } });
      }
      if (
        v.type !== undefined &&
        !(DATE_EVENT_TYPES as readonly string[]).includes(v.type as string)
      ) {
        errors.push({ key: 'err.patch.badType', params: { index, value: String(v.type) } });
      }
      return;
    }
    // replace / move: any provided time fields must be valid
    for (const field of ['start', 'end'] as const) {
      if (v[field] !== undefined && v[field] !== null && !isValidTime(v[field] as string)) {
        errors.push({ key: 'err.patch.badTime', params: { index, field } });
      }
    }
    if (op.op === 'replace') {
      if (Object.keys(v).length === 0) {
        warnings.push({ key: 'err.patch.emptyReplace', params: { index } });
      }
      if (v.fixed !== undefined && typeof v.fixed !== 'boolean') {
        errors.push({ key: 'err.patch.badFixed', params: { index } });
      }
      if (
        v.type !== undefined &&
        v.type !== null &&
        !(DATE_EVENT_TYPES as readonly string[]).includes(v.type as string)
      ) {
        errors.push({ key: 'err.patch.badType', params: { index, value: String(v.type) } });
      }
      if (
        v.travelMinutes !== undefined &&
        v.travelMinutes !== null &&
        (typeof v.travelMinutes !== 'number' ||
          !Number.isFinite(v.travelMinutes) ||
          v.travelMinutes < 0)
      ) {
        errors.push({ key: 'err.patch.badTravel', params: { index } });
      }
    }
  });

  if (errors.length > 0) {
    return { ok: false, patch: null, errors, warnings };
  }
  return { ok: true, patch: obj as DatePackPatch, warnings };
}

export function normalizeTarget(target: string): string {
  return target.startsWith('event:') ? target.slice('event:'.length) : target;
}

export function findEvent(plan: DatePlan, eventId: string): DateEvent | undefined {
  const bare = normalizeTarget(eventId);
  return plan.events.find((e) => e.id === eventId || e.id === bare || e.id === `event-${bare}`);
}
