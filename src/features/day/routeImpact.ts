import type { DateEvent, DatePlan, LocalPoint, ProtectedField } from '@datepack/core';
import { sortEventsByOrder } from '@datepack/core';
import { seoulPlanDate, seoulPointInstant } from './planTime';
export const ANCHOR_BUFFER_MINUTES = 10;
import {
  getLocalObservation,
  observationReason,
  validCoordinate,
  LOCATION_TTL_MS,
  type LocationObservation,
} from './location';
import {
  coordinateKey,
  publicFootProvider,
  type ResolvedPlace,
  type RouteEvidence,
  type RouteLeg,
  type RouteProvider,
  type TravelMode,
} from './routeProvider';

export type ValidationSnapshot = {
  planId: string;
  planRevision: number;
  contextRevision: number;
  requestId?: string;
  candidateDigest: string;
  orderedEventIds: string[];
  scopeEventIds: string[];
  mode: TravelMode;
  evaluatedAt: string;
  locationDigest: string;
  evidenceDigest: string;
};
export type ImpactResult = {
  status: 'verified' | 'unverified' | 'impossible';
  snapshot: ValidationSnapshot;
  evidenceIds: string[];
  affectedEventIds: string[];
  reasonCodes: string[];
  anchorArrivals: Array<{
    eventId: string;
    arrivalAt: string;
    deadlineAt: string;
    rawArrivalAt: string;
    bufferMinutes: number;
  }>;
};
export type ImpactInput = {
  documentId?: string;
  before: DatePlan;
  proposed: DatePlan;
  planRevision: number;
  contextRevision: number;
  requestId?: string;
  scopeEventIds?: readonly string[];
  eventIds?: readonly string[];
  mode?: TravelMode;
  explicitlyRequestedMode?: boolean;
  phase?: 'live' | 'plan';
  now?: number;
  observation?: LocationObservation;
  places?: readonly ResolvedPlace[];
  evidence?: readonly RouteEvidence[];
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const memoryBindings = new Map<string, string>();
function memoryDigest(value: unknown): string {
  const serialized = JSON.stringify(value);
  let token = memoryBindings.get(serialized);
  if (!token) {
    token = crypto.randomUUID();
    memoryBindings.set(serialized, token);
  }
  return token;
}
export function candidateDigest(plan: DatePlan): string {
  // Exact canonical candidate binding, no collision-prone abbreviated hash.
  return JSON.stringify(plan);
}
function placeValue(plan: DatePlan, event: DateEvent) {
  return [event.placeId, plan.places?.find((p) => p.id === event.placeId)];
}
function routeValue(plan: DatePlan) {
  return [
    plan.date,
    plan.availableFrom,
    plan.mustEndBy,
    sortEventsByOrder(plan.events).map((e) => [
      e.id,
      e.order,
      e.timing,
      e.start,
      e.end,
      e.estimatedDurationMinutes,
      placeValue(plan, e),
    ]),
  ];
}
export function hasRouteImpact(before: DatePlan, proposed: DatePlan): boolean {
  if (samePlaceUnscheduledReorder(before, proposed)) return false;
  return !same(routeValue(before), routeValue(proposed));
}
/** Only a permutation inside one venue's untimed block can keep the journey unchanged.
 * Unknown venues, time windows and changes to any other field still need route evidence. */
function samePlaceUnscheduledReorder(before: DatePlan, proposed: DatePlan): boolean {
  const a = sortEventsByOrder(before.events),
    b = sortEventsByOrder(proposed.events);
  if (!same({ ...before, events: [] }, { ...proposed, events: [] }) || a.length !== b.length)
    return false;
  const strip = (event: DateEvent) => ({ ...event, order: 0 });
  if (a.some((event) => !same(strip(event), strip(b.find((e) => e.id === event.id)!))))
    return false;
  const changed = a.flatMap((event, index) => (event.id !== b[index]?.id ? [index] : []));
  if (!changed.length) return true;
  const block = a.slice(changed[0], changed.at(-1)! + 1);
  const placeId = block[0].placeId;
  return Boolean(
    placeId &&
    before.places?.some((place) => place.id === placeId) &&
    block.every(
      (event) =>
        event.placeId === placeId &&
        event.timing.kind === 'unscheduled' &&
        Number.isFinite(event.estimatedDurationMinutes) &&
        event.estimatedDurationMinutes! >= 0,
    ) &&
    same(
      block.map((e) => e.id).sort(),
      b
        .slice(changed[0], changed.at(-1)! + 1)
        .map((e) => e.id)
        .sort(),
    ),
  );
}
export function protectionReasons(before: DatePlan, proposed: DatePlan): string[] {
  before = { ...before, events: sortEventsByOrder(before.events) };
  proposed = { ...proposed, events: sortEventsByOrder(proposed.events) };
  const reasons = new Set<string>();
  for (const event of before.events) {
    const fields: readonly ProtectedField[] = event.fixed
      ? ['time', 'place', 'content', 'delete', 'order']
      : (event.protectedFields ?? []);
    const next = proposed.events.find((e) => e.id === event.id);
    if (!next) {
      if (fields.includes('delete')) reasons.add('protected-field');
      continue;
    }
    if (!same(event.protectedFields, next.protectedFields) || event.fixed !== next.fixed)
      reasons.add('protected-field');
    if (
      fields.includes('time') &&
      !same([event.timing, event.start, event.end], [next.timing, next.start, next.end])
    )
      reasons.add('protected-field');
    if (fields.includes('place') && !same(placeValue(before, event), placeValue(proposed, next)))
      reasons.add('protected-field');
    if (
      fields.includes('content') &&
      !same([event.title, event.type, event.note], [next.title, next.type, next.note])
    )
      reasons.add('protected-field');
    if (fields.includes('order')) {
      const oldIndex = before.events.indexOf(event),
        newIndex = proposed.events.indexOf(next);
      for (const other of before.events) {
        if (other.id === event.id) continue;
        const otherNew = proposed.events.findIndex((e) => e.id === other.id);
        if (otherNew >= 0 && before.events.indexOf(other) < oldIndex !== otherNew < newIndex)
          reasons.add('protected-order');
      }
    }
  }
  return [...reasons];
}
function scopeReason(input: ImpactInput): string | undefined {
  if (!input.scopeEventIds) return undefined;
  const allowed = new Set(input.scopeEventIds);
  for (const event of input.before.events) {
    const next = input.proposed.events.find((e) => e.id === event.id);
    // Renumbering after insert/delete is not a modification grant.
    const stripOrder = (e: DateEvent) => ({ ...e, order: 0 });
    if (
      !allowed.has(event.id) &&
      (!next ||
        !same(stripOrder(event), stripOrder(next)) ||
        !same(placeValue(input.before, event), placeValue(input.proposed, next)))
    )
      return 'scope-mismatch';
  }
  return undefined;
}
const pointInstant = (date: string, p: LocalPoint) => seoulPointInstant(date, p);
function resolved(input: ImpactInput, event: DateEvent, now: number): ResolvedPlace | undefined {
  const place = input.proposed.places?.find((p) => p.id === event.placeId);
  if (!place) return undefined;
  // Venue identity changes invalidate previous matches, even when the place ID is reused.
  return input.places?.find(
    (p) =>
      p.placeId === place.id &&
      p.userConfirmed &&
      validCoordinate(p.coordinate) &&
      p.querySnapshot === JSON.stringify([place.name, place.mapQuery ?? '']) &&
      now - Date.parse(p.resolvedAt) >= 0 &&
      now - Date.parse(p.resolvedAt) <= LOCATION_TTL_MS,
  );
}
function evidenceFor(input: ImpactInput, leg: RouteLeg, now: number): RouteEvidence | undefined {
  return input.evidence?.find(
    (e) =>
      e.mode === leg.mode &&
      e.fromKey === leg.fromKey &&
      e.toKey === leg.toKey &&
      e.coordinateDigest === coordinateKey(leg.from, leg.to) &&
      e.provider.length > 0 &&
      e.endpoint.startsWith('https://') &&
      e.attribution.length > 0 &&
      Number.isFinite(e.durationSeconds) &&
      e.durationSeconds >= 0 &&
      Number.isFinite(e.distanceMeters) &&
      e.distanceMeters >= 0 &&
      (e.durationSeconds > 0 ||
        coordinateKey(leg.from, leg.to) === coordinateKey(leg.from, leg.from)) &&
      now - Date.parse(e.fetchedAt) >= 0 &&
      now - Date.parse(e.fetchedAt) <= LOCATION_TTL_MS &&
      (e.basis === 'osm-static' ? e.mode === 'walking' : e.departureAt === leg.departureAt),
  );
}

/** Pure full-chain calculation. AI travelMinutes, shared estimates and straight-line distances are never read. */
export function validateImpact(input: ImpactInput): ImpactResult {
  return evaluate(input).result;
}
function evaluate(input: ImpactInput): { result: ImpactResult; missingLeg?: RouteLeg } {
  input = {
    ...input,
    before: { ...input.before, events: sortEventsByOrder(input.before.events) },
    proposed: { ...input.proposed, events: sortEventsByOrder(input.proposed.events) },
  };
  const now = input.now ?? Date.now(),
    mode = input.mode ?? 'walking';
  const selected = input.eventIds ? new Set(input.eventIds) : undefined;
  // Include new inserts and every downstream anchor outside the editable scope.
  const first = selected
    ? input.proposed.events.findIndex(
        (e) => selected.has(e.id) || !input.before.events.some((old) => old.id === e.id),
      )
    : 0;
  let events =
    first < 0
      ? []
      : input.proposed.events
          .slice(first)
          .filter(
            (event) =>
              !selected ||
              selected.has(event.id) ||
              !input.before.events.some((old) => old.id === event.id),
          );
  const chosenIndex = events.findIndex((event) => event.id === input.eventIds?.[0]);
  if (chosenIndex > 0) {
    const prefix = events.slice(0, chosenIndex);
    const oldIds = new Set(input.before.events.map((event) => event.id));
    events = [
      ...prefix.filter((event) => !oldIds.has(event.id)),
      ...events.slice(chosenIndex),
      ...prefix.filter((event) => oldIds.has(event.id)),
    ];
  }
  const result: ImpactResult = {
    status: 'unverified',
    snapshot: {
      planId: input.documentId ?? input.before.id,
      planRevision: input.planRevision,
      contextRevision: input.contextRevision,
      requestId: input.requestId,
      candidateDigest: candidateDigest(input.proposed),
      orderedEventIds: events.map((e) => e.id),
      scopeEventIds: [...(input.scopeEventIds ?? [])],
      mode,
      evaluatedAt: new Date(now).toISOString(),
      locationDigest: memoryDigest([input.observation, input.places]),
      evidenceDigest: memoryDigest(input.evidence),
    },
    evidenceIds: [],
    affectedEventIds: events.map((e) => e.id),
    reasonCodes: [],
    anchorArrivals: [],
  };
  const fail = (reason: string, status: ImpactResult['status'] = 'unverified') => {
    result.status = status;
    result.reasonCodes.push(reason);
    return { result };
  };
  const protectedReasons = protectionReasons(input.before, input.proposed);
  if (protectedReasons.length) {
    result.reasonCodes = protectedReasons;
    result.status = 'impossible';
    return { result };
  }
  const scope = scopeReason(input);
  if (scope) return fail(scope, 'impossible');
  if (!hasRouteImpact(input.before, input.proposed)) {
    result.status = 'verified';
    result.reasonCodes = ['no-route-impact'];
    return { result };
  }
  if ((mode === 'car' || mode === 'taxi') && !input.explicitlyRequestedMode)
    return fail('unsupported-mode');
  const date = input.proposed.date;
  if (!date) return fail('date-unknown');
  const planPhase = input.phase === 'plan';
  const today = seoulPlanDate(now);
  if (!planPhase && date !== today) return fail('date-mismatch');
  const observation = input.observation;
  if (!planPhase) {
    const locationError = observationReason(observation, now);
    if (locationError) return fail(locationError);
  }
  let clock =
    planPhase && input.proposed.availableFrom
      ? pointInstant(date, input.proposed.availableFrom)
      : now;
  let from = planPhase ? undefined : observation?.coordinate;
  let fromKey = planPhase ? '' : `location:${observation?.observedAt}`;
  for (const event of events) {
    const target = resolved(input, event, now);
    if (!target) return fail('place-unresolved');
    if (from) {
      const leg: RouteLeg = {
        from,
        to: target.coordinate,
        fromKey,
        toKey: event.id,
        departureAt: new Date(clock).toISOString(),
        mode,
      };
      const evidence = evidenceFor(input, leg, now);
      if (!evidence) {
        const existing = input.evidence?.some((e) => e.fromKey === fromKey && e.toKey === event.id);
        result.reasonCodes.push(existing ? 'evidence-stale' : 'missing-leg');
        return { result, missingLeg: leg };
      }
      result.evidenceIds.push(evidence.id);
      clock += Math.ceil(evidence.durationSeconds / 60) * 60_000;
    } else if (event.timing.kind === 'unscheduled' && !input.proposed.availableFrom)
      return fail('time-unknown');
    const timing = event.timing;
    if (timing.kind !== 'unscheduled') {
      const earliest = pointInstant(
        date,
        timing.kind === 'exact' ? timing.start : timing.earliestStart,
      );
      const latest = pointInstant(
        date,
        timing.kind === 'exact' ? timing.start : timing.latestStart,
      );
      if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return fail('time-unknown');
      if (planPhase && !from && !input.proposed.availableFrom) clock = earliest;
      const bufferMinutes =
        from &&
        (timing.kind === 'exact' ||
          event.fixed ||
          event.type === 'reservation' ||
          event.protectedFields?.includes('time'))
          ? ANCHOR_BUFFER_MINUTES
          : 0;
      const bufferedArrival = clock + bufferMinutes * 60_000;
      result.anchorArrivals.push({
        eventId: event.id,
        arrivalAt: new Date(bufferedArrival).toISOString(),
        rawArrivalAt: new Date(clock).toISOString(),
        bufferMinutes,
        deadlineAt: new Date(latest).toISOString(),
      });
      if (bufferedArrival > latest) return fail('anchor-late', 'impossible');
      clock = Math.max(clock, earliest);
    }
    const duration =
      timing.kind === 'exact' && timing.end
        ? (pointInstant(date, timing.end) - pointInstant(date, timing.start)) / 60_000
        : event.estimatedDurationMinutes;
    if (duration === undefined || !Number.isFinite(duration) || duration < 0)
      return fail('duration-unknown');
    clock += duration * 60_000;
    from = target.coordinate;
    fromKey = event.id;
  }
  if (!events.length) return fail('missing-leg');
  if (input.proposed.mustEndBy && clock > pointInstant(date, input.proposed.mustEndBy))
    return fail('end-late', 'impossible');
  result.status = 'verified';
  return { result };
}

const localPlaces = new Map<string, ResolvedPlace[]>();
const localEvidence = new Map<string, RouteEvidence[]>();
export function setResolvedPlaces(planId: string, places: ResolvedPlace[]): void {
  localPlaces.set(planId, places);
}
export function clearRouteMemory(): void {
  localPlaces.clear();
  localEvidence.clear();
  memoryBindings.clear();
}
export function localImpactInput(input: ImpactInput): ImpactInput {
  return {
    ...input,
    observation: input.observation ?? getLocalObservation(input.documentId ?? input.before.id),
    places: input.places ?? localPlaces.get(input.documentId ?? input.before.id),
    evidence: input.evidence ?? localEvidence.get(input.documentId ?? input.before.id) ?? [],
  };
}
/** Fetches missing legs sequentially. Capability failures stop without making up durations. */
export async function prepareImpact(
  input: ImpactInput,
  provider: RouteProvider = publicFootProvider,
): Promise<ImpactResult> {
  const prepared = localImpactInput(input);
  const evidence = [...(prepared.evidence ?? [])];
  prepared.evidence = evidence;
  for (let i = 0; i <= input.proposed.events.length; i++) {
    prepared.now = Date.now();
    const checked = evaluate(prepared);
    if (!checked.missingLeg) return checked.result;
    const reply = await provider.fetchRoute(checked.missingLeg);
    if (!reply.ok) {
      checked.result.reasonCodes = [reply.reason];
      return checked.result;
    }
    evidence.push(reply.evidence);
    localEvidence.set(input.documentId ?? input.before.id, evidence);
  }
  const result = validateImpact(prepared);
  result.status = 'unverified';
  result.reasonCodes = ['missing-leg'];
  return result;
}
export function snapshotMatches(snapshot: ValidationSnapshot, input: ImpactInput): boolean {
  const current = validateImpact(input).snapshot;
  return same({ ...snapshot, evaluatedAt: '' }, { ...current, evaluatedAt: '' });
}
export function preferredVerifiedCandidate<T extends { impact: ImpactResult }>(
  candidates: readonly T[],
): T | undefined {
  return candidates.find((candidate) => candidate.impact.status === 'verified');
}
