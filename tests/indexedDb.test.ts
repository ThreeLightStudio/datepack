import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatePack, type DatePlan, type LegacyDatePack } from '@datepack/core';
import {
  closeStorage,
  commitPlanChange,
  commitUndo,
  commitExperienceChange,
  getAssetBlob,
  deletePack,
  listPackAssetBlobs,
  listPacks,
  loadDeviceState,
  loadPack,
  saveDeviceState,
  saveImportedPack,
  savePack,
} from '../src/storage/indexedDb';
import { openDB } from 'idb';

async function clearDatabase(): Promise<void> {
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database blocked'));
  });
}

beforeEach(clearDatabase);
afterEach(closeStorage);

describe('device IndexedDB persistence', () => {
  it('commits plan and undo atomically and rejects a concurrent stale revision', async () => {
    const initial = createDatePack({ title: 'Test', date: '2026-09-29' });
    await savePack(initial);
    const a: DatePlan = { ...initial.plan, title: 'Tab A' };
    const b: DatePlan = { ...initial.plan, title: 'Tab B' };
    const results = await Promise.allSettled([
      commitPlanChange(initial.plan.id, 0, 'A', a),
      commitPlanChange(initial.plan.id, 0, 'B', b),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const saved = await loadPack(initial.plan.id);
    expect(saved?.revision).toBe(1);
    const device = await loadDeviceState(initial.plan.id);
    expect(device.undoStack).toHaveLength(1);

    const invalidClonePlan = { ...saved!.plan, transient: () => 'not cloneable' } as DatePlan;
    const asset = { id: 'test-image', filename: 'image.png', mimeType: 'image/png' };
    await expect(
      commitPlanChange(
        initial.plan.id,
        1,
        'broken',
        invalidClonePlan,
        [asset],
        [{ asset, blob: new Blob(['data'], { type: 'image/png' }) }],
      ),
    ).rejects.toBeTruthy();
    expect((await loadPack(initial.plan.id))?.revision).toBe(1);
    expect((await loadDeviceState(initial.plan.id)).undoStack).toHaveLength(1);
    expect(await getAssetBlob(initial.plan.id, asset.id)).toBeUndefined();
  });

  it('retains pending requests and undo through a database restart', async () => {
    const pack = createDatePack({ title: 'Test', date: '2026-09-29' });
    await savePack(pack);
    await commitPlanChange(pack.plan.id, 0, 'Rename', { ...pack.plan, title: 'Changed' });
    await saveDeviceState({
      planId: pack.plan.id,
      undoStack: [],
      pendingRequest: {
        id: 'request-1',
        planId: pack.plan.id,
        status: 'waiting',
        input: 'adjust this',
        baseRevision: 1,
        contextRevision: 2,
        createdAt: '2026-09-29T00:00:00.000Z',
        updatedAt: '2026-09-29T00:00:00.000Z',
      },
      liveContext: {
        planId: pack.plan.id,
        revision: 2,
        updatedAt: '2026-09-29T00:00:00.000Z',
        place: 'Seoul',
      },
    });
    await closeStorage();
    const reopened = await loadDeviceState(pack.plan.id);
    expect(reopened.pendingRequest?.id).toBe('request-1');
    expect(reopened.liveContext?.revision).toBe(2);
    expect(reopened.undoStack).toHaveLength(1);
  });

  it('uses create-only semantics and rejects stale explicit import replacement', async () => {
    const pack = createDatePack({ title: 'Original', date: '2026-09-29' });
    const creations = await Promise.allSettled([savePack(pack), savePack(pack)]);
    expect(creations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(savePack(pack)).rejects.toThrow('pack-exists');

    const imported = { ...pack, plan: { ...pack.plan, title: 'Imported' } };
    const explicitReplacement = { ...pack, plan: { ...pack.plan, title: 'Explicit replacement' } };
    await commitPlanChange(pack.plan.id, 0, 'Concurrent tab', {
      ...pack.plan,
      title: 'Concurrent tab',
    });
    await expect(savePack(explicitReplacement, 0)).rejects.toThrow('revision-conflict');
    await expect(saveImportedPack(imported, new Blob(['source']), [], 0)).rejects.toThrow(
      'revision-conflict',
    );
    expect((await loadPack(pack.plan.id))?.plan.title).toBe('Concurrent tab');
    expect(await listPackAssetBlobs(pack.plan.id)).toEqual(new Map());
    const db = await openDB('datepack');
    expect(await db.getAll('sourceBackups')).toEqual([]);
    db.close();

    const replaced = await saveImportedPack(imported, new Blob(['source']), [], 1);
    expect(replaced.revision).toBe(2);
    expect(replaced.plan.title).toBe('Imported');
  });

  it('migrates old bytes once and preserves the source and experience identity on retry', async () => {
    const old = await openDB('datepack', 2, {
      upgrade(db) {
        db.createObjectStore('packs');
        db.createObjectStore('assets', { keyPath: 'key' }).createIndex('byPack', 'packId');
        db.createObjectStore('runtime');
        db.createObjectStore('meta');
      },
    });
    const legacy: LegacyDatePack = {
      manifest: { format: 'datepack', version: '2.0', entry: 'plan.json' },
      plan: {
        id: 'legacy-plan',
        title: 'Old plan',
        date: '2026-09-29',
        events: [{ id: 'legacy-event', title: 'Dinner', type: 'meal', start: '18:00' }],
      },
      assets: [],
    };
    const original = { pack: legacy, savedAt: '2026-09-28T00:00:00.000Z' };
    const invalidOriginal = {
      ...original,
      pack: {
        ...legacy,
        plan: { ...legacy.plan, events: [{ ...legacy.plan.events[0]!, title: '' }] },
      },
    };
    await old.put('packs', invalidOriginal, 'legacy-plan');
    await old.put(
      'runtime',
      {
        planId: 'legacy-plan',
        updatedAt: '2026-09-28T01:00:00.000Z',
        events: { 'legacy-event': { eventId: 'legacy-event', status: 'completed' } },
      },
      'legacy-plan',
    );
    old.close();

    await expect(loadPack('legacy-plan')).rejects.toBeTruthy();
    await closeStorage();
    const failedCheck = await openDB('datepack');
    expect(await failedCheck.get('packs', 'legacy-plan')).toEqual(invalidOriginal);
    failedCheck.close();
    const retryDb = await openDB('datepack');
    await retryDb.put('packs', original, 'legacy-plan');
    retryDb.close();

    const first = await loadPack('legacy-plan');
    await closeStorage();
    const second = await loadPack('legacy-plan');
    expect(first?.experiences.map((experience) => experience.id)).toEqual([
      'experience-legacy-legacy-plan-legacy-event',
    ]);
    expect(second?.experiences).toHaveLength(1);
    const check = await openDB('datepack');
    expect(await check.get('packs', 'legacy-plan')).toEqual(original);
    expect(await check.get('sourceBackups', 'legacy-plan')).toMatchObject({ source: original });
    check.close();
  });

  it('undo restores only the plan while keeping newer context and runtime facts intact', async () => {
    const pack = createDatePack({ title: 'Test', date: '2026-09-29' });
    await savePack(pack);
    await commitPlanChange(pack.plan.id, 0, 'Rename', { ...pack.plan, title: 'Changed' });
    const device = await loadDeviceState(pack.plan.id);
    device.liveContext = {
      planId: pack.plan.id,
      revision: 4,
      updatedAt: '2026-09-29T00:00:00.000Z',
    };
    device.personalJourney = {
      planId: pack.plan.id,
      updatedAt: '2026-09-29T00:00:00.000Z',
      origin: 'Home',
    };
    await saveDeviceState(device);
    const latestExperience = {
      id: 'experience-later',
      title: 'Dinner',
      outcome: 'completed' as const,
      recordedAt: '2026-09-29T01:00:00.000Z',
    };
    await commitExperienceChange(pack.plan.id, 1, [latestExperience]);
    await expect(commitExperienceChange(pack.plan.id, 1, pack.experiences)).rejects.toThrow(
      'revision-conflict',
    );
    expect((await loadPack(pack.plan.id))?.baselinePlan.title).toBe('Changed');
    await commitUndo(pack.plan.id, 2);
    const restored = await loadPack(pack.plan.id);
    const local = await loadDeviceState(pack.plan.id);
    expect(restored?.plan.title).toBe('Test');
    expect(restored?.revision).toBe(3);
    expect(restored?.experiences.map((experience) => experience.id)).toEqual(['experience-later']);
    expect(restored?.baselinePlan.title).toBe('Changed');
    expect(local.liveContext?.revision).toBe(4);
    expect(local.personalJourney?.origin).toBe('Home');
  });

  it('does not resurrect a deliberately deleted migrated legacy pack', async () => {
    const old = await openDB('datepack', 2, {
      upgrade(db) {
        db.createObjectStore('packs');
        db.createObjectStore('assets', { keyPath: 'key' }).createIndex('byPack', 'packId');
        db.createObjectStore('runtime');
        db.createObjectStore('meta');
      },
    });
    const legacy: LegacyDatePack = {
      manifest: { format: 'datepack', version: '2.0', entry: 'plan.json' },
      plan: { id: 'deleted-plan', title: 'To delete', date: '2026-09-29', events: [] },
      assets: [],
    };
    await old.put('packs', { pack: legacy, savedAt: '2026-09-29T00:00:00Z' }, 'deleted-plan');
    old.close();
    expect(await loadPack('deleted-plan')).toBeDefined();
    await deletePack('deleted-plan');
    await closeStorage();
    expect(await loadPack('deleted-plan')).toBeUndefined();
    expect(await listPacks()).toEqual([]);
    const check = await openDB('datepack');
    expect(await check.get('packs', 'deleted-plan')).toBeDefined();
    expect(await check.get('sourceBackups', 'deleted-plan')).toBeDefined();
    check.close();
  });
});
