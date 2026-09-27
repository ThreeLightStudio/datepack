import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DatePack, DatePackAsset, DatePackRuntimeState } from '../datepack/types';

interface DatePackDB extends DBSchema {
  packs: { key: string; value: { pack: DatePack; savedAt: string } };
  assets: {
    key: string; // `${packId}:${assetId}`
    value: { key: string; packId: string; assetId: string; blob: Blob; filename: string };
    indexes: { byPack: string };
  };
  runtime: {
    key: string; // planId
    value: DatePackRuntimeState;
  };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'datepack';
const DB_VERSION = 2;
const CURRENT_PACK_KEY = 'currentPackId';

let dbPromise: Promise<IDBPDatabase<DatePackDB>> | null = null;

function getDb(): Promise<IDBPDatabase<DatePackDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DatePackDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 shipped a broken "packs" keyPath (pack.id instead of pack.plan.id);
        // drop and recreate it — its data was never written successfully.
        if (oldVersion < 2) {
          if (db.objectStoreNames.contains('packs')) db.deleteObjectStore('packs');
          db.createObjectStore('packs');
          if (!db.objectStoreNames.contains('assets')) {
            const assets = db.createObjectStore('assets', { keyPath: 'key' });
            assets.createIndex('byPack', 'packId');
          }
          if (!db.objectStoreNames.contains('runtime')) db.createObjectStore('runtime');
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        }
      },
    });
  }
  return dbPromise;
}

function assetKey(packId: string, assetId: string): string {
  return `${packId}:${assetId}`;
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export async function savePack(pack: DatePack): Promise<void> {
  const db = await getDb();
  await db.put('packs', { pack, savedAt: new Date().toISOString() }, pack.plan.id);
}

export async function listPacks(): Promise<Array<{ pack: DatePack; savedAt: string }>> {
  const db = await getDb();
  const all = await db.getAll('packs');
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function loadPack(packId: string): Promise<DatePack | undefined> {
  const db = await getDb();
  return (await db.get('packs', packId))?.pack;
}

export async function deletePack(packId: string): Promise<void> {
  const db = await getDb();
  await db.delete('packs', packId);
  const assetKeys = await db.getAllKeysFromIndex('assets', 'byPack', packId);
  await Promise.all(assetKeys.map((key) => db.delete('assets', key)));
  await db.delete('runtime', packId);
  if ((await db.get('meta', CURRENT_PACK_KEY)) === packId) {
    await db.delete('meta', CURRENT_PACK_KEY);
  }
}

// ---------------------------------------------------------------------------
// Assets (blobs)
// ---------------------------------------------------------------------------

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
  const map = new Map<string, Blob>();
  for (const row of rows) map.set(row.assetId, row.blob);
  return map;
}

export async function replacePackAssets(
  packId: string,
  entries: Array<{ asset: DatePackAsset; blob: Blob }>,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('assets', 'readwrite');
  const store = tx.objectStore('assets');
  for (const key of await store.index('byPack').getAllKeys(packId)) {
    void store.delete(key);
  }
  for (const { asset, blob } of entries) {
    void store.put({
      key: assetKey(packId, asset.id),
      packId,
      assetId: asset.id,
      blob,
      filename: asset.filename,
    });
  }
  await tx.done;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export async function saveRuntime(state: DatePackRuntimeState): Promise<void> {
  const db = await getDb();
  await db.put('runtime', state, state.planId);
}

export async function loadRuntime(planId: string): Promise<DatePackRuntimeState | undefined> {
  const db = await getDb();
  return db.get('runtime', planId);
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export async function setCurrentPackId(packId: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', packId, CURRENT_PACK_KEY);
}

export async function getCurrentPackId(): Promise<string | undefined> {
  const db = await getDb();
  return (await db.get('meta', CURRENT_PACK_KEY)) as string | undefined;
}
