import { describe, expect, it, vi } from 'vitest';
import { createEvent, type DatePlan } from '@datepack/core';
import {
  candidateDigest,
  hasRouteImpact,
  protectionReasons,
  snapshotMatches,
  validateImpact,
  preferredVerifiedCandidate,
  prepareImpact,
  type ImpactInput,
} from '../src/features/day/routeImpact';
import {
  coordinateKey,
  FOOT_ENDPOINT,
  type RouteEvidence,
  type ResolvedPlace,
} from '../src/features/day/routeProvider';

function fixture(): ImpactInput {
  const now = new Date('2026-10-01T16:40:00+09:00').getTime();
  const before: DatePlan = {
    id: 'route-plan',
    title: 'Date',
    date: '2026-10-01',
    events: [
      {
        ...createEvent({ id: 'cafe', title: 'Cafe', order: 0 }),
        placeId: 'old',
        estimatedDurationMinutes: 20,
      },
      {
        ...createEvent({ id: 'walk', title: 'Walk', order: 1 }),
        placeId: 'park',
        estimatedDurationMinutes: 10,
      },
      {
        ...createEvent({
          id: 'reservation',
          title: '18:00 booking',
          order: 2,
          start: '18:00',
          end: '19:00',
        }),
        placeId: 'booking',
        protectedFields: ['time', 'place', 'order'],
      },
    ],
    places: [
      { id: 'old', name: 'Old Cafe' },
      { id: 'new', name: 'New Cafe' },
      { id: 'park', name: 'Park' },
      { id: 'booking', name: 'Restaurant' },
    ],
    mustEndBy: { dayOffset: 0, time: '19:30' },
  };
  const proposed = structuredClone(before);
  proposed.events[0].placeId = 'new';
  const observation = {
    source: 'gps' as const,
    observedAt: new Date(now).toISOString(),
    coarseLabel: 'Seoul',
    coordinate: { lat: 37.56, lon: 126.98, accuracyMeters: 20 },
  };
  const places: ResolvedPlace[] = proposed.places!.map((place, i) => ({
    placeId: place.id,
    coordinate: { lat: 37.565 + i / 1000, lon: 126.985 + i / 1000 },
    source: 'confirmed-public-fixture',
    querySnapshot: JSON.stringify([place.name, place.mapQuery ?? '']),
    resolvedAt: new Date(now).toISOString(),
    userConfirmed: true,
  }));
  let from = observation.coordinate;
  let fromKey = `location:${observation.observedAt}`;
  const evidence: RouteEvidence[] = proposed.events.map((event, i) => {
    const to = places.find((place) => place.placeId === event.placeId)!.coordinate;
    const item: RouteEvidence = {
      id: `leg-${i}`,
      provider: 'fixture-foot',
      endpoint: FOOT_ENDPOINT,
      mode: 'walking',
      fromKey,
      toKey: event.id,
      coordinateDigest: coordinateKey(from, to),
      fetchedAt: new Date(now).toISOString(),
      departureAt: new Date(now).toISOString(),
      durationSeconds: 600,
      distanceMeters: 800,
      basis: 'osm-static',
      attribution: 'OSM fixture',
    };
    from = { ...to, accuracyMeters: 20 };
    fromKey = event.id;
    return item;
  });
  return {
    before,
    proposed,
    now,
    observation,
    places,
    evidence,
    planRevision: 3,
    contextRevision: 2,
    requestId: 'r1',
    scopeEventIds: ['cafe'],
  };
}
describe('full affected journey', () => {
  it('matches the rain A/B/C contract with ten-minute booking slack and every downstream leg', () => {
    const a = fixture();
    a.evidence![2].durationSeconds = 900;
    const resultA = validateImpact(a);
    expect(resultA.status).toBe('verified');
    expect(resultA.anchorArrivals.at(-1)).toMatchObject({
      rawArrivalAt: '2026-10-01T08:45:00.000Z',
      arrivalAt: '2026-10-01T08:55:00.000Z',
      bufferMinutes: 10,
    });
    const b = fixture();
    b.before.events[0].estimatedDurationMinutes =
      b.proposed.events[0].estimatedDurationMinutes = 30;
    [1500, 900, 1200].forEach((duration, i) => {
      b.evidence![i].durationSeconds = duration;
    });
    const resultB = validateImpact(b);
    expect(resultB).toMatchObject({ status: 'impossible', reasonCodes: ['anchor-late'] });
    expect(resultB.anchorArrivals.at(-1)?.arrivalAt).toBe('2026-10-01T09:30:00.000Z');
    const c = fixture();
    c.evidence = c.evidence!.slice(0, 2);
    expect(validateImpact(c)).toMatchObject({ status: 'unverified', reasonCodes: ['missing-leg'] });
  });
  it('rounds each route leg upward and rejects 17:55 or 18:00 arrivals with an 18:00 booking', () => {
    const input = fixture();
    input.evidence![2].durationSeconds = 1200;
    expect(validateImpact(input)).toMatchObject({ status: 'verified' }); // raw 17:50 + slack = 18:00
    input.evidence![2].durationSeconds = 1200.001;
    expect(validateImpact(input)).toMatchObject({
      status: 'impossible',
      reasonCodes: ['anchor-late'],
    });
    expect(validateImpact(input).anchorArrivals.at(-1)?.rawArrivalAt).toBe(
      '2026-10-01T08:51:00.000Z',
    );
    for (const seconds of [1500, 1800]) {
      input.evidence![2].durationSeconds = seconds;
      expect(validateImpact(input).status).toBe('impossible');
    }
    input.evidence![2].durationSeconds = 600;
    input.evidence![0].durationSeconds = 600.001;
    input.evidence![1].durationSeconds = 600.001;
    expect(validateImpact(input).anchorArrivals.at(-1)?.rawArrivalAt).toBe(
      '2026-10-01T08:42:00.000Z',
    );
  });
  it('interprets Seoul deadlines and day offsets independently of UTC or overseas device time zones', () => {
    const original = process.env.TZ;
    try {
      for (const zone of ['UTC', 'America/Los_Angeles']) {
        process.env.TZ = zone;
        const input = fixture();
        expect(validateImpact(input).status).toBe('verified');
        expect(validateImpact(input).anchorArrivals.at(-1)?.deadlineAt).toBe(
          '2026-10-01T09:00:00.000Z',
        );
        input.before.events[2].timing = input.proposed.events[2].timing = {
          kind: 'exact',
          start: { dayOffset: 1, time: '00:10' },
          end: { dayOffset: 1, time: '00:30' },
        };
        input.before.mustEndBy = input.proposed.mustEndBy = { dayOffset: 1, time: '01:00' };
        const now = Date.parse('2026-10-01T14:50:00Z'); // 23:50 Seoul, same Korean plan day
        input.now = now;
        input.observation!.observedAt = new Date(now).toISOString();
        input.places!.forEach((place) => {
          place.resolvedAt = new Date(now).toISOString();
        });
        input.evidence!.forEach((e, i) => {
          e.fetchedAt = new Date(now).toISOString();
          e.durationSeconds = 60;
          if (i === 0) e.fromKey = `location:${input.observation!.observedAt}`;
        });
        input.before.events[0].estimatedDurationMinutes =
          input.proposed.events[0].estimatedDurationMinutes = 0;
        input.before.events[1].estimatedDurationMinutes =
          input.proposed.events[1].estimatedDurationMinutes = 0;
        expect(validateImpact(input).status).toBe('verified');
        expect(validateImpact(input).anchorArrivals.at(-1)?.deadlineAt).toBe(
          '2026-10-01T15:10:00.000Z',
        );
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it('keeps all changes unapplied when a downstream leg fails; avoids I/O for text-only edits', async () => {
    const input = fixture();
    const now = input.now!;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      input.evidence = [];
      const fetchRoute = vi.fn(async (leg) =>
        leg.toKey === 'reservation'
          ? { ok: false as const, reason: 'rate-limit' }
          : {
              ok: true as const,
              evidence: fixture().evidence!.find((e) => e.toKey === leg.toKey)!,
            },
      );
      const result = await prepareImpact(input, { fetchRoute });
      expect(result).toMatchObject({ status: 'unverified', reasonCodes: ['rate-limit'] });
      expect(fetchRoute).toHaveBeenCalledTimes(3);
      expect(input.before.events[0].placeId).toBe('old');
      fetchRoute.mockClear();
      input.proposed = structuredClone(input.before);
      input.proposed.events[0].note = 'Only wording';
      expect((await prepareImpact(input, { fetchRoute })).status).toBe('verified');
      expect(fetchRoute).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('checks the cafe, downstream walk and protected 18:00 anchor outside edit scope', () => {
    const input = fixture();
    const result = validateImpact(input);
    expect(result.status).toBe('verified');
    expect(result.affectedEventIds).toEqual(['cafe', 'walk', 'reservation']);
    expect(result.evidenceIds).toHaveLength(3);
    expect(result.anchorArrivals.at(-1)).toMatchObject({
      eventId: 'reservation',
      arrivalAt: new Date('2026-10-01T17:50:00+09:00').toISOString(),
      deadlineAt: new Date('2026-10-01T18:00:00+09:00').toISOString(),
    });
    input.before.events[0].estimatedDurationMinutes = 45;
    input.proposed.events[0].estimatedDurationMinutes = 45;
    expect(validateImpact(input)).toMatchObject({
      status: 'impossible',
      reasonCodes: ['anchor-late'],
    });
  });
  it('includes end deadlines, window latest start and next-day points', () => {
    const input = fixture();
    input.before.mustEndBy = input.proposed.mustEndBy = { dayOffset: 0, time: '18:30' };
    expect(validateImpact(input).reasonCodes).toEqual(['end-late']);
    input.before.mustEndBy = input.proposed.mustEndBy = { dayOffset: 1, time: '00:30' };
    input.before.events[2].timing = input.proposed.events[2].timing = {
      kind: 'window',
      earliestStart: { dayOffset: 0, time: '17:00' },
      latestStart: { dayOffset: 0, time: '17:30' },
    };
    expect(validateImpact(input).reasonCodes).toEqual(['anchor-late']);
  });
  it('never treats AI travelMinutes or zero/straight-line estimates as route proof', () => {
    const input = fixture();
    input.evidence = [];
    input.proposed.events.forEach((event) => {
      event.travelMinutes = 0;
    });
    input.before.events.forEach((event) => {
      event.travelMinutes = 0;
    });
    expect(validateImpact(input)).toMatchObject({
      status: 'unverified',
      reasonCodes: ['missing-leg'],
    });
    input.evidence = fixture().evidence;
    input.proposed.events[0].estimatedDurationMinutes = undefined;
    expect(validateImpact(input).reasonCodes).toEqual(['duration-unknown']);
  });
  it('rejects stale, inaccurate, ambiguous, renamed and unresolved endpoints', () => {
    const input = fixture();
    input.observation!.coordinate!.accuracyMeters = 101;
    expect(validateImpact(input).reasonCodes).toEqual(['location-inaccurate']);
    input.observation!.coordinate!.accuracyMeters = 20;
    input.observation!.observedAt = new Date(input.now! - 300_001).toISOString();
    expect(validateImpact(input).reasonCodes).toEqual(['location-stale']);
    input.observation = fixture().observation;
    input.places = input.places!.map((place) => ({ ...place, userConfirmed: false }));
    expect(validateImpact(input).reasonCodes).toEqual(['place-unresolved']);
    input.places = fixture().places;
    input.proposed.places![1].mapQuery = 'different cafe';
    expect(validateImpact(input).reasonCodes).toEqual(['place-unresolved']);
  });
  it('binds evidence to coordinates, TTL and transit departure without vehicle fallback', () => {
    const input = fixture();
    input.evidence![0].fetchedAt = new Date(input.now! - 300_001).toISOString();
    expect(validateImpact(input).reasonCodes).toEqual(['evidence-stale']);
    input.evidence = fixture().evidence;
    input.evidence![0].coordinateDigest = 'AI claimed verified';
    expect(validateImpact(input).reasonCodes).toEqual(['evidence-stale']);
    input.mode = 'taxi';
    expect(validateImpact(input).reasonCodes).toEqual(['unsupported-mode']);
    input.mode = 'transit';
    expect(validateImpact(input).status).toBe('unverified');
  });
  it('lets text-only edits through provider outages but keeps core importance separate', () => {
    const input = fixture();
    input.proposed = structuredClone(input.before);
    input.proposed.events[0].note = 'Bring an umbrella';
    input.before.events[0].importance = input.proposed.events[0].importance = 'core';
    input.evidence = [];
    input.places = [];
    input.observation = undefined;
    expect(hasRouteImpact(input.before, input.proposed)).toBe(false);
    expect(validateImpact(input)).toMatchObject({
      status: 'verified',
      reasonCodes: ['no-route-impact'],
    });
  });
  it('blocks protection changes, linked place mutation, legacy fixed weakening and relative reorder', () => {
    const input = fixture();
    input.proposed.places![3].name = 'Another restaurant';
    expect(protectionReasons(input.before, input.proposed)).toContain('protected-field');
    input.proposed = structuredClone(input.before);
    input.before.events[0].fixed = input.proposed.events[0].fixed = true;
    input.before.events[0].protectedFields = input.proposed.events[0].protectedFields = ['time'];
    input.proposed.events[0].title = 'Replacement';
    expect(validateImpact(input).status).toBe('impossible');
  });
  it('allows new inserts around an order anchor but blocks surviving event crossings', () => {
    const input = fixture();
    input.proposed = structuredClone(input.before);
    input.proposed.events.unshift(createEvent({ title: 'New stop', order: 0 }));
    expect(protectionReasons(input.before, input.proposed)).toEqual([]);
    input.proposed.events = [
      input.proposed.events[3],
      input.proposed.events[1],
      input.proposed.events[2],
    ].map((event, order) => ({ ...event, order }));
    expect(protectionReasons(input.before, input.proposed)).toContain('protected-order');
  });
  it('binds reviewed candidates to plan/context/scope/mode and rechecks time at apply', () => {
    const input = fixture();
    const snapshot = validateImpact(input).snapshot;
    expect(snapshotMatches(snapshot, input)).toBe(true);
    expect(snapshotMatches(snapshot, { ...input, contextRevision: 3 })).toBe(false);
    expect(snapshotMatches(snapshot, { ...input, planRevision: 4 })).toBe(false);
    expect(snapshotMatches(snapshot, { ...input, mode: 'transit' })).toBe(false);
    const moved = fixture();
    moved.observation!.coordinate!.lon += 0.001;
    expect(snapshotMatches(snapshot, moved)).toBe(false);
    const changedEvidence = fixture();
    changedEvidence.evidence![0].durationSeconds += 120;
    expect(snapshotMatches(snapshot, changedEvidence)).toBe(false);
    input.proposed.events[0].note = 'Changed after preview';
    expect(candidateDigest(input.proposed)).not.toBe(snapshot.candidateDigest);
    expect(snapshotMatches(snapshot, input)).toBe(false);
    input.proposed = fixture().proposed;
    expect(validateImpact({ ...input, now: input.now! + 300_001 }).status).toBe('unverified');
  });
  it('prioritizes verifiable alternatives and preserves the plan when none can be verified', () => {
    const verified = { id: 'safe', impact: validateImpact(fixture()) };
    const unknown = { id: 'unknown', impact: validateImpact({ ...fixture(), evidence: [] }) };
    expect(preferredVerifiedCandidate([unknown, verified])).toBe(verified);
    expect(preferredVerifiedCandidate([unknown])).toBeUndefined();
  });
});
