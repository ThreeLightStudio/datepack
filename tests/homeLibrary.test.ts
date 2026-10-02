import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@datepack/core';
import { createDatePack, createMemoriesPack, type Experience } from '@datepack/core';
import {
  closeStorage,
  loadDeviceState,
  saveDeviceState,
  savePack,
  savePendingRequest,
  saveRuntime,
  type PendingRequest,
} from '../src/storage/indexedDb';
import {
  dismissToast,
  getStoreState,
  initStore,
  saveRecord,
  switchPack,
  exportPackById,
} from '../src/store/datepackStore';
import { summarizeActivity } from '../src/features/home/libraryActivity';
import { collectRecords, photoProblem, recordKey } from '../src/features/memories/recordLibrary';

const stamp = '2026-10-01T10:00:00Z';
const record: Experience = {
  id: 'memory',
  outcome: 'note',
  recordedAt: stamp,
  note: 'A moment without a plan',
};
beforeEach(async () => {
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  dismissToast();
  await closeStorage();
});

describe('home activity across selected documents', () => {
  it('keeps ready, waiting and review requests discoverable after photo saving and restart', async () => {
    const outings = [];
    for (const status of ['ready', 'waiting', 'review'] as const) {
      const pack = createDatePack({ title: status });
      await savePack(pack);
      const request: PendingRequest = {
        id: `request-${status}`,
        planId: pack.id,
        kind: 'remaining-change',
        status,
        input: `request ${status}`,
        baseRevision: pack.revision,
        contextRevision: 0,
        generatedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
        ...(status === 'review' ? { answerText: 'A preserved reply' } : {}),
      };
      await savePendingRequest(request, null);
      outings.push(pack);
    }
    const saved = await saveRecord(
      { ...record, note: undefined, assetIds: ['photo'] },
      {
        assetWrites: [
          {
            asset: { id: 'photo', filename: 'photo.png', mimeType: 'image/png' },
            blob: new Blob(['photo'], { type: 'image/png' }),
          },
        ],
      },
    );
    expect(getStoreState().document?.id).toBe(saved.id);
    expect(
      getStoreState()
        .savedActivities.filter((item) => item.request)
        .map((item) => item.request?.status)
        .sort(),
    ).toEqual(['ready', 'review', 'waiting']);
    await closeStorage();
    await initStore();
    expect(getStoreState().pack).toBeNull();
    expect(getStoreState().savedActivities.filter((item) => item.request)).toHaveLength(3);
    await switchPack(outings[2].id);
    expect(getStoreState().pendingRequest?.answerText).toBe('A preserved reply');
  });

  it('reads explicit outing state outside the selected memory document', async () => {
    const outing = createDatePack({ title: 'Confirmed outing', date: '2026-10-01' });
    await savePack(outing);
    const device = await loadDeviceState(outing.id);
    await saveDeviceState({
      ...device,
      liveContext: {
        planId: outing.id,
        revision: 0,
        updatedAt: stamp,
        confirmedAt: stamp,
        place: 'A place entered by the user',
      },
    });
    await saveRecord(record);
    await initStore();
    expect(
      getStoreState().savedActivities.find((item) => item.packId === outing.id)?.continuing,
    ).toBe(true);
    expect(getStoreState().document?.kind).toBe('memories');
  });

  it('does not infer a started outing from today, an elapsed date, or completed stops', async () => {
    for (const date of ['2026-10-01', '2020-01-01']) {
      const pack = createDatePack({ title: date, date });
      expect(summarizeActivity(pack, {}).continuing).toBe(false);
      expect(
        summarizeActivity(
          pack,
          {},
          {
            planId: pack.id,
            updatedAt: stamp,
            events: { one: { eventId: 'one', status: 'completed' } },
          },
        ).continuing,
      ).toBe(false);
    }
    const pack = createDatePack({ title: 'Explicit current stop' });
    await savePack(pack);
    await saveRuntime({
      planId: pack.id,
      updatedAt: stamp,
      events: { one: { eventId: 'one', status: 'current' } },
    });
    await saveRecord(record);
    expect(
      getStoreState().savedActivities.find((item) => item.packId === pack.id)?.continuing,
    ).toBe(true);
  });

  it('discovers an independent memory-edit request while another document is selected', async () => {
    const memories = createMemoriesPack([record]);
    await savePack(memories);
    const request: PendingRequest = {
      id: 'memory-request',
      planId: memories.id,
      kind: 'memory-edit',
      status: 'waiting',
      input: 'Original words only',
      baseRevision: memories.revision,
      contextRevision: 0,
      generatedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
      payload: { experienceId: record.id, originalText: record.note },
    };
    await savePendingRequest(request, null);
    await saveRecord({ ...record, id: 'another' });
    const activity = getStoreState().savedActivities.find((item) => item.packId === memories.id);
    expect(activity?.request).toMatchObject({ kind: 'memory-edit', experienceId: record.id });
    await switchPack(memories.id);
    expect(getStoreState().pendingRequest?.input).toBe('Original words only');
  });
});

describe('device-wide record identity and photo support', () => {
  it('exports an independent photo document without changing the selected outing', async () => {
    const blob = new Blob(['persistent image bytes'], { type: 'image/png' });
    const memories = await saveRecord(
      { ...record, assetIds: ['image'] },
      {
        assetWrites: [
          { asset: { id: 'image', filename: 'photo.png', mimeType: 'image/png' }, blob },
        ],
      },
    );
    const outing = createDatePack({ title: 'Another plan' });
    await savePack(outing);
    await switchPack(outing.id);
    let file: Blob | undefined;
    vi.spyOn(core, 'downloadBlob').mockImplementation((blob) => {
      file = blob;
    });
    await exportPackById(memories.id);
    expect(getStoreState().document?.id).toBe(outing.id);
    const read = await core.readDatePack(file!);
    expect(read.pack.kind).toBe('memories');
    expect(read.pack.plan).toBeUndefined();
    expect(read.pack.experiences[0].note).toBe(record.note);
    expect(await read.blobs.get('image')?.text()).toBe(await blob.text());
  });
  it('shows file-copy records independently even when their experience IDs match', () => {
    const original = createMemoriesPack([record]);
    const copy = { ...structuredClone(original), id: 'copy-document' };
    const rows = collectRecords([{ pack: original }, { pack: copy }]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(recordKey)).size).toBe(2);
    expect(rows.map((row) => row.experience.note)).toEqual([record.note, record.note]);
  });
  it('accepts supported images with missing browser MIME but rejects original HEIC and empty files', () => {
    expect(photoProblem({ name: 'iPhone-converted.JPG', type: '', size: 10 })).toBeNull();
    expect(
      photoProblem({ name: 'iPhone-converted.heic', type: 'image/jpeg', size: 10 }),
    ).toBeNull();
    expect(photoProblem({ name: 'iPhone.heic', type: 'image/heic', size: 10 })).toBe('heic');
    expect(photoProblem({ name: 'iPhone.heif', type: '', size: 10 })).toBe('heic');
    expect(photoProblem({ name: 'image.avif', type: 'image/avif', size: 10 })).toBe('unsupported');
    expect(photoProblem({ name: 'empty.png', type: 'image/png', size: 0 })).toBe('empty');
  });
});
