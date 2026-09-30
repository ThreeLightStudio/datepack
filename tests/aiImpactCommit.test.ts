import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatePack, createEvent, describePatch, parsePatch } from '@datepack/core';
import {
  closeStorage,
  loadDeviceState,
  loadPack,
  savePack,
  saveDeviceState,
  setCurrentPackId,
  type PendingRequest,
} from '../src/storage/indexedDb';
import { applyAiPlan, getStoreState, initStore, dismissToast } from '../src/store/datepackStore';
import { clearRouteMemory } from '../src/features/day/routeImpact';
import { clearLocalObservations } from '../src/features/day/location';
import { parseAiResponse } from '../src/features/ai/exchange';

beforeEach(async () => {
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  clearRouteMemory();
  clearLocalObservations();
});
afterEach(async () => {
  dismissToast();
  await closeStorage();
});

async function reviewedRequest() {
  const pack = createDatePack({ title: 'Unscheduled date' });
  pack.plan.events = [{ ...createEvent({ id: 'cafe', title: 'Cafe', order: 0 }), placeId: 'old' }];
  pack.plan.places = [
    { id: 'old', name: 'Old Cafe' },
    { id: 'new', name: 'New Cafe' },
  ];
  const stamp = new Date().toISOString();
  const request: PendingRequest = {
    id: 'reviewed-r',
    planId: pack.plan.id,
    kind: 'next-change',
    baseRevision: 0,
    contextRevision: 0,
    generatedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
    status: 'review',
    scopeEventIds: ['cafe'],
    input: 'Request',
    answerText: 'Reviewed answer',
    responseFingerprint: 'fingerprint',
  };
  await savePack(pack);
  await saveDeviceState({ planId: pack.plan.id, undoStack: [], pendingRequest: request });
  await setCurrentPackId(pack.plan.id);
  await initStore();
  return { pack, request };
}
describe('AI impact application boundary', () => {
  it('keeps parsed modern place/timing/new-event inputs intact through review and blocks their unverified commit', async () => {
    const { pack, request } = await reviewedRequest();
    const identity = {
      requestId: request.id,
      packId: request.planId,
      baseRevision: request.baseRevision,
      contextRevision: request.contextRevision,
      generatedAt: request.generatedAt,
      kind: request.kind,
    };
    const envelope = parseAiResponse(
      JSON.stringify({
        ...identity,
        type: 'datepack.response',
        version: 2,
        result: {
          type: 'datepack.patch',
          version: 1,
          operations: [
            {
              op: 'replace',
              target: 'cafe',
              value: {
                place: 'New public cafe',
                estimatedDurationMinutes: 20,
                timing: {
                  kind: 'window',
                  earliestStart: { dayOffset: 0, time: '16:50' },
                  latestStart: { dayOffset: 0, time: '17:20' },
                },
              },
            },
            {
              op: 'insertAfter',
              target: 'cafe',
              value: {
                title: 'Bookstore',
                place: 'Public bookstore',
                timing: { kind: 'unscheduled' },
                estimatedDurationMinutes: 10,
                protectedFields: ['content'],
              },
            },
          ],
        },
      }),
      identity,
    );
    if (!envelope.ok) throw new Error('Expected the response identity to match');
    const parsed = parsePatch(JSON.stringify(envelope.response.result));
    if (!parsed.ok) throw new Error('Expected the extended response to parse');
    const outcome = describePatch(pack.plan, parsed.patch);
    expect(outcome.canApply).toBe(true);
    expect(outcome.plan.events[0].timing.kind).toBe('window');
    expect(outcome.plan.events[1]).toMatchObject({
      timing: { kind: 'unscheduled' },
      protectedFields: ['content'],
      estimatedDurationMinutes: 10,
    });
    expect(outcome.plan.places?.find((p) => p.id === outcome.plan.events[0].placeId)?.name).toBe(
      'New public cafe',
    );
    expect(await applyAiPlan(request, outcome.plan)).toBe(false);
    expect((await loadPack(pack.plan.id))?.plan).toEqual(pack.plan);
    expect((await loadDeviceState(pack.plan.id)).undoStack).toHaveLength(0);
  });
  it('preserves pack, pending answer and undo when place changes have no real route evidence', async () => {
    const { pack, request } = await reviewedRequest();
    const proposed = structuredClone(pack.plan);
    proposed.events[0].placeId = 'new';
    proposed.events[0].travelMinutes = 0;
    expect(await applyAiPlan(request, proposed)).toBe(false);
    expect((await loadPack(pack.plan.id))?.plan.events[0].placeId).toBe('old');
    expect((await loadPack(pack.plan.id))?.revision).toBe(0);
    const device = await loadDeviceState(pack.plan.id);
    expect(device.pendingRequest?.answerText).toBe('Reviewed answer');
    expect(device.pendingRequest?.status).toBe('review');
    expect(device.undoStack).toHaveLength(0);
  });
  it('commits wording with no location/provider and records a single applied request and undo', async () => {
    const { pack, request } = await reviewedRequest();
    const proposed = structuredClone(pack.plan);
    proposed.events[0].note = 'Bring an umbrella';
    expect(await applyAiPlan(request, proposed)).toBe(true);
    expect(getStoreState().pack?.revision).toBe(1);
    expect((await loadPack(pack.plan.id))?.plan.events[0].note).toBe('Bring an umbrella');
    const device = await loadDeviceState(pack.plan.id);
    expect(device.pendingRequest?.status).toBe('applied');
    expect(device.undoStack).toHaveLength(1);
    expect(await applyAiPlan(request, proposed)).toBe(false);
    expect((await loadPack(pack.plan.id))?.revision).toBe(1);
  });
});
