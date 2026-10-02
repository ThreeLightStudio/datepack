import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDatePack,
  createEvent,
  readDatePack as readAnyDatePack,
  sortEventsByOrder,
  writeDatePack,
} from '@datepack/core';
import type { DatePlan } from '@datepack/core';
import * as storage from '../src/storage/indexedDb';
import {
  commitReviewedReorder,
  dismissToast,
  getStoreState,
  initStore,
  prepareReorder,
  prepareReorderTimeAdjustment,
  undo,
} from '../src/store/datepackStore';
import { adjustReorderedTimes, reorderPlan } from '../src/features/plan/reorder';
import {
  clearRouteMemory,
  hasRouteImpact,
  prepareImpact,
  protectionReasons,
  setResolvedPlaces,
  validateImpact,
} from '../src/features/day/routeImpact';
import {
  coordinateKey,
  FOOT_ENDPOINT,
  type RouteProvider,
} from '../src/features/day/routeProvider';
import { getAiScopeEventIds } from '../src/features/ai/promptBuilder';
import { computeDayContext } from '../src/features/day/dayRuntime';

const NOW = new Date('2026-10-01T16:00:00+09:00').getTime();
function plan(): DatePlan {
  const pack = createDatePack({ title: 'Reorder fixture', date: '2026-10-01' });
  return {
    ...pack.plan,
    availableFrom: { dayOffset: 0, time: '16:00' },
    places: [
      { id: 'venue', name: 'Public venue' },
      { id: 'restaurant', name: 'Restaurant' },
    ],
    events: [
      createEvent({
        id: 'a',
        title: 'Read',
        order: 0,
        placeId: 'venue',
        estimatedDurationMinutes: 10,
      }),
      createEvent({
        id: 'b',
        title: 'Talk',
        order: 1,
        placeId: 'venue',
        estimatedDurationMinutes: 20,
      }),
      createEvent({
        id: 'booking',
        title: '18:00 booking',
        order: 2,
        start: '18:00',
        end: '19:00',
        placeId: 'restaurant',
        fixed: true,
      }),
    ],
  };
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  clearRouteMemory();
  await storage.closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterEach(async () => {
  dismissToast();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearRouteMemory();
  await storage.closeStorage();
});
async function setup(input = plan()) {
  const pack = createDatePack({ title: input.title });
  pack.id = input.id;
  pack.plan = input;
  pack.originalPlan = structuredClone(input);
  pack.experiences = [
    {
      id: 'experience',
      eventId: 'a',
      title: 'Recorded reading',
      outcome: 'note',
      recordedAt: new Date(NOW).toISOString(),
      note: 'Original note',
    },
  ];
  await storage.savePack(pack);
  await storage.setCurrentPackId(input.id);
  await initStore();
  return pack;
}
function routeFixture(input: DatePlan, seconds = 600) {
  const places = input.places!.map((p, index) => ({
    placeId: p.id,
    coordinate: { lat: 37.56 + index / 100, lon: 126.98 },
    source: 'test-fixture',
    querySnapshot: JSON.stringify([p.name, p.mapQuery ?? '']),
    resolvedAt: new Date(NOW).toISOString(),
    userConfirmed: true,
  }));
  const provider: RouteProvider = {
    fetchRoute: vi.fn(async (leg) => ({
      ok: true as const,
      evidence: {
        id: `${leg.fromKey}-${leg.toKey}`,
        provider: 'test-only',
        endpoint: FOOT_ENDPOINT,
        mode: leg.mode,
        fromKey: leg.fromKey,
        toKey: leg.toKey,
        coordinateDigest: coordinateKey(leg.from, leg.to),
        fetchedAt: new Date().toISOString(),
        departureAt: leg.departureAt,
        durationSeconds: seconds,
        distanceMeters: 100,
        basis: 'osm-static' as const,
        attribution: 'OSM fixture',
      },
    })),
  };
  return { places, provider };
}
describe('direct itinerary order', () => {
  it('uses explicit order, keeps same gap/own row/unknown targets as no-ops', async () => {
    const input = plan();
    input.events.reverse();
    expect(reorderPlan(input, 'a', 'b')).toBeNull();
    expect(reorderPlan(input, 'a', 'a')).toBeNull();
    expect(reorderPlan(input, 'a', 'missing')).toBeNull();
    expect(reorderPlan(input, 'missing', null)).toBeNull();
    expect(reorderPlan(input, 'booking', null)).toBeNull();
    expect(reorderPlan(input, 'b', 'a')?.events.map((e) => [e.id, e.order])).toEqual([
      ['b', 0],
      ['a', 1],
      ['booking', 2],
    ]);
    const source = await readFile(
      new URL('../examples/t05-reorder.datepack.json', import.meta.url),
      'utf8',
    );
    const fixture = await readDatePack(new Blob([source], { type: 'application/json' }));
    expect(fixture.warnings).toEqual([]);
    expect(hasRouteImpact(fixture.pack.plan, reorderPlan(fixture.pack.plan, 'talk', 'read')!)).toBe(
      false,
    );
    expect(
      protectionReasons(fixture.pack.plan, reorderPlan(fixture.pack.plan, 'read', null)!),
    ).toContain('protected-order');
  });
  it('only treats an unchanged single venue untimed block as no route impact', async () => {
    const before = plan();
    const proposed = reorderPlan(before, 'b', 'a')!;
    const provider = { fetchRoute: vi.fn() };
    expect(
      (await prepareImpact({ before, proposed, planRevision: 0, contextRevision: 0 }, provider))
        .reasonCodes,
    ).toEqual(['no-route-impact']);
    expect(provider.fetchRoute).not.toHaveBeenCalled();
    expect(proposed.events[0].timing.kind).toBe('unscheduled');
    const different = structuredClone(before);
    different.events[1].placeId = 'restaurant';
    expect(hasRouteImpact(different, reorderPlan(different, 'b', 'a')!)).toBe(true);
    const unknown = structuredClone(before);
    delete unknown.events[1].estimatedDurationMinutes;
    expect(hasRouteImpact(unknown, reorderPlan(unknown, 'b', 'a')!)).toBe(true);
    const timed = structuredClone(before);
    timed.events[0].timing = { kind: 'exact', start: { dayOffset: 0, time: '16:00' } };
    expect(hasRouteImpact(timed, reorderPlan(timed, 'b', 'a')!)).toBe(true);
    proposed.events[0].note = 'Changed';
    // Content edits can be no route impact, but never sneak timing/place changes through.
    proposed.events[0].estimatedDurationMinutes = 120;
    expect(hasRouteImpact(before, proposed)).toBe(true);
  });
  it('blocks crossing a protected anchor in either direction even at the same venue', async () => {
    const before = plan();
    for (const [id, target] of [
      ['a', null],
      ['booking', 'a'],
    ] as const) {
      const proposed = reorderPlan(before, id, target)!;
      expect(protectionReasons(before, proposed)).toContain('protected-order');
      expect(validateImpact({ before, proposed, planRevision: 0, contextRevision: 0 }).status).toBe(
        'impossible',
      );
    }
    await setup(before);
    const review = (await prepareReorder('a', null))!;
    expect(await commitReviewedReorder(review)).toBe(false);
    expect((await storage.loadPack(before.id))?.revision).toBe(0);
  });
  it('saves/undoes atomically and agrees with day, AI scope and portable file after reopening', async () => {
    const pack = await setup();
    expect(await prepareReorder('a', 'b')).toBeNull();
    const review = (await prepareReorder('b', 'a'))!;
    expect(await commitReviewedReorder(review)).toBe(true);
    await storage.closeStorage();
    await initStore();
    const stored = getStoreState().pack!;
    expect(stored.revision).toBe(1);
    expect(stored.experiences).toEqual(pack.experiences);
    expect(stored.originalPlan).toEqual(pack.originalPlan);
    expect(getStoreState().undoStack).toHaveLength(1);
    expect(
      computeDayContext(stored.plan, null, new Date(NOW)).events.map((e) => e.event.id),
    ).toEqual(['b', 'a', 'booking']);
    expect(getAiScopeEventIds(stored.plan, null, 'remaining-change', new Date(NOW))).toEqual([
      'b',
      'a',
      'booking',
    ]);
    const portable = await readDatePack((await writeDatePack(stored, async () => undefined)).blob);
    if (portable.pack)
      expect(sortEventsByOrder(portable.pack.plan.events).map((e) => e.id)).toEqual([
        'b',
        'a',
        'booking',
      ]);
    await undo();
    expect(getStoreState().pack?.plan).toEqual(pack.plan);
    expect(getStoreState().pack?.revision).toBe(2);
    expect(getStoreState().undoStack).toHaveLength(0);
    expect(await commitReviewedReorder(review)).toBe(false);
  });
  it('rejects stale context inside the transaction, altered candidate and expired review without partial writes', async () => {
    const pack = await setup();
    const review = (await prepareReorder('b', 'a'))!;
    await storage.saveDeviceFields(pack.plan.id, {
      liveContext: {
        planId: pack.plan.id,
        revision: 1,
        updatedAt: new Date().toISOString(),
        place: 'New situation',
      },
    });
    expect(await commitReviewedReorder(review)).toBe(false);
    expect((await storage.loadPack(pack.plan.id))?.revision).toBe(0);
    expect((await storage.loadDeviceState(pack.plan.id)).undoStack).toHaveLength(0);
    await initStore();
    const modified = (await prepareReorder('b', 'a'))!;
    modified.proposed.events[0].note = 'Changed after preview';
    expect(await commitReviewedReorder(modified)).toBe(false);
    const expired = (await prepareReorder('b', 'a'))!;
    vi.setSystemTime(NOW + 300_001);
    expect(await commitReviewedReorder(expired)).toBe(false);
  });
  it('preserves plan and undo after storage failure, then retries the same review', async () => {
    const pack = await setup();
    const review = (await prepareReorder('b', 'a'))!;
    vi.spyOn(storage, 'commitPlanChange').mockRejectedValueOnce(new Error('quota'));
    expect(await commitReviewedReorder(review)).toBe(false);
    expect((await storage.loadPack(pack.plan.id))?.revision).toBe(0);
    expect(getStoreState().pack?.plan).toEqual(pack.plan);
    expect(await commitReviewedReorder(review)).toBe(true);
  });
  it('rejects an external plan commit in the transaction without overwriting it', async () => {
    const pack = await setup();
    const review = (await prepareReorder('b', 'a'))!;
    const external = structuredClone(pack.plan);
    external.memo = 'Changed in another tab';
    await storage.commitPlanChange(pack, 0, 'External edit', external);
    expect(await commitReviewedReorder(review)).toBe(false);
    expect((await storage.loadPack(pack.plan.id))?.plan).toEqual(external);
    expect((await storage.loadDeviceState(pack.plan.id)).undoStack).toHaveLength(1);
  });
  it('rechecks place evidence freshness even within the preview TTL', async () => {
    const before = plan();
    before.events[1].placeId = 'restaurant';
    await setup(before);
    const review = (await prepareReorder('b', 'a'))!;
    const fixture = routeFixture(review.proposed);
    fixture.places.forEach((place) => {
      place.resolvedAt = new Date(NOW - 300_000).toISOString();
    });
    setResolvedPlaces(before.id, fixture.places);
    review.impact = await prepareImpact(
      { before, proposed: review.proposed, planRevision: 0, contextRevision: 0, phase: 'plan' },
      fixture.provider,
    );
    expect(review.impact.status).toBe('verified');
    vi.setSystemTime(NOW + 1);
    expect(await commitReviewedReorder(review)).toBe(false);
    expect((await storage.loadPack(before.id))?.revision).toBe(0);
  });
  it('validates every changed leg through the downstream booking and rechecks route TTL at commit', async () => {
    const before = plan();
    before.events[1].placeId = 'restaurant';
    await setup(before);
    const review = (await prepareReorder('b', 'a'))!;
    expect(review.impact.status).toBe('unverified');
    const fixture = routeFixture(review.proposed);
    setResolvedPlaces(before.id, fixture.places);
    review.impact = await prepareImpact(
      { before, proposed: review.proposed, planRevision: 0, contextRevision: 0, phase: 'plan' },
      fixture.provider,
    );
    expect(fixture.provider.fetchRoute).toHaveBeenCalledTimes(2);
    expect(review.impact.affectedEventIds).toEqual(['b', 'a', 'booking']);
    expect(review.impact.status).toBe('verified');
    expect(await commitReviewedReorder(review)).toBe(true);
    await undo();
    const late = await prepareImpact(
      {
        before,
        proposed: review.proposed,
        planRevision: 2,
        contextRevision: getStoreState().contextRevision,
        phase: 'plan',
        evidence: [],
      },
      routeFixture(review.proposed, 3600).provider,
    );
    expect(late).toMatchObject({ status: 'impossible', reasonCodes: ['anchor-late'] });
    const stale = (await prepareReorder('b', 'a'))!;
    vi.setSystemTime(NOW + 300_001);
    expect(await commitReviewedReorder(stale)).toBe(false);
  });
  it('previews optional time adjustment without changing untimed activities or protected times', async () => {
    const before = plan();
    before.events[0] = createEvent({
      ...before.events[0],
      start: '16:00',
      end: '16:20',
      timing: {
        kind: 'exact',
        start: { dayOffset: 0, time: '16:00' },
        end: { dayOffset: 0, time: '16:20' },
      },
    });
    before.events[1] = createEvent({
      ...before.events[1],
      start: '16:30',
      end: '16:50',
      timing: {
        kind: 'exact',
        start: { dayOffset: 0, time: '16:30' },
        end: { dayOffset: 0, time: '16:50' },
      },
    });
    await setup(before);
    const review = (await prepareReorder('b', 'a'))!;
    const adjusted = (await prepareReorderTimeAdjustment(review))!;
    expect(adjusted.proposed.events[1].start).toBe('16:50');
    expect(adjusted.proposed.events[1].end).toBe('17:10');
    expect(adjusted.proposed.events[2]).toEqual(before.events[2]);
    expect((await storage.loadPack(before.id))?.revision).toBe(0);
    expect(adjusted.impact.status).toBe('unverified');
    expect(await commitReviewedReorder(adjusted)).toBe(false);
    const untimed = plan();
    expect(adjustReorderedTimes(untimed)).toBeNull();
    untimed.events[0].estimatedDurationMinutes = 20.5;
    untimed.events[1].timing = { kind: 'exact', start: { dayOffset: 0, time: '16:10' } };
    expect(adjustReorderedTimes(untimed)?.events[1].timing).toMatchObject({
      start: { dayOffset: 0, time: '16:21' },
    });
    const nextDay = structuredClone(before);
    nextDay.events[1].timing = {
      kind: 'exact',
      start: { dayOffset: 0, time: '23:50' },
      end: { dayOffset: 1, time: '00:10' },
    };
    const shifted = adjustReorderedTimes(reorderPlan(nextDay, 'b', 'a')!)!;
    expect(shifted.events[1].timing).toMatchObject({ start: { dayOffset: 1, time: '00:10' } });
  });
});

async function readDatePack(file: Blob) {
  const result = await readAnyDatePack(file);
  if (result.pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return { ...result, pack: result.pack };
}
