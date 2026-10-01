import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import {
  createDatePack,
  createEvent,
  createMemoriesPack,
  readDatePack,
  writeDatePack,
  type Experience,
  type DatePack,
} from '@datepack/core';
import {
  closeStorage,
  saveExperience,
  moveExperience,
  deleteExperience,
  deletePack,
  loadPack,
  savePack,
  listPacks,
  listExperiences,
  getAssetBlob,
  listPackAssetBlobs,
  saveImportedPack,
  commitPlanChange,
  loadAiFormDraft,
  loadDeviceState,
  saveDeviceState,
  savePendingRequest,
  commitUndo,
  type PendingRequest,
} from '../src/storage/indexedDb';
import {
  initStore,
  saveRecord,
  getStoreState,
  dismissToast,
  updatePendingRequest,
  applyAiMemoryNote,
} from '../src/store/datepackStore';
import * as storage from '../src/storage/indexedDb';
import { buildMemoryPrompt } from '../src/features/memories/aiMemory';
import { parseAiResponse } from '../src/features/ai/exchange';

const stamp = '2026-10-01T03:00:00Z';
const photo = { id: 'photo', filename: 'photo.jpg', mimeType: 'image/jpeg' };
const blob = new Blob(['photo bytes'], { type: photo.mimeType });
const record: Experience = {
  id: 'record',
  outcome: 'note',
  recordedAt: stamp,
  occurredOn: '2026-09-25',
  timing: { kind: 'approximate', period: 'afternoon' },
  assetIds: [photo.id],
  note: 'Original\nexact text',
  editedNote: 'Reviewed text',
};
async function newRecord() {
  return saveExperience(record, { assetWrites: [{ asset: photo, blob }] });
}
async function newOuting() {
  const pack = createDatePack({ title: 'Walk' });
  pack.id = `document-${pack.id}`;
  pack.plan.events.push(createEvent({ id: 'walk', title: 'Walk' }));
  pack.originalPlan = structuredClone(pack.plan);
  await savePack(pack);
  return pack;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  dismissToast();
  await closeStorage();
});

function failWrite(storeName: string, predicate: (value: unknown) => boolean = () => true) {
  const original = IDBObjectStore.prototype.put;
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (this.name === storeName && predicate(value))
      throw new DOMException('Disk full', 'QuotaExceededError');
    return original.call(this, value, key);
  });
}

describe('4.0 record persistence and ownership', () => {
  it('saves photos without a title or plan and restores the selected document after restart', async () => {
    const pack = await saveExperience(
      { ...record, note: undefined, editedNote: undefined },
      { assetWrites: [{ asset: photo, blob }] },
    );
    await closeStorage();
    await initStore();
    expect(getStoreState().document?.id).toBe(pack.id);
    expect(getStoreState().pack).toBeNull();
    expect(getStoreState().savedDocuments).toHaveLength(1);
    expect(getStoreState().document?.experiences[0].title).toBeUndefined();
    expect(await getAssetBlob(pack.id, photo.id)).toMatchObject({ size: blob.size });
    expect(await listExperiences()).toMatchObject([
      { packId: pack.id, kind: 'memories', experience: { id: record.id } },
    ]);
  });

  it('keeps both photos and records absent if creation fails midway, then retries the same selection', async () => {
    const fail = failWrite('assets');
    await expect(newRecord()).rejects.toThrow('Disk full');
    expect(await listPacks()).toEqual([]);
    const db = await openDB('datepack');
    try {
      expect(await db.getAll('assets')).toEqual([]);
    } finally {
      db.close();
    }
    fail.mockRestore();
    expect((await newRecord()).experiences).toEqual([record]);
  });

  it('links, changes activity, changes plan, then detaches with all content and photos retained', async () => {
    const source = await newRecord(),
      outing = await newOuting(),
      other = await newOuting();
    const connected = await moveExperience(source.id, 0, record.id, {
      packId: outing.id,
      expectedRevision: 0,
      eventId: 'walk',
    });
    expect(await loadPack(source.id)).toBeUndefined();
    expect(connected.target.experiences[0]).toEqual({ ...record, eventId: 'walk' });
    expect(await getAssetBlob(outing.id, photo.id)).toMatchObject({ size: blob.size });
    const planOnly = await moveExperience(outing.id, 1, record.id, {
      packId: outing.id,
      expectedRevision: 1,
    });
    expect(planOnly.target.experiences[0]).toEqual(record);
    const changed = await moveExperience(outing.id, 2, record.id, {
      packId: other.id,
      expectedRevision: 0,
    });
    expect(changed.source?.experiences).toEqual([]);
    expect(await getAssetBlob(outing.id, photo.id)).toBeUndefined();
    const detached = await moveExperience(other.id, 1, record.id);
    expect(detached.target.kind).toBe('memories');
    expect(detached.target.experiences).toEqual([record]);
    await closeStorage();
    expect((await loadPack(detached.target.id))?.experiences).toEqual([record]);
    expect(await getAssetBlob(detached.target.id, photo.id)).toMatchObject({ size: blob.size });
  });

  it('rolls back a late move failure after binary copying and source removal; rejects stale and invalid destinations', async () => {
    const source = await newRecord(),
      outing = await newOuting();
    const fail = failWrite(
      'packsV4',
      (value) => (value as { pack: DatePack }).pack.id === outing.id,
    );
    await expect(
      moveExperience(source.id, 0, record.id, { packId: outing.id, expectedRevision: 0 }),
    ).rejects.toThrow('Disk full');
    fail.mockRestore();
    expect((await loadPack(source.id))?.experiences).toEqual([record]);
    expect((await loadPack(outing.id))?.experiences).toEqual([]);
    expect(await getAssetBlob(source.id, photo.id)).toBeDefined();
    expect(await getAssetBlob(outing.id, photo.id)).toBeUndefined();
    await expect(
      moveExperience(source.id, 0, record.id, { packId: outing.id, expectedRevision: 1 }),
    ).rejects.toThrow('revision-conflict');
    await expect(
      moveExperience(source.id, 0, record.id, {
        packId: outing.id,
        expectedRevision: 0,
        eventId: 'missing',
      }),
    ).rejects.toThrow('event-missing');
    expect(
      (await moveExperience(source.id, 0, record.id, { packId: outing.id, expectedRevision: 0 }))
        .target.experiences,
    ).toEqual([record]);
  });

  it('retains shared source photos and remaps colliding destination assets without changing record identity', async () => {
    const source = createMemoriesPack([record, { ...record, id: 'other-record' }], [photo]);
    const outgoing = await saveImportedPack(source, new Blob(['source']), [{ asset: photo, blob }]);
    const target = await newOuting();
    await saveExperience(
      { id: 'existing-photo', outcome: 'note', recordedAt: stamp, assetIds: [photo.id] },
      {
        packId: target.id,
        expectedRevision: 0,
        assetWrites: [
          { asset: photo, blob: new Blob(['different bytes'], { type: photo.mimeType }) },
        ],
      },
    );
    const moved = await moveExperience(outgoing.id, 0, record.id, {
      packId: target.id,
      expectedRevision: 1,
    });
    const saved = moved.target.experiences.find((item) => item.id === record.id)!;
    expect(saved.assetIds?.[0]).not.toBe(photo.id);
    expect(saved.note).toBe(record.note);
    expect(await (await getAssetBlob(target.id, saved.assetIds![0]))?.text()).toBe('photo bytes');
    expect(await (await getAssetBlob(target.id, photo.id))?.text()).toBe('different bytes');
    expect(await getAssetBlob(outgoing.id, photo.id)).toBeDefined();
    expect(moved.source?.experiences).toEqual([{ ...record, id: 'other-record' }]);
  });

  it('deletes a plan while preserving all connected records as an exportable standalone document', async () => {
    const source = await newRecord(),
      outing = await newOuting();
    await moveExperience(source.id, 0, record.id, {
      packId: outing.id,
      expectedRevision: 0,
      eventId: 'walk',
    });
    const fail = failWrite('assets');
    await expect(deletePack(outing.id, 1)).rejects.toThrow('Disk full');
    fail.mockRestore();
    expect((await loadPack(outing.id))?.experiences[0].eventId).toBe('walk');
    const kept = await deletePack(outing.id, 1);
    expect(kept?.kind).toBe('memories');
    expect(kept?.experiences).toEqual([record]);
    expect(await loadPack(outing.id)).toBeUndefined();
    const binaries = await listPackAssetBlobs(kept!.id);
    const file = await writeDatePack(kept!, (id) => binaries.get(id));
    expect((await readDatePack(file.blob)).pack.experiences).toEqual([record]);
    await deleteExperience(kept!.id, 0, record.id);
    expect(await listPacks()).toEqual([]);
  });

  it.each(['outing', 'memories'] as const)(
    'deduplicates %s file round trips and imports conflicts as copies without overwriting',
    async (kind) => {
      const pack = kind === 'outing' ? await newOuting() : await newRecord();
      const binaries = await listPackAssetBlobs(pack.id);
      const file = await writeDatePack(pack, (id) => binaries.get(id));
      const imported = await readDatePack(file.blob);
      const entries = imported.pack.assets.flatMap((asset) => {
        const binary = imported.blobs.get(asset.id);
        return binary ? [{ asset, blob: binary }] : [];
      });
      const same = await saveImportedPack(imported.pack, file.blob, entries);
      expect(same.id).toBe(pack.id);
      expect((await listPacks()).length).toBe(1);
      const changed = {
        ...imported.pack,
        meta: { ...imported.pack.meta, title: 'Different content' },
      };
      const copy = await saveImportedPack(changed, file.blob, entries);
      expect(copy.id).not.toBe(pack.id);
      expect((await loadPack(pack.id))?.meta.title).toBe(pack.meta.title);
      expect((await listPacks()).length).toBe(2);
      const sameCopy = await saveImportedPack(changed, file.blob, entries);
      expect(sameCopy.id).toBe(copy.id);
      expect((await listPacks()).length).toBe(2);
      if (kind === 'memories') expect(await getAssetBlob(copy.id, photo.id)).toBeDefined();
    },
  );

  it('creates a copy for changed binary content even if document fields match', async () => {
    const pack = await newRecord();
    const copy = await saveImportedPack(pack, new Blob(['source']), [
      { asset: photo, blob: new Blob(['changed photo'], { type: photo.mimeType }) },
    ]);
    expect(copy.id).not.toBe(pack.id);
    expect(await (await getAssetBlob(pack.id, photo.id))?.text()).toBe('photo bytes');
  });

  it('rolls back an edited record if its new photo fails after the document write', async () => {
    const source = await newRecord();
    const added = { ...photo, id: 'new-photo' };
    const fail = failWrite('assets');
    await expect(
      saveExperience(
        { ...record, note: 'Changed', assetIds: [photo.id, added.id] },
        { packId: source.id, expectedRevision: 0, assetWrites: [{ asset: added, blob }] },
      ),
    ).rejects.toThrow('Disk full');
    fail.mockRestore();
    expect(await loadPack(source.id)).toEqual(source);
    expect(await getAssetBlob(source.id, added.id)).toBeUndefined();
  });

  it('keeps record photos through plan undo and deletes only photos exclusively belonging to a deleted record', async () => {
    const outing = await newOuting();
    await commitPlanChange(outing, 0, 'Rename', { ...outing.plan, title: 'Renamed' });
    await saveExperience(record, {
      packId: outing.id,
      expectedRevision: 1,
      assetWrites: [{ asset: photo, blob }],
    });
    const undone = await commitUndo(outing.id, 2);
    expect(undone.pack.plan.title).toBe('Walk');
    expect(undone.pack.experiences).toEqual([record]);
    expect(undone.pack.assets).toEqual([photo]);
    await deleteExperience(outing.id, 3, record.id);
    expect((await loadPack(outing.id))?.assets).toEqual([]);
    expect(await getAssetBlob(outing.id, photo.id)).toBeUndefined();
  });

  it('reports a durable record save successfully even when the subsequent library refresh fails', async () => {
    await initStore();
    vi.spyOn(storage, 'listPacks').mockRejectedValueOnce(new Error('refresh failed'));
    const saved = await saveRecord(record, { assetWrites: [{ asset: photo, blob }] });
    expect(getStoreState().document?.id).toBe(saved.id);
    expect((await loadPack(saved.id))?.experiences).toEqual([record]);
    expect(await getAssetBlob(saved.id, photo.id)).toBeDefined();
    expect((await listPacks()).length).toBe(1);
  });

  it('restricts plan mutations to outing documents', async () => {
    const pack = await newRecord();
    await expect(
      // @ts-expect-error the union cannot be passed to a plan-only mutation
      commitPlanChange(pack, 0, 'invalid', createDatePack({ title: 'Fake' }).plan),
    ).rejects.toThrow('outing-required');
    const outing = await newOuting();
    expect(
      (await commitPlanChange(outing, 0, 'rename', { ...outing.plan, title: 'Renamed' })).plan
        .title,
    ).toBe('Renamed');
  });
});

describe('device 3.0 conversion', () => {
  it('preserves plans, photos, records, revisions, runtime, requests and in-progress input; retries after an atomic migration failure', async () => {
    const pack = createDatePack({ title: 'Existing local outing', date: '2026-09-25' });
    pack.plan.events = [createEvent({ id: 'visit', title: 'Existing stop' })];
    pack.originalPlan = structuredClone(pack.plan);
    const v3 = {
      manifest: { ...pack.manifest, version: '3.0' },
      plan: pack.plan,
      baselinePlan: pack.originalPlan,
      experiences: [record],
      revision: 7,
      assets: [photo],
    };
    const old = await openDB('datepack', 4, {
      upgrade(db) {
        for (const name of [
          'packs',
          'packsV3',
          'runtime',
          'meta',
          'device',
          'sourceBackups',
          'deletedPacks',
        ])
          db.createObjectStore(name);
        db.createObjectStore('assets', { keyPath: 'key' }).createIndex('byPack', 'packId');
      },
    });
    const oldRow = { pack: v3, savedAt: stamp };
    const draft = {
      note: 'Still writing',
      selectedExperienceId: record.id,
      conversation: 'Raw unsubmitted input',
    };
    const request = {
      id: 'existing-request',
      planId: pack.id,
      kind: 'memory-edit',
      status: 'draft',
      input: 'Existing prompt',
      answerText: 'Half-pasted answer',
      baseRevision: 7,
      contextRevision: 3,
      generatedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
      payload: { experienceId: record.id, originalText: record.note },
    };
    const device = {
      planId: pack.id,
      contextRevision: 3,
      pendingRequest: request,
      undoStack: [{ label: 'Previous edit', plan: pack.plan, assets: [photo], revision: 7 }],
    };
    const runtime = {
      planId: pack.id,
      updatedAt: stamp,
      events: { visit: { eventId: 'visit', status: 'pending' } },
    };
    await old.put('packsV3', oldRow, pack.id);
    await old.put('device', device, pack.id);
    await old.put('runtime', runtime, pack.id);
    await old.put('meta', draft, `ai-form:memory:${pack.id}`);
    await old.put('meta', pack.id, 'currentPackId');
    await old.put('assets', {
      key: `${pack.id}:${photo.id}`,
      packId: pack.id,
      assetId: photo.id,
      blob,
      filename: photo.filename,
    });
    old.close();
    const failure = failWrite('sourceBackups');
    await expect(loadPack(pack.id)).rejects.toThrow('Disk full');
    await closeStorage();
    const check = await openDB('datepack');
    try {
      expect(await check.get('packsV3', pack.id)).toEqual(oldRow);
      expect(await check.get('packsV4', pack.id)).toBeUndefined();
      expect(await check.get('meta', `migration:v4:${pack.id}`)).toBeUndefined();
      expect(await check.get('device', pack.id)).toEqual(device);
    } finally {
      check.close();
    }
    failure.mockRestore();
    const migrated = await loadPack(pack.id);
    expect(migrated).toMatchObject({
      id: pack.id,
      kind: 'outing',
      manifest: { version: '4.0' },
      plan: v3.plan,
      originalPlan: v3.baselinePlan,
      experiences: [record],
      revision: 7,
      assets: [photo],
    });
    expect(await loadAiFormDraft(`memory:${pack.id}`)).toEqual(draft);
    expect(await loadDeviceState(pack.id)).toEqual(device);
    expect(await getAssetBlob(pack.id, photo.id)).toMatchObject({ size: blob.size });
    await closeStorage();
    expect(await loadPack(pack.id)).toEqual(migrated);
    const successful = await openDB('datepack');
    try {
      expect(await successful.get('packsV3', pack.id)).toEqual(oldRow);
      expect(await successful.get('sourceBackups', `v4:${pack.id}`)).toMatchObject({
        source: oldRow,
      });
      expect(await successful.get('meta', `migration:v4:${pack.id}`)).toMatchObject({
        sourceVersion: '3.0',
      });
      expect(await successful.get('runtime', pack.id)).toEqual(runtime);
    } finally {
      successful.close();
    }
  });
});

async function prepareMemoryReview(pack: DatePack) {
  const identity = {
    requestId: 'memory-request',
    packId: pack.id,
    baseRevision: pack.revision,
    contextRevision: 0,
    generatedAt: stamp,
    kind: 'memory-edit' as const,
  };
  const prompt = buildMemoryPrompt(pack.experiences[0], identity, 'en');
  const answerText = JSON.stringify({
    type: 'datepack.response',
    version: 2,
    ...identity,
    result: { experienceId: record.id, editedText: 'Polished wording' },
  });
  const ready: PendingRequest = {
    id: identity.requestId,
    planId: pack.id,
    kind: identity.kind,
    status: 'ready',
    input: prompt,
    baseRevision: pack.revision,
    contextRevision: 0,
    generatedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
    payload: { experienceId: record.id, originalText: record.note },
  };
  await savePendingRequest(ready, null);
  await initStore();
  await updatePendingRequest({
    ...ready,
    status: 'review',
    answerText,
    responseFingerprint: 'review-fingerprint',
  });
  return { identity, ready, prompt, answerText };
}

describe('standalone record AI protection', () => {
  it('polishes only the selected original, preserves facts, and rejects duplicate application', async () => {
    const pack = await newRecord();
    const { identity, ready, prompt, answerText } = await prepareMemoryReview(pack);
    expect(prompt).toContain(record.note!);
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('Walk');
    expect(
      parseAiResponse(answerText, { ...identity, requestId: 'different-request' }),
    ).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(await applyAiMemoryNote(ready, record.id, 'Polished wording')).toBe(true);
    expect((await loadPack(pack.id))?.experiences[0]).toEqual({
      ...record,
      editedNote: 'Polished wording',
    });
    expect((await loadDeviceState(pack.id)).pendingRequest?.status).toBe('applied');
    expect(await applyAiMemoryNote(ready, record.id, 'Polished wording')).toBe(false);
    await closeStorage();
    await initStore();
    expect(getStoreState().document?.experiences[0].note).toBe(record.note);
    expect(getStoreState().document?.experiences[0].editedNote).toBe('Polished wording');
  });

  it('marks an old reply stale after the original record changes and retains the new original', async () => {
    const pack = await newRecord();
    const { ready } = await prepareMemoryReview(pack);
    await saveExperience(
      { ...record, note: 'New original' },
      { packId: pack.id, expectedRevision: 0 },
    );
    await initStore();
    expect(await applyAiMemoryNote(ready, record.id, 'Polished wording')).toBe(false);
    expect((await loadPack(pack.id))?.experiences[0].note).toBe('New original');
    expect((await loadDeviceState(pack.id)).pendingRequest?.status).toBe('stale');
  });
});
