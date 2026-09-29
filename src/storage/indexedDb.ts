import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  migrateLegacyDatePack,
  validateDatePack,
  type DatePack,
  type DatePackAsset,
  type DatePackRuntimeState,
  type DatePlan,
  type LegacyDatePack,
} from '@datepack/core';

export type LiveContext = {
  planId: string;
  revision: number;
  updatedAt: string;
  place?: string;
  activity?: string;
  nextPlaceId?: string;
  confirmedAt?: string;
};
export type PersonalJourney = {
  planId: string;
  updatedAt: string;
  origin?: string;
  mode?: string;
  note?: string;
};
export type PendingRequest = {
  id: string;
  planId: string;
  status: 'draft' | 'ready' | 'waiting' | 'review';
  input: string;
  baseRevision: number;
  contextRevision: number;
  createdAt: string;
  updatedAt: string;
  payload?: unknown;
};
export type StoredUndoEntry = {
  label: string;
  plan: DatePlan;
  assets: DatePackAsset[];
  revision: number;
};
export type DeviceState = {
  planId: string;
  liveContext?: LiveContext;
  personalJourney?: PersonalJourney;
  pendingRequest?: PendingRequest;
  undoStack: StoredUndoEntry[];
};

interface DatePackDB extends DBSchema {
  /** Kept intact for compatibility with v1/v2 data. */
  packs: { key: string; value: unknown };
  packsV3: { key: string; value: { pack: DatePack; savedAt: string } };
  assets: {
    key: string;
    value: { key: string; packId: string; assetId: string; blob: Blob; filename: string };
    indexes: { byPack: string };
  };
  runtime: { key: string; value: DatePackRuntimeState };
  meta: { key: string; value: unknown };
  device: { key: string; value: DeviceState };
  sourceBackups: { key: string; value: { planId: string; source: unknown; savedAt: string } };
}

const DB_NAME = 'datepack';
const DB_VERSION = 3;
const CURRENT_PACK_KEY = 'currentPackId';
let dbPromise: Promise<IDBPDatabase<DatePackDB>> | null = null;

export async function closeStorage(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

function getDb(): Promise<IDBPDatabase<DatePackDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DatePackDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Never delete legacy stores: conversion is done lazily and committed
        // alongside a retained source backup after validation succeeds.
        if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs');
        if (!db.objectStoreNames.contains('assets')) {
          const assets = db.createObjectStore('assets', { keyPath: 'key' });
          assets.createIndex('byPack', 'packId');
        }
        if (!db.objectStoreNames.contains('runtime')) db.createObjectStore('runtime');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('packsV3')) db.createObjectStore('packsV3');
        if (!db.objectStoreNames.contains('device')) db.createObjectStore('device');
        if (!db.objectStoreNames.contains('sourceBackups')) db.createObjectStore('sourceBackups');
        // v1 used a packs keyPath that cannot be changed in place. Its store
        // and values remain untouched; v3 uses packsV3 as the canonical store.
        void oldVersion;
      },
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

function assetKey(packId: string, assetId: string): string {
  return `${packId}:${assetId}`;
}
function defaultDevice(planId: string): DeviceState {
  return { planId, undoStack: [] };
}
function abortReadWrite(tx: { done: Promise<unknown>; abort: () => void }): void {
  void tx.done.catch(() => undefined);
  tx.abort();
}
function validate(pack: DatePack): void {
  const result = validateDatePack(pack);
  if (!result.ok)
    throw new Error(`Invalid DatePack: ${result.errors.map((e) => e.key).join(', ')}`);
}
function unwrapLegacy(value: unknown): { pack: unknown; savedAt: string } | null {
  if (value && typeof value === 'object' && 'pack' in value) {
    const row = value as { pack: unknown; savedAt?: unknown };
    return {
      pack: row.pack,
      savedAt: typeof row.savedAt === 'string' ? row.savedAt : new Date().toISOString(),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pack reads and atomic revision-checked writes
// ---------------------------------------------------------------------------

export async function savePack(pack: DatePack): Promise<void> {
  validate(pack);
  const db = await getDb();
  await db.put('packsV3', { pack, savedAt: new Date().toISOString() }, pack.plan.id);
}

export async function listPacks(): Promise<Array<{ pack: DatePack; savedAt: string }>> {
  const db = await getDb();
  for (const key of await db.getAllKeys('packs')) {
    if (typeof key !== 'string' || (await db.get('packsV3', key))) continue;
    try {
      await loadPack(key);
    } catch (error) {
      console.error('[datepack] legacy pack migration failed', key, error);
    }
  }
  return (await db.getAll('packsV3')).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function loadPack(packId: string): Promise<DatePack | undefined> {
  const db = await getDb();
  const current = await db.get('packsV3', packId);
  if (current) return current.pack;
  const stored = await db.get('packs', packId);
  const old =
    unwrapLegacy(stored) ??
    (stored && typeof stored === 'object'
      ? { pack: stored, savedAt: new Date().toISOString() }
      : null);
  if (!old || !old.pack || typeof old.pack !== 'object') return undefined;
  const raw = old.pack as Partial<LegacyDatePack>;
  if (!raw.plan || !raw.manifest) return undefined;
  if (raw.manifest.version === '3.0') {
    const pack = raw as DatePack;
    validate(pack);
    const tx = db.transaction(['packsV3', 'packs', 'sourceBackups'], 'readwrite');
    const raced = await tx.objectStore('packsV3').get(packId);
    if (!raced) {
      await tx.objectStore('packsV3').put({ pack, savedAt: old.savedAt }, packId);
      await tx
        .objectStore('sourceBackups')
        .put({ planId: packId, source: stored, savedAt: new Date().toISOString() }, packId);
    }
    await tx.done;
    return raced?.pack ?? pack;
  }
  const runtime = await db.get('runtime', packId);
  const migrated = migrateLegacyDatePack(raw as LegacyDatePack, runtime).pack;
  validate(migrated);
  const tx = db.transaction(
    ['packsV3', 'packs', 'runtime', 'device', 'sourceBackups'],
    'readwrite',
  );
  const raced = await tx.objectStore('packsV3').get(packId);
  if (!raced) {
    await tx.objectStore('packsV3').put({ pack: migrated, savedAt: old.savedAt }, packId);
    await tx
      .objectStore('sourceBackups')
      .put({ planId: packId, source: stored, savedAt: new Date().toISOString() }, packId);
    await tx.objectStore('device').put(defaultDevice(packId), packId);
    // Runtime statuses represented as experiences are cleared only after both
    // writes commit; runtime itself stays available for compatibility.
  }
  await tx.done;
  return raced ? await loadPack(packId) : migrated;
}

export async function commitPlanChange(
  planId: string,
  expectedRevision: number,
  label: string,
  nextPlan: DatePlan,
  nextAssets?: DatePackAsset[],
  assetWrites: Array<{ asset: DatePackAsset; blob: Blob }> = [],
): Promise<DatePack> {
  const db = await getDb();
  const tx = db.transaction(['packsV3', 'device', 'assets'], 'readwrite');
  const row = await tx.objectStore('packsV3').get(planId);
  if (!row) {
    abortReadWrite(tx);
    throw new Error('pack-missing');
  }
  if (row.pack.revision !== expectedRevision) {
    abortReadWrite(tx);
    throw new Error('revision-conflict');
  }
  if (nextPlan.id !== planId) throw new Error('plan-id-change-rejected');
  const pack: DatePack = {
    ...row.pack,
    plan: nextPlan,
    ...(nextAssets ? { assets: nextAssets } : {}),
    revision: row.pack.revision + 1,
    manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
  };
  validate(pack);
  const existing = (await tx.objectStore('device').get(planId)) ?? defaultDevice(planId);
  const device: DeviceState = {
    ...existing,
    undoStack: [
      ...existing.undoStack,
      {
        label,
        plan: structuredClone(row.pack.plan),
        assets: structuredClone(row.pack.assets),
        revision: pack.revision,
      },
    ].slice(-20),
  };
  await tx.objectStore('packsV3').put({ ...row, pack }, planId);
  await tx.objectStore('device').put(device, planId);
  const assets = tx.objectStore('assets');
  for (const { asset, blob } of assetWrites) {
    await assets.put({
      key: assetKey(planId, asset.id),
      packId: planId,
      assetId: asset.id,
      blob,
      filename: asset.filename,
    });
  }
  await tx.done;
  return pack;
}

export async function commitUndo(
  planId: string,
  expectedRevision: number,
): Promise<{ pack: DatePack; label: string }> {
  const db = await getDb();
  const tx = db.transaction(['packsV3', 'device'], 'readwrite');
  const row = await tx.objectStore('packsV3').get(planId);
  const existing = await tx.objectStore('device').get(planId);
  if (!row || !existing?.undoStack.length) {
    abortReadWrite(tx);
    throw new Error('undo-unavailable');
  }
  if (row.pack.revision !== expectedRevision) {
    abortReadWrite(tx);
    throw new Error('revision-conflict');
  }
  const undoStack = [...existing.undoStack];
  const entry = undoStack.pop()!;
  const pack: DatePack = {
    ...row.pack,
    plan: entry.plan,
    assets: entry.assets,
    revision: row.pack.revision + 1,
    manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
  };
  validate(pack);
  await tx.objectStore('packsV3').put({ ...row, pack }, planId);
  await tx.objectStore('device').put({ ...existing, undoStack }, planId);
  await tx.done;
  return { pack, label: entry.label };
}

export async function saveDeviceState(
  value: DeviceState,
  expectedContextRevision?: number,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('device', 'readwrite');
  const current = (await tx.store.get(value.planId)) ?? defaultDevice(value.planId);
  if (
    expectedContextRevision !== undefined &&
    (current.liveContext?.revision ?? 0) !== expectedContextRevision
  ) {
    abortReadWrite(tx);
    throw new Error('context-revision-conflict');
  }
  await tx.store.put({ ...value, undoStack: current.undoStack }, value.planId);
  await tx.done;
}
export async function loadDeviceState(planId: string): Promise<DeviceState> {
  const db = await getDb();
  return (await db.get('device', planId)) ?? defaultDevice(planId);
}

// ---------------------------------------------------------------------------
// Legacy storage and binary assets
// ---------------------------------------------------------------------------

export async function deletePack(packId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['packsV3', 'assets', 'runtime', 'device', 'meta'], 'readwrite');
  await tx.objectStore('packsV3').delete(packId);
  const assets = tx.objectStore('assets');
  for (const key of await assets.index('byPack').getAllKeys(packId)) await assets.delete(key);
  await tx.objectStore('runtime').delete(packId);
  await tx.objectStore('device').delete(packId);
  if ((await tx.objectStore('meta').get(CURRENT_PACK_KEY)) === packId)
    await tx.objectStore('meta').delete(CURRENT_PACK_KEY);
  await tx.done;
}
export async function putAsset(packId: string, asset: DatePackAsset, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('assets', {
    key: assetKey(packId, asset.id),
    packId,
    assetId: asset.id,
    blob,
    filename: asset.filename,
  });
}
export async function getAssetBlob(packId: string, assetId: string): Promise<Blob | undefined> {
  const db = await getDb();
  return (await db.get('assets', assetKey(packId, assetId)))?.blob;
}
export async function removeAssetBlob(packId: string, assetId: string): Promise<void> {
  const db = await getDb();
  await db.delete('assets', assetKey(packId, assetId));
}
export async function listPackAssetBlobs(packId: string): Promise<Map<string, Blob>> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('assets', 'byPack', packId);
  return new Map(rows.map((row) => [row.assetId, row.blob]));
}
export async function replacePackAssets(
  packId: string,
  entries: Array<{ asset: DatePackAsset; blob: Blob }>,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('assets', 'readwrite');
  const store = tx.objectStore('assets');
  for (const key of await store.index('byPack').getAllKeys(packId)) await store.delete(key);
  for (const { asset, blob } of entries)
    await store.put({
      key: assetKey(packId, asset.id),
      packId,
      assetId: asset.id,
      blob,
      filename: asset.filename,
    });
  await tx.done;
}

export async function saveImportedPack(
  pack: DatePack,
  source: Blob,
  entries: Array<{ asset: DatePackAsset; blob: Blob }>,
): Promise<DatePack> {
  validate(pack);
  const db = await getDb();
  const tx = db.transaction(['packsV3', 'sourceBackups', 'assets', 'device'], 'readwrite');
  const savedAt = new Date().toISOString();
  const prior = await tx.objectStore('packsV3').get(pack.plan.id);
  const storedPack = prior
    ? {
        ...pack,
        revision: prior.pack.revision + 1,
        manifest: { ...pack.manifest, updatedAt: savedAt },
      }
    : pack;
  validate(storedPack);
  await tx.objectStore('packsV3').put({ pack: storedPack, savedAt }, pack.plan.id);
  await tx
    .objectStore('sourceBackups')
    .put({ planId: pack.plan.id, source, savedAt }, pack.plan.id);
  const store = tx.objectStore('assets');
  for (const key of await store.index('byPack').getAllKeys(pack.plan.id)) await store.delete(key);
  for (const { asset, blob } of entries) {
    await store.put({
      key: assetKey(pack.plan.id, asset.id),
      packId: pack.plan.id,
      assetId: asset.id,
      blob,
      filename: asset.filename,
    });
  }
  if (prior) {
    const device =
      (await tx.objectStore('device').get(pack.plan.id)) ?? defaultDevice(pack.plan.id);
    await tx.objectStore('device').put({ ...device, undoStack: [] }, pack.plan.id);
  }
  await tx.done;
  return storedPack;
}
export async function saveRuntime(state: DatePackRuntimeState): Promise<void> {
  const db = await getDb();
  await db.put('runtime', state, state.planId);
}
export async function loadRuntime(planId: string): Promise<DatePackRuntimeState | undefined> {
  const db = await getDb();
  return db.get('runtime', planId);
}
export async function setCurrentPackId(packId: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', packId, CURRENT_PACK_KEY);
}
export async function getCurrentPackId(): Promise<string | undefined> {
  const db = await getDb();
  return (await db.get('meta', CURRENT_PACK_KEY)) as string | undefined;
}
