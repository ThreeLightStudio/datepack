import type {
  DateEvent,
  DatePack,
  DatePackRuntimeState,
  DatePlan,
  EventTiming,
  LegacyDatePack,
  LegacyDatePlan,
  Experience,
} from './types';
import { DATE_EVENT_TYPES } from './types';
import { normalizeTime, isValidTime, parseTime } from './utils/time';

export type MigrationResult = { pack: DatePack; migrated: boolean; sourceVersion: string };

/** Pure, repeatable conversion of supported v1/v2 plans to the v3 contract. */
export function migrateLegacyDatePack(
  input: LegacyDatePack,
  runtime?: DatePackRuntimeState,
): MigrationResult {
  const sourceVersion = input.manifest.version;
  const migratedEvents: DateEvent[] = input.plan.events.map((legacy, order) => ({
    id: legacy.id,
    order,
    title: legacy.title,
    type: (DATE_EVENT_TYPES as readonly string[]).includes(legacy.type) ? legacy.type : 'place',
    timing: toTiming(legacy.start, legacy.end),
    ...(legacy.placeId ? { placeId: legacy.placeId } : {}),
    ...(legacy.note !== undefined ? { note: legacy.note } : {}),
    ...(legacy.assetIds ? { assetIds: [...legacy.assetIds] } : {}),
    ...(legacy.planB ? { planB: structuredClone(legacy.planB) } : {}),
    ...(legacy.fixed
      ? { protectedFields: ['time', 'place', 'content', 'delete', 'order'] as const }
      : {}),
    start: isValidTime(legacy.start) ? normalizeTime(legacy.start) : '00:00',
    end: legacy.end && isValidTime(legacy.end) ? normalizeTime(legacy.end) : undefined,
    fixed: legacy.fixed ?? false,
    travelMinutes: legacy.travelMinutes,
  }));
  const plan: DatePlan = {
    id: input.plan.id,
    title: input.plan.title,
    ...(input.plan.date ? { date: input.plan.date } : {}),
    ...(input.plan.coverAssetId ? { coverAssetId: input.plan.coverAssetId } : {}),
    ...(input.plan.galleryAssetIds ? { galleryAssetIds: [...input.plan.galleryAssetIds] } : {}),
    ...(input.plan.memo !== undefined ? { memo: input.plan.memo } : {}),
    ...(input.plan.constraints ? { constraints: structuredClone(input.plan.constraints) } : {}),
    events: migratedEvents,
    places: structuredClone(input.plan.places ?? []),
    candidates: [],
    ...(input.plan.events.some((e) => e.travelMinutes !== undefined)
      ? {
          sharedTravel: input.plan.events.flatMap((e, i) =>
            e.travelMinutes === undefined
              ? []
              : [
                  {
                    id: `legacy-travel-${input.plan.id}-${e.id}`,
                    toPlaceId: e.placeId,
                    note:
                      i === 0
                        ? `Legacy travel estimate (${e.travelMinutes} min); origin unknown.`
                        : undefined,
                    estimatedMinutes: e.travelMinutes,
                    source: 'legacy' as const,
                  },
                ],
          ),
        }
      : {}),
  };
  const experiences: Experience[] = [];
  for (const event of migratedEvents) {
    const state = runtime?.events[event.id];
    if (!state || (state.status !== 'completed' && state.status !== 'skipped')) continue;
    experiences.push({
      id: `experience-legacy-${input.plan.id}-${event.id}`,
      eventId: event.id,
      title: event.title,
      outcome: state.status,
      note:
        state.activePlan === 'B'
          ? `Selected Plan B${event.planB?.title ? `: ${event.planB.title}` : ''}.`
          : undefined,
      source: { kind: 'legacy', format: sourceVersion, planId: input.plan.id, eventId: event.id },
    });
  }
  return {
    pack: {
      manifest: { ...input.manifest, version: '3.0', entry: 'plan.json' },
      plan,
      baselinePlan: structuredClone(plan),
      experiences,
      revision: 0,
      assets: structuredClone(input.assets ?? []),
    },
    migrated: true,
    sourceVersion,
  };
}

function toTiming(start: string, end?: string): EventTiming {
  const validStart = isValidTime(start) ? normalizeTime(start) : '00:00';
  const validEnd = end && isValidTime(end) ? normalizeTime(end) : undefined;
  const endOffset = validEnd && (parseTime(validEnd) ?? 0) < (parseTime(validStart) ?? 0) ? 1 : 0;
  return {
    kind: 'exact',
    start: { dayOffset: 0, time: validStart },
    ...(validEnd ? { end: { dayOffset: endOffset, time: validEnd } } : {}),
  };
}

export function isLegacyDatePlan(plan: unknown): plan is LegacyDatePlan {
  return (
    typeof plan === 'object' &&
    plan !== null &&
    Array.isArray((plan as { events?: unknown }).events) &&
    (plan as { events: unknown[] }).events.every(
      (e) => typeof e === 'object' && e !== null && 'start' in e && !('timing' in e),
    )
  );
}

export function isV3DatePlan(plan: unknown): plan is DatePlan {
  return (
    typeof plan === 'object' &&
    plan !== null &&
    Array.isArray((plan as { events?: unknown }).events) &&
    (plan as { events: unknown[] }).events.every(
      (e) => typeof e === 'object' && e !== null && 'timing' in e,
    )
  );
}
