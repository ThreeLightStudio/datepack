import type { DateEvent, DatePack, DatePackPatch, DatePlan } from './types';
import { DATE_EVENT_TYPES } from './types';
import {
  isValidTime,
  isValidDateISO,
  isValidTiming,
  isValidLocalPoint,
  localPointMinutes,
  normalizeTime,
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
      if (
        typeof event.planB !== 'object' ||
        typeof event.planB.title !== 'string' ||
        event.planB.title.trim().length === 0
      ) {
        errors.push({ key: 'err.plan.planBTitle', params: { index } });
      }
      if (
        event.planB.replacementEventIds !== undefined &&
        (!Array.isArray(event.planB.replacementEventIds) ||
          event.planB.replacementEventIds.some((id: unknown) => typeof id !== 'string' || !id))
      ) {
        errors.push({ key: 'err.plan.assetIds', params: { index } });
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
    if (
      Array.isArray(event?.assetIds) &&
      event.assetIds.some((id: unknown) => typeof id !== 'string' || !id)
    )
      errors.push({ key: 'err.plan.assetIds', params: { index } });
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
    if (p.meeting !== undefined && (typeof p.meeting !== 'object' || p.meeting === null))
      errors.push({ key: 'err.plan.eventId', params: { field: 'meeting' } });
    if (p.meeting?.placeId !== undefined && typeof p.meeting.placeId !== 'string')
      errors.push({ key: 'err.plan.eventId', params: { field: 'meeting.placeId' } });
    if (p.sharedTravel !== undefined && !Array.isArray(p.sharedTravel))
      errors.push({ key: 'err.plan.eventId', params: { field: 'sharedTravel' } });
    for (const travel of (Array.isArray(p.sharedTravel) ? p.sharedTravel : []) as Array<
      Record<string, unknown>
    >) {
      if (typeof travel !== 'object' || travel === null) {
        errors.push({ key: 'err.plan.eventId', params: { field: 'sharedTravel.id' } });
        continue;
      }
      if (typeof travel.id !== 'string' || !travel.id)
        errors.push({ key: 'err.plan.eventId', params: { field: 'sharedTravel.id' } });
      if (travel.fromPlaceId !== undefined && typeof travel.fromPlaceId !== 'string')
        errors.push({ key: 'err.plan.eventId' });
      if (travel.toPlaceId !== undefined && typeof travel.toPlaceId !== 'string')
        errors.push({ key: 'err.plan.eventId' });
      if (
        travel.estimatedMinutes !== undefined &&
        (typeof travel.estimatedMinutes !== 'number' ||
          !Number.isFinite(travel.estimatedMinutes) ||
          travel.estimatedMinutes < 0)
      )
        errors.push({ key: 'err.plan.travelInvalid' });
    }
    if (p.candidates !== undefined && !Array.isArray(p.candidates))
      errors.push({ key: 'err.plan.eventsArray' });
    const candidateIds = new Set<string>();
    for (const candidate of (Array.isArray(p.candidates) ? p.candidates : []) as Array<
      Record<string, unknown>
    >) {
      if (typeof candidate !== 'object' || candidate === null) {
        errors.push({ key: 'err.plan.eventId' });
        continue;
      }
      if (typeof candidate?.id !== 'string' || !candidate.id || candidateIds.has(candidate.id))
        errors.push({ key: 'err.plan.eventId' });
      else candidateIds.add(candidate.id);
      if (typeof candidate.title !== 'string' || !candidate.title.trim())
        errors.push({ key: 'err.plan.eventTitle' });
      if (candidate.excluded !== undefined && typeof candidate.excluded !== 'boolean')
        errors.push({ key: 'err.plan.eventId' });
      if (
        candidate.assetIds !== undefined &&
        (!Array.isArray(candidate.assetIds) ||
          candidate.assetIds.some((id: unknown) => typeof id !== 'string' || !id))
      )
        errors.push({ key: 'err.plan.assetIds' });
      if (candidate.placeId !== undefined && typeof candidate.placeId !== 'string')
        errors.push({ key: 'err.plan.eventId' });
    }
    const places = Array.isArray(p.places) ? (p.places as Array<Record<string, unknown>>) : [];
    const placeIds = new Set<string>();
    for (const place of places) {
      if (
        typeof place !== 'object' ||
        place === null ||
        typeof place.id !== 'string' ||
        !place.id ||
        placeIds.has(place.id)
      ) {
        errors.push({ key: 'err.plan.eventId', params: { field: 'places.id' } });
        continue;
      }
      placeIds.add(place.id);
      if (typeof place.name !== 'string' || !place.name.trim())
        errors.push({ key: 'err.plan.eventTitle', params: { field: 'places.name' } });
      if (
        place.assetIds !== undefined &&
        (!Array.isArray(place.assetIds) ||
          place.assetIds.some((id: unknown) => typeof id !== 'string' || !id))
      )
        errors.push({ key: 'err.plan.assetIds', params: { field: 'places.assetIds' } });
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
  const assetIds = new Set<string>();
  for (const asset of pack.assets) {
    if (!asset?.id || assetIds.has(asset.id))
      errors.push({ key: 'err.plan.dupAssetId', params: { id: asset?.id ?? '' } });
    else assetIds.add(asset.id);
  }
  const checkAsset = (id: string, field: string) => {
    if (!assetIds.has(id)) errors.push({ key: 'err.plan.brokenReference', params: { id, field } });
  };
  const checkPlanReferences = (plan: DatePlan, fieldPrefix: string) => {
    const placeIds = new Set((plan.places ?? []).map((place) => place.id));
    const eventIds = new Set(plan.events.map((event) => event.id));
    const checkPlace = (id: string | undefined, field: string) => {
      if (id && !placeIds.has(id))
        errors.push({ key: 'err.plan.brokenReference', params: { id, field } });
    };
    if (plan.coverAssetId) checkAsset(plan.coverAssetId, `${fieldPrefix}.coverAssetId`);
    for (const id of plan.galleryAssetIds ?? []) checkAsset(id, `${fieldPrefix}.galleryAssetIds`);
    for (const place of plan.places ?? []) {
      for (const id of place.assetIds ?? [])
        checkAsset(id, `${fieldPrefix}.places.${place.id}.assetIds`);
    }
    for (const event of plan.events) {
      checkPlace(event.placeId, `${fieldPrefix}.events.${event.id}.placeId`);
      for (const id of event.assetIds ?? [])
        checkAsset(id, `${fieldPrefix}.events.${event.id}.assetIds`);
      for (const targetId of event.planB?.replacementEventIds ?? []) {
        if (!eventIds.has(targetId))
          errors.push({
            key: 'err.plan.brokenReference',
            params: {
              id: targetId,
              field: `${fieldPrefix}.events.${event.id}.planB.replacementEventIds`,
            },
          });
      }
    }
    for (const candidate of plan.candidates ?? []) {
      checkPlace(candidate.placeId, `${fieldPrefix}.candidates.${candidate.id}.placeId`);
      for (const id of candidate.assetIds ?? [])
        checkAsset(id, `${fieldPrefix}.candidates.${candidate.id}.assetIds`);
    }
    if (plan.meeting) checkPlace(plan.meeting.placeId, `${fieldPrefix}.meeting.placeId`);
    for (const travel of plan.sharedTravel ?? []) {
      checkPlace(travel.fromPlaceId, `${fieldPrefix}.sharedTravel.${travel.id}.fromPlaceId`);
      checkPlace(travel.toPlaceId, `${fieldPrefix}.sharedTravel.${travel.id}.toPlaceId`);
    }
  };
  checkPlanReferences(pack.plan, 'plan');
  if (pack.baselinePlan && validatePlan(pack.baselinePlan).ok)
    checkPlanReferences(pack.baselinePlan, 'baselinePlan');

  const experienceIds = new Set<string>();
  for (const experience of pack.experiences ?? []) {
    if (typeof experience !== 'object' || experience === null) {
      errors.push({ key: 'err.read.invalidContent' });
      continue;
    }
    if (!experience.id || experienceIds.has(experience.id))
      errors.push({ key: 'err.plan.dupId', params: { id: experience.id } });
    experienceIds.add(experience.id);
    if (!['completed', 'skipped', 'note'].includes(experience.outcome))
      errors.push({ key: 'err.plan.eventId' });
    if (experience.editedNote !== undefined && typeof experience.editedNote !== 'string')
      errors.push({ key: 'err.plan.eventId', params: { field: 'experiences.editedNote' } });
    if (
      experience.placeSnapshot !== undefined &&
      (typeof experience.placeSnapshot !== 'object' ||
        experience.placeSnapshot === null ||
        typeof experience.placeSnapshot.name !== 'string' ||
        !experience.placeSnapshot.name.trim() ||
        (experience.placeSnapshot.mapQuery !== undefined &&
          typeof experience.placeSnapshot.mapQuery !== 'string'))
    )
      errors.push({ key: 'err.plan.eventId', params: { field: 'experiences.placeSnapshot' } });
    if (experience.occurredOn && !isValidDateISO(experience.occurredOn))
      errors.push({ key: 'err.plan.badDate' });
    if (
      typeof experience.recordedAt !== 'string' ||
      !Number.isFinite(Date.parse(experience.recordedAt)) ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(experience.recordedAt)
    )
      errors.push({ key: 'err.plan.badDate', params: { field: 'experiences.recordedAt' } });
    if (experience.timing?.kind === 'exact' && !isValidLocalPoint(experience.timing.at))
      errors.push({ key: 'err.plan.startInvalid', params: { field: 'experiences.timing.at' } });
    if (
      experience.timing?.kind === 'approximate' &&
      (typeof experience.timing.period !== 'string' || !experience.timing.period.trim())
    )
      errors.push({ key: 'err.plan.startInvalid', params: { field: 'experiences.timing.period' } });
    if (experience.timing && !['exact', 'approximate'].includes(experience.timing.kind))
      errors.push({ key: 'err.plan.startInvalid', params: { field: 'experiences.timing.kind' } });
    for (const id of experience.assetIds ?? [])
      checkAsset(id, `experiences.${experience.id}.assetIds`);
  }

  return errors.length > 0 ? fail(errors, warnings) : ok(warnings);
}

// ---------------------------------------------------------------------------
// Patch validation
// ---------------------------------------------------------------------------

const PATCH_OPS = [
  'replace',
  'move',
  'remove',
  'insertBefore',
  'insertAfter',
  'insertFirst',
] as const;

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
    const operation = op as unknown as Record<string, unknown>;
    if (op.op !== 'insertFirst' && (typeof operation.target !== 'string' || !operation.target)) {
      errors.push({ key: 'err.patch.noTarget', params: { index } });
    }
    if (op.op === 'insertFirst' && operation.target !== undefined) {
      errors.push({ key: 'err.patch.noTarget', params: { index } });
    }
    if (op.op === 'remove') return;

    const value = operation.value;
    if (typeof value !== 'object' || value === null) {
      errors.push({ key: 'err.patch.noValue', params: { index } });
      return;
    }
    const v = value as Record<string, unknown>;
    const inserting =
      op.op === 'insertBefore' || op.op === 'insertAfter' || op.op === 'insertFirst';
    const allowedFields =
      op.op === 'move'
        ? ['start', 'end', 'timing']
        : [
            'title',
            'start',
            'end',
            'timing',
            'type',
            'note',
            'travelMinutes',
            'place',
            'placeId',
            'estimatedDurationMinutes',
            ...(inserting ? ['protectedFields'] : ['fixed']),
          ];
    if (Object.keys(v).some((key) => !allowedFields.includes(key)))
      errors.push({ key: 'err.patch.noValue', params: { index } });
    if (op.op === 'move' && Object.keys(v).length === 0)
      errors.push({ key: 'err.patch.noValue', params: { index } });
    if (inserting) {
      if (typeof v.title !== 'string' || v.title.trim().length === 0) {
        errors.push({ key: 'err.patch.needTitle', params: { index } });
      }
    }
    // Absence of time is intentional. Explicit timing and legacy aliases must agree.
    for (const field of ['start', 'end'] as const) {
      if (v[field] !== undefined && !isValidTime(v[field] as string)) {
        errors.push({ key: 'err.patch.badTime', params: { index, field } });
      }
    }
    if (v.timing !== undefined) {
      if (!isValidTiming(v.timing))
        errors.push({ key: 'err.patch.badTime', params: { index, field: 'timing' } });
      else {
        for (const field of ['start', 'end'] as const) {
          if (v[field] === undefined) continue;
          if (
            v.timing.kind !== 'exact' ||
            !v.timing[field] ||
            !isValidTime(v[field] as string) ||
            normalizeTime(v[field] as string) !== normalizeTime(v.timing[field]!.time)
          )
            errors.push({ key: 'err.patch.badTime', params: { index, field: 'timing' } });
        }
      }
    } else if (inserting && v.end !== undefined && v.start === undefined) {
      errors.push({ key: 'err.patch.needStart', params: { index } });
    }
    for (const field of ['travelMinutes', 'estimatedDurationMinutes'] as const) {
      if (
        v[field] !== undefined &&
        (typeof v[field] !== 'number' || !Number.isFinite(v[field]) || v[field] < 0)
      )
        errors.push({ key: 'err.patch.badTravel', params: { index } });
    }
    for (const field of ['place', 'placeId'] as const) {
      if (v[field] !== undefined && (typeof v[field] !== 'string' || !v[field].trim()))
        errors.push({ key: 'err.patch.noValue', params: { index } });
    }
    if (v.place !== undefined && v.placeId !== undefined)
      errors.push({ key: 'err.patch.noValue', params: { index } });
    if (v.note !== undefined && typeof v.note !== 'string')
      errors.push({ key: 'err.patch.noValue', params: { index } });
    if (v.title !== undefined && (typeof v.title !== 'string' || !v.title.trim()))
      errors.push({ key: 'err.patch.needTitle', params: { index } });
    if (v.type !== undefined && !(DATE_EVENT_TYPES as readonly string[]).includes(v.type as string))
      errors.push({ key: 'err.patch.badType', params: { index, value: String(v.type) } });
    if (
      v.protectedFields !== undefined &&
      (!Array.isArray(v.protectedFields) ||
        v.protectedFields.some(
          (field) => !['time', 'place', 'content', 'delete', 'order'].includes(field),
        ))
    )
      errors.push({ key: 'err.patch.noValue', params: { index } });
    if (op.op === 'replace') {
      if (Object.keys(v).length === 0) {
        warnings.push({ key: 'err.patch.emptyReplace', params: { index } });
      }
      if (v.fixed !== undefined && typeof v.fixed !== 'boolean') {
        errors.push({ key: 'err.patch.badFixed', params: { index } });
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
