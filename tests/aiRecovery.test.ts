import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatePack, parsePlanDraft } from '@datepack/core';
import * as storage from '../src/storage/indexedDb';
import {
  createAiDraftPack,
  dismissToast,
  getStoreState,
  initStore,
  markPendingRequestSent,
  savePendingAnswer,
  updatePendingRequest,
} from '../src/store/datepackStore';
import type { PendingRequest } from '../src/storage/indexedDb';

beforeEach(async () => {
  await storage.closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  dismissToast();
  await storage.closeStorage();
});

async function setup(kind: PendingRequest['kind'] = 'create') {
  const pack = createDatePack({ title: 'T04 recovery' });
  const stamp = '2026-10-01T07:40:00Z';
  const request: PendingRequest = {
    id: `T04-${kind}`,
    planId: pack.plan.id,
    kind,
    status: 'ready',
    input: 'Saved request',
    baseRevision: 0,
    contextRevision: 0,
    generatedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
  };
  if (kind === 'create') await createAiDraftPack(pack, request);
  else {
    await storage.savePack(pack);
    await storage.saveDeviceState({ planId: pack.plan.id, pendingRequest: request, undoStack: [] });
    await storage.setCurrentPackId(pack.plan.id);
    await initStore();
  }
  return { pack, request };
}

describe('T04 durable request recovery', () => {
  it.each(['create', 'next-change', 'remaining-change', 'memory-edit'] as const)(
    'retains unreviewed %s input, full answer and identity across restart',
    async (kind) => {
      const { pack, request } = await setup(kind);
      await Promise.all([
        savePendingAnswer(request.id, 'Partial reply'),
        savePendingAnswer(
          request.id,
          'Approved\n```json\n{"reply":"full"}\n```\nKeep this footer.',
        ),
      ]);
      await storage.closeStorage();
      await initStore();
      const restored = getStoreState().pendingRequest!;
      expect(restored).toMatchObject({
        id: request.id,
        kind,
        input: request.input,
        status: 'draft',
        answerText: 'Approved\n```json\n{"reply":"full"}\n```\nKeep this footer.',
        generatedAt: request.generatedAt,
      });
      expect((await storage.loadPack(pack.plan.id))?.revision).toBe(0);
    },
  );
  it('rejects a late preview from before the latest paste, then permits reviewing that latest paste', async () => {
    const { request } = await setup();
    await savePendingAnswer(request.id, 'Old answer');
    const old = getStoreState().pendingRequest!;
    await savePendingAnswer(request.id, 'Latest answer');
    await expect(
      updatePendingRequest({ ...old, status: 'review', responseFingerprint: 'old' }, old),
    ).rejects.toThrow('request-conflict');
    expect(getStoreState().pendingRequest?.answerText).toBe('Latest answer');
    const current = getStoreState().pendingRequest!;
    await updatePendingRequest(
      { ...current, status: 'review', responseFingerprint: 'latest' },
      current,
    );
    await markPendingRequestSent(request.id);
    expect(getStoreState().pendingRequest?.status).toBe('review');
  });
  it('keeps failed storage changes out of durable state and allows retrying the same answer', async () => {
    const { request } = await setup();
    const failure = vi
      .spyOn(storage, 'savePendingRequest')
      .mockRejectedValueOnce(new Error('disk-full'));
    await expect(savePendingAnswer(request.id, 'Kept by the input UI')).rejects.toThrow(
      'disk-full',
    );
    expect(getStoreState().pendingRequest?.status).toBe('ready');
    await savePendingAnswer(request.id, 'Kept by the input UI');
    expect(getStoreState().pendingRequest?.answerText).toBe('Kept by the input UI');
    expect(failure).toHaveBeenCalledTimes(2);
  });
  it.each(['applied', 'cancelled'] as const)(
    'cannot resurrect a %s identity by editing or an old review',
    async (status) => {
      const { request } = await setup();
      await updatePendingRequest({ ...request, status });
      const terminal = getStoreState().pendingRequest!;
      await expect(savePendingAnswer(request.id, 'Late reply')).rejects.toThrow('request-conflict');
      await expect(updatePendingRequest({ ...terminal, status: 'review' })).rejects.toThrow(
        'request-conflict',
      );
      expect(getStoreState().pendingRequest?.status).toBe(status);
    },
  );
  it('persists form inputs independently of plans and preserves undecided timing and order when importing', async () => {
    const form = {
      region: '성수',
      date: '',
      startTime: '',
      endTime: '',
      notes: '  Original\nnotes  ',
    };
    await storage.saveAiFormDraft('create', form);
    await storage.closeStorage();
    expect(await storage.loadAiFormDraft('create')).toEqual(form);
    const parsed = parsePlanDraft(
      JSON.stringify({
        type: 'datepack.plan',
        version: 1,
        title: 'Existing AI draft',
        events: [
          { title: 'Unset', protectedFields: ['order'] },
          { title: 'Next day', timing: { kind: 'exact', start: { dayOffset: 1, time: '00:20' } } },
        ],
      }),
      { allowUndated: true },
    );
    expect(parsed.ok).toBe(true);
    const response = parsePlanDraft(
      '{"type":"datepack.response","version":2,"result":{"type":"datepack.plan","version":1,"title":"Other request","events":[]}}',
      { allowEmpty: true, allowUndated: true },
    );
    expect(response.ok).toBe(false);
  });
  it('removes plan-specific form drafts when their plan is deleted', async () => {
    const { pack } = await setup();
    await storage.saveAiFormDraft(`memory:${pack.plan.id}`, { note: 'Draft original' });
    await storage.saveAiFormDraft(`replan:${pack.plan.id}`, { customInput: 'Draft situation' });
    await storage.deletePack(pack.plan.id);
    expect(await storage.loadAiFormDraft(`memory:${pack.plan.id}`)).toBeUndefined();
    expect(await storage.loadAiFormDraft(`replan:${pack.plan.id}`)).toBeUndefined();
  });
});
