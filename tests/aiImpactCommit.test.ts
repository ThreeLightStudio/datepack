import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatePack, createEvent } from '@datepack/core';
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
