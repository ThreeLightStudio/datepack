import type { DateEvent, DatePack, DatePackPatch, DatePlan } from './types';
import { DATE_EVENT_TYPES } from './types';
import {
  isValidTime,
  isValidDateISO,
  isValidTiming,
  isValidLocalPoint,
  localPointMinutes,
} from './utils/time';
import { isLegacyDatePlan, isV3DatePlan } from './migration';
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
  const p = plan as Partial<DatePlan> & { events?: Array<Record<string, unknown>>; date?: unknown };
  const legacy = !isV3DatePlan(plan) && isLegacyDatePlan(plan);
  const errors: DatePackIssue[] = [];

  if (typeof p.id !== 'string' || p.id.length === 0) errors.push({ key: 'err.plan.noId' });
  if (typeof p.title !== 'string' || p.title.trim().length === 0)
    errors.push({ key: 'err.plan.noTitle' });
  if (p.date !== undefined && (typeof p.date !== 'string' || !isValidDateISO(p.date)))
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
    if (legacy) {
      if (typeof event.start !== 'string' || !isValidTime(event.start))
        errors.push({ key: 'err.plan.startInvalid', params: { index } });
    } else if (!isValidTiming(event?.timing)) {
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
    if (
      legacy &&
      event?.end !== undefined &&
      event.end !== null &&
      (typeof event.end !== 'string' || !isValidTime(event.end))
    ) {
      errors.push({ key: 'err.plan.endInvalid', params: { index } });
    }
    if (event?.planB !== undefined && event.planB !== null) {
      if (typeof event.planB.title !== 'string' || event.planB.title.trim().length === 0) {
        errors.push({ key: 'err.plan.planBTitle', params: { index } });
      }
    }
    if (!isLegacyDatePlan(plan)) {
      if (!Number.isInteger(event.order) || (event.order as number) < 0)
        errors.push({ key: 'err.plan.eventId', params: { index } });
      if (
        event.importance !== undefined &&
        !['core', 'normal', 'optional'].includes(String(event.importance))
      )
        errors.push({ key: 'err.plan.eventId', params: { index } });
      if (
        event.estimatedDurationMinutes !== undefined &&
        (!Number.isFinite(event.estimatedDurationMinutes) ||
          (event.estimatedDurationMinutes as number) < 0)
      )
        errors.push({ key: 'err.plan.travelInvalid', params: { index } });
      if (
        event.protectedFields !== undefined &&
        (!Array.isArray(event.protectedFields) ||
          event.protectedFields.some(
            (f) => !['time', 'place', 'content', 'delete', 'order'].includes(String(f)),
          ))
      )
        errors.push({ key: 'err.plan.eventId', params: { index } });
    }
    if (event?.assetIds !== undefined && !Array.isArray(event.assetIds)) {
      errors.push({ key: 'err.plan.assetIds', params: { index } });
    }
  });

  if (p.places !== undefined && !Array.isArray(p.places)) {
    errors.push({ key: 'err.plan.placesArray' });
  }

  if (!legacy) {
    const checkPoint = (point: unknown, field: string) => {
      if (point !== undefined && !isValidLocalPoint(point))
        errors.push({ key: 'err.plan.badDate', params: { field } });
    };
    checkPoint(p.availableFrom, 'availableFrom');
    checkPoint(p.mustEndBy, 'mustEndBy');
    if (
      p.availableFrom &&
      p.mustEndBy &&
      isValidLocalPoint(p.availableFrom) &&
      isValidLocalPoint(p.mustEndBy)
    ) {
      const from = localPointMinutes(p.availableFrom)!;
      const end = localPointMinutes(p.mustEndBy)!;
      if (end < from || end - from > 1440)
        errors.push({ key: 'err.plan.badDate', params: { field: 'availability' } });
    }
    if (p.meeting?.timing !== undefined && !isValidTiming(p.meeting.timing))
      errors.push({ key: 'err.plan.startInvalid', params: { field: 'meeting' } });
    if (p.candidates !== undefined && !Array.isArray(p.candidates))
      errors.push({ key: 'err.plan.eventsArray' });
    const candidateIds = new Set<string>();
    for (const candidate of (Array.isArray(p.candidates) ? p.candidates : []) as Array<
      Record<string, unknown>
    >) {
      if (typeof candidate?.id !== 'string' || !candidate.id || candidateIds.has(candidate.id))
        errors.push({ key: 'err.plan.eventId' });
      else candidateIds.add(candidate.id);
      if (typeof candidate.title !== 'string' || !candidate.title.trim())
        errors.push({ key: 'err.plan.eventTitle' });
      if (candidate.excluded !== undefined && typeof candidate.excluded !== 'boolean')
        errors.push({ key: 'err.plan.eventId' });
    }
  }

  return errors.length > 0 ? fail(errors) : ok();
}

export function validateDatePack(pack: DatePack): ValidationResult {
  const planResult = validatePlan(pack.plan);
  if (!planResult.ok) return planResult;

  const warnings: DatePackIssue[] = [];
  const errors: DatePackIssue[] = [];
  if (pack.manifest?.version !== '3.0') {
    errors.push({ key: 'err.plan.manifestVersion' });
  }

  // v3 metadata is validated as part of the portable file contract.
  if (pack.manifest.version === '3.0') {
    if (
      !pack.baselinePlan ||
      !Array.isArray(pack.experiences) ||
      !Number.isSafeInteger(pack.revision) ||
      pack.revision < 0
    )
      errors.push({ key: 'err.plan.manifestVersion' });
    else if (!validatePlan(pack.baselinePlan).ok) errors.push({ key: 'err.read.invalidContent' });
  }
  // Referenced assets should exist in the pack (missing → warning, not fatal).
  const assetIds = new Set(pack.assets.map((a) => a.id));
  const referenced: string[] = [];
  if (pack.plan.coverAssetId) referenced.push(pack.plan.coverAssetId);
  for (const id of pack.plan.galleryAssetIds ?? []) referenced.push(id);
  for (const event of pack.plan.events) for (const id of event.assetIds ?? []) referenced.push(id);
  for (const place of pack.plan.places ?? [])
    for (const id of place.assetIds ?? []) referenced.push(id);
  for (const candidate of pack.plan.candidates ?? [])
    for (const id of candidate.assetIds ?? []) referenced.push(id);
  for (const experience of pack.experiences ?? [])
    for (const id of experience.assetIds ?? []) referenced.push(id);
  for (const id of referenced) {
    if (!assetIds.has(id)) warnings.push({ key: 'err.plan.assetMissing', params: { id } });
  }

  const placeIds = new Set((pack.plan.places ?? []).map((p) => p.id));
  for (const event of pack.plan.events)
    if (event.placeId && !placeIds.has(event.placeId))
      warnings.push({ key: 'err.plan.assetMissing', params: { id: event.placeId } });
  for (const candidate of pack.plan.candidates ?? [])
    if (candidate.placeId && !placeIds.has(candidate.placeId))
      warnings.push({ key: 'err.plan.assetMissing', params: { id: candidate.placeId } });
  const experienceIds = new Set<string>();
  for (const experience of pack.experiences ?? []) {
    if (!experience.id || experienceIds.has(experience.id))
      errors.push({ key: 'err.plan.dupId', params: { id: experience.id } });
    experienceIds.add(experience.id);
    if (!['completed', 'skipped', 'note'].includes(experience.outcome))
      errors.push({ key: 'err.plan.eventId' });
    if (experience.occurredOn && !isValidDateISO(experience.occurredOn))
      errors.push({ key: 'err.plan.badDate' });
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
