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
  nextPlace?: string;
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
  kind: 'create' | 'next-change' | 'remaining-change' | 'memory-edit';
  status: 'draft' | 'ready' | 'waiting' | 'review' | 'applied' | 'cancelled' | 'stale' | 'error';
  input: string;
  baseRevision: number;
  contextRevision: number;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  answerText?: string;
  responseFingerprint?: string;
  scopeEventIds?: string[];
  error?: string;
  payload?: unknown;
};
export type AiCommitGuard = {
  requestId: string;
  kind: PendingRequest['kind'];
  baseRevision: number;
  contextRevision: number;
  generatedAt: string;
  responseFingerprint: string;
  answerText: string;
  requestUpdate: PendingRequest;
};
export type PendingRequestGuard = Pick<
  PendingRequest,
  | 'id'
  | 'kind'
  | 'status'
  | 'baseRevision'
  | 'contextRevision'
  | 'generatedAt'
  | 'updatedAt'
  | 'answerText'
  | 'responseFingerprint'
>;

export async function savePendingRequest(
  request: PendingRequest | undefined,
  expected: PendingRequestGuard | null,
): Promise<void> {
  if (!request) throw new Error('request-required');
  const db = await getDb();
  const tx = db.transaction(['packsV3', 'device'], 'readwrite');
  const row = await tx.objectStore('packsV3').get(request.planId);
  if (!row) {
    abortReadWrite(tx);
    throw new Error('pack-missing');
  }
  const store = tx.objectStore('device');
  const current = (await store.get(request.planId)) ?? defaultDevice(request.planId);
  const actual = current.pendingRequest;
  const matches =
    expected === null
      ? actual === undefined
      : Boolean(
          actual &&
          actual.id === expected.id &&
          actual.kind === expected.kind &&
          actual.status === expected.status &&
          actual.baseRevision === expected.baseRevision &&
          actual.contextRevision === expected.contextRevision &&
          actual.generatedAt === expected.generatedAt &&
          actual.updatedAt === expected.updatedAt &&
          actual.answerText === expected.answerText &&
          actual.responseFingerprint === expected.responseFingerprint,
        );
  if (!matches) {
    abortReadWrite(tx);
    throw new Error('request-conflict');
  }
  if (['ready', 'waiting', 'review'].includes(request.status)) {
    if (row.pack.revision !== request.baseRevision) {
      abortReadWrite(tx);
      throw new Error('revision-conflict');
    }
    if (
      (current.contextRevision ?? current.liveContext?.revision ?? 0) !== request.contextRevision
    ) {
      abortReadWrite(tx);
      throw new Error('context-revision-conflict');
    }
  }
  if (
    actual &&
    actual.id === request.id &&
    (actual.planId !== request.planId ||
      actual.kind !== request.kind ||
      actual.baseRevision !== request.baseRevision ||
      actual.contextRevision !== request.contextRevision ||
      actual.generatedAt !== request.generatedAt)
  ) {
    abortReadWrite(tx);
    throw new Error('request-conflict');
  }
  await store.put({ ...current, pendingRequest: structuredClone(request) }, request.planId);
  await tx.done;
}
export type StoredUndoEntry = {
  label: string;
  plan: DatePlan;
  assets: DatePackAsset[];
  revision: number;
};
export type DeviceState = {
  planId: string;
  contextRevision?: number;
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
  deletedPacks: { key: string; value: { planId: string; deletedAt: string } };
}

const DB_NAME = 'datepack';
const DB_VERSION = 4;
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
        if (!db.objectStoreNames.contains('deletedPacks')) db.createObjectStore('deletedPacks');
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
  return { planId, contextRevision: 0, undoStack: [] };
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
function hasUnestablishedBlankBaseline(pack: DatePack): boolean {
  if (pack.plan.events.length === 0 || pack.baselinePlan.events.length !== 0) return false;
  return JSON.stringify({ ...pack.plan, events: [] }) === JSON.stringify(pack.baselinePlan);
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

export async function savePack(
  pack: DatePack,
  expectedRevision?: number,
  resetDevice = false,
  initializeBlankBaseline = false,
): Promise<DatePack> {
  validate(pack);
  const db = await getDb();
  const tx = db.transaction(['packsV3', 'packs', 'deletedPacks', 'device'], 'readwrite');
  const prior = await tx.objectStore('packsV3').get(pack.plan.id);
  const deleted = await tx.objectStore('deletedPacks').get(pack.plan.id);
  const legacy = await tx.objectStore('packs').get(pack.plan.id);
  if (prior && expectedRevision === undefined) {
    abortReadWrite(tx);
    throw new Error('pack-exists');
  }
  if (prior && prior.pack.revision !== expectedRevision) {
    abortReadWrite(tx);
    throw new Error('revision-conflict');
  }
  if (!prior && expectedRevision !== undefined) {
    abortReadWrite(tx);
    throw new Error('revision-conflict');
  }
  if (!prior && legacy && !deleted) {
    abortReadWrite(tx);
    throw new Error('pack-exists');
  }
  const savedAt = new Date().toISOString();
  const storedPack = prior
    ? {
        ...pack,
        revision: prior.pack.revision + 1,
        manifest: { ...pack.manifest, updatedAt: savedAt },
      }
    : initializeBlankBaseline && hasUnestablishedBlankBaseline(pack)
      ? { ...pack, baselinePlan: structuredClone(pack.plan) }
      : pack;
  validate(storedPack);
  await tx.objectStore('packsV3').put({ pack: storedPack, savedAt }, pack.plan.id);
  if (prior && resetDevice)
    await tx.objectStore('device').put(defaultDevice(pack.plan.id), pack.plan.id);
  if (deleted) await tx.objectStore('deletedPacks').delete(pack.plan.id);
  await tx.done;
  return storedPack;
}

/** Create the blank AI draft and its request as one durable local transaction. */
export async function savePackWithPendingRequest(
  pack: DatePack,
  pendingRequest: PendingRequest,
): Promise<void> {
  if (
    pendingRequest.kind !== 'create' ||
    pendingRequest.planId !== pack.plan.id ||
    pendingRequest.baseRevision !== pack.revision ||
    pendingRequest.contextRevision !== 0 ||
    pendingRequest.status !== 'ready'
  )
    throw new Error('request-plan-mismatch');
  validate(pack);
  const db = await getDb();
  const tx = db.transaction(['packsV3', 'runtime', 'device', 'meta'], 'readwrite');
  if (await tx.objectStore('packsV3').get(pack.plan.id)) {
    abortReadWrite(tx);
    throw new Error('pack-already-exists');
  }
  await tx.objectStore('packsV3').put({ pack, savedAt: new Date().toISOString() }, pack.plan.id);
  await tx
    .objectStore('runtime')
    .put({ planId: pack.plan.id, updatedAt: new Date().toISOString(), events: {} }, pack.plan.id);
  await tx
    .objectStore('device')
    .put(
      { ...defaultDevice(pack.plan.id), pendingRequest: structuredClone(pendingRequest) },
      pack.plan.id,
    );
  await tx.objectStore('meta').put(pack.plan.id, CURRENT_PACK_KEY);
  await tx.done;
}

export async function listPacks(): Promise<Array<{ pack: DatePack; savedAt: string }>> {
  const db = await getDb();
  for (const key of await db.getAllKeys('packs')) {
    if (typeof key !== 'string' || (await db.get('packsV3', key))) continue;
    if (await db.get('deletedPacks', key)) continue;
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
  if (await db.get('deletedPacks', packId)) return undefined;
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
  aiGuard?: AiCommitGuard,
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
    ...(row.pack.plan.events.length === 0 && nextPlan.events.length > 0
      ? { baselinePlan: structuredClone(nextPlan) }
      : {}),
    ...(nextAssets ? { assets: nextAssets } : {}),
    revision: row.pack.revision + 1,
    manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
  };
  validate(pack);
  const existing = (await tx.objectStore('device').get(planId)) ?? defaultDevice(planId);
  if (aiGuard) {
    if (row.pack.revision !== aiGuard.baseRevision) {
      abortReadWrite(tx);
      throw new Error('revision-conflict');
    }
    if (
      (existing.contextRevision ?? existing.liveContext?.revision ?? 0) !== aiGuard.contextRevision
    ) {
      abortReadWrite(tx);
      throw new Error('context-revision-conflict');
    }
    if (
      existing.pendingRequest?.id !== aiGuard.requestId ||
      existing.pendingRequest.kind !== aiGuard.kind ||
      existing.pendingRequest.baseRevision !== aiGuard.baseRevision ||
      existing.pendingRequest.contextRevision !== aiGuard.contextRevision ||
      existing.pendingRequest.generatedAt !== aiGuard.generatedAt ||
      existing.pendingRequest.responseFingerprint !== aiGuard.responseFingerprint ||
      existing.pendingRequest.answerText !== aiGuard.answerText ||
      existing.pendingRequest.status !== 'review'
    ) {
      abortReadWrite(tx);
      throw new Error('request-conflict');
    }
    if (
      aiGuard.requestUpdate.id !== aiGuard.requestId ||
      aiGuard.requestUpdate.planId !== planId ||
      aiGuard.requestUpdate.kind !== aiGuard.kind ||
      aiGuard.requestUpdate.baseRevision !== aiGuard.baseRevision ||
      aiGuard.requestUpdate.contextRevision !== aiGuard.contextRevision ||
      aiGuard.requestUpdate.generatedAt !== aiGuard.generatedAt ||
      aiGuard.requestUpdate.responseFingerprint !== aiGuard.responseFingerprint ||
      aiGuard.requestUpdate.answerText !== aiGuard.answerText ||
      aiGuard.requestUpdate.status !== 'applied'
    ) {
      abortReadWrite(tx);
      throw new Error('request-conflict');
    }
  }
  const device: DeviceState = {
    ...existing,
    ...(aiGuard ? { pendingRequest: structuredClone(aiGuard.requestUpdate) } : {}),
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

/** Store experience facts without changing the current plan or its undo history. */
export async function commitExperienceChange(
  planId: string,
  expectedRevision: number,
  experiences: DatePack['experiences'],
  assets?: DatePackAsset[],
  assetWrites: Array<{ asset: DatePackAsset; blob: Blob }> = [],
  aiGuard?: AiCommitGuard,
): Promise<DatePack> {
  const db = await getDb();
  const tx = db.transaction(['packsV3', 'assets', 'device'], 'readwrite');
  const row = await tx.objectStore('packsV3').get(planId);
  if (!row) {
    abortReadWrite(tx);
    throw new Error('pack-missing');
  }
  if (row.pack.revision !== expectedRevision) {
    abortReadWrite(tx);
    throw new Error('revision-conflict');
  }
  const deviceStore = tx.objectStore('device');
  const existing = (await deviceStore.get(planId)) ?? defaultDevice(planId);
  if (aiGuard) {
    if (row.pack.revision !== aiGuard.baseRevision) {
      abortReadWrite(tx);
      throw new Error('revision-conflict');
    }
    if (
      (existing.contextRevision ?? existing.liveContext?.revision ?? 0) !== aiGuard.contextRevision
    ) {
      abortReadWrite(tx);
      throw new Error('context-revision-conflict');
    }
    if (
      existing.pendingRequest?.id !== aiGuard.requestId ||
      existing.pendingRequest.kind !== aiGuard.kind ||
      existing.pendingRequest.baseRevision !== aiGuard.baseRevision ||
      existing.pendingRequest.contextRevision !== aiGuard.contextRevision ||
      existing.pendingRequest.generatedAt !== aiGuard.generatedAt ||
      existing.pendingRequest.responseFingerprint !== aiGuard.responseFingerprint ||
      existing.pendingRequest.answerText !== aiGuard.answerText ||
      existing.pendingRequest.status !== 'review'
    ) {
      abortReadWrite(tx);
      throw new Error('request-conflict');
    }
    if (
      aiGuard.requestUpdate.id !== aiGuard.requestId ||
      aiGuard.requestUpdate.planId !== planId ||
      aiGuard.requestUpdate.kind !== aiGuard.kind ||
      aiGuard.requestUpdate.baseRevision !== aiGuard.baseRevision ||
      aiGuard.requestUpdate.contextRevision !== aiGuard.contextRevision ||
      aiGuard.requestUpdate.generatedAt !== aiGuard.generatedAt ||
      aiGuard.requestUpdate.responseFingerprint !== aiGuard.responseFingerprint ||
      aiGuard.requestUpdate.answerText !== aiGuard.answerText ||
      aiGuard.requestUpdate.status !== 'applied'
    ) {
      abortReadWrite(tx);
      throw new Error('request-conflict');
    }
  }
  const pack: DatePack = {
    ...row.pack,
    experiences: structuredClone(experiences),
    ...(assets ? { assets: structuredClone(assets) } : {}),
    revision: row.pack.revision + 1,
    manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
  };
  validate(pack);
  await tx.objectStore('packsV3').put({ ...row, pack }, planId);
  if (aiGuard)
    await deviceStore.put({ ...existing, pendingRequest: aiGuard.requestUpdate }, planId);
  const assetStore = tx.objectStore('assets');
  for (const { asset, blob } of assetWrites) {
    await assetStore.put({
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

/** Explicitly refresh the portable baseline from the current plan. */
export async function commitBaselinePlan(
  planId: string,
  expectedRevision: number,
): Promise<DatePack> {
  const db = await getDb();
  const tx = db.transaction('packsV3', 'readwrite');
  const row = await tx.store.get(planId);
  if (!row) {
    abortReadWrite(tx);
    throw new Error('pack-missing');
  }
  if (row.pack.revision !== expectedRevision) {
    abortReadWrite(tx);
    throw new Error('revision-conflict');
  }
  const pack: DatePack = {
    ...row.pack,
    baselinePlan: structuredClone(row.pack.plan),
    revision: row.pack.revision + 1,
    manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
  };
  validate(pack);
  await tx.store.put({ ...row, pack }, planId);
  await tx.done;
  return pack;
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
  await tx.store.put(
    {
      ...value,
      contextRevision:
        value.contextRevision ??
        Math.max(current.contextRevision ?? 0, value.liveContext?.revision ?? 0),
      undoStack: current.undoStack,
    },
    value.planId,
  );
  await tx.done;
}

export async function saveDeviceFields(
  planId: string,
  fields: Pick<Partial<DeviceState>, 'liveContext' | 'personalJourney' | 'pendingRequest'>,
  expectedContextRevision?: number,
  expectedPendingRequest?: PendingRequestGuard | null,
): Promise<DeviceState> {
  const db = await getDb();
  const tx = db.transaction('device', 'readwrite');
  const current = (await tx.store.get(planId)) ?? defaultDevice(planId);
  if (
    expectedContextRevision !== undefined &&
    (current.liveContext?.revision ?? 0) !== expectedContextRevision
  ) {
    abortReadWrite(tx);
    throw new Error('context-revision-conflict');
  }
  if (expectedPendingRequest !== undefined) {
    const actual = current.pendingRequest;
    if (
      expectedPendingRequest === null
        ? actual !== undefined
        : !actual ||
          actual.id !== expectedPendingRequest.id ||
          actual.updatedAt !== expectedPendingRequest.updatedAt ||
          actual.kind !== expectedPendingRequest.kind ||
          actual.status !== expectedPendingRequest.status ||
          actual.baseRevision !== expectedPendingRequest.baseRevision ||
          actual.contextRevision !== expectedPendingRequest.contextRevision ||
          actual.generatedAt !== expectedPendingRequest.generatedAt ||
          actual.answerText !== expectedPendingRequest.answerText ||
          actual.responseFingerprint !== expectedPendingRequest.responseFingerprint
    ) {
      abortReadWrite(tx);
      throw new Error('request-conflict');
    }
  }
  const contextRevision =
    (current.contextRevision ?? current.liveContext?.revision ?? 0) + (fields.liveContext ? 1 : 0);
  const next = { ...current, ...fields, contextRevision, planId, undoStack: current.undoStack };
  await tx.store.put(next, planId);
  await tx.done;
  return next;
}

export async function loadDeviceState(planId: string): Promise<DeviceState> {
  const db = await getDb();
  const tx = db.transaction('device', 'readwrite');
  const device = (await tx.store.get(planId)) ?? defaultDevice(planId);
  const rawRequest = device.pendingRequest as
    | (PendingRequest & { kind?: PendingRequest['kind']; generatedAt?: string })
    | undefined;
  const legacyRequest = rawRequest && (!rawRequest.kind || !rawRequest.generatedAt);
  const normalized = legacyRequest
    ? {
        ...rawRequest,
        kind: rawRequest.kind ?? 'remaining-change',
        generatedAt:
          rawRequest.generatedAt ??
          rawRequest.createdAt ??
          rawRequest.updatedAt ??
          new Date().toISOString(),
        status: 'stale' as const,
        error: 'This request predates AI v2 and needs a fresh request.',
      }
    : rawRequest;
  const result: DeviceState = {
    ...device,
    contextRevision: device.contextRevision ?? device.liveContext?.revision ?? 0,
    ...(normalized ? { pendingRequest: normalized } : {}),
  };
  if (legacyRequest) await tx.store.put(result, planId);
  await tx.done;
  return result;
}

// ---------------------------------------------------------------------------
// Legacy storage and binary assets
// ---------------------------------------------------------------------------

export async function deletePack(packId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ['packsV3', 'assets', 'runtime', 'device', 'meta', 'deletedPacks'],
    'readwrite',
  );
  await tx.objectStore('packsV3').delete(packId);
  const assets = tx.objectStore('assets');
  for (const key of await assets.index('byPack').getAllKeys(packId)) await assets.delete(key);
  await tx.objectStore('runtime').delete(packId);
  await tx.objectStore('device').delete(packId);
  await tx
    .objectStore('deletedPacks')
    .put({ planId: packId, deletedAt: new Date().toISOString() }, packId);
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
  expectedRevision?: number,
): Promise<DatePack> {
  validate(pack);
  const db = await getDb();
  const tx = db.transaction(
    ['packsV3', 'sourceBackups', 'assets', 'device', 'packs', 'deletedPacks'],
    'readwrite',
  );
  const savedAt = new Date().toISOString();
  const prior = await tx.objectStore('packsV3').get(pack.plan.id);
  const deleted = await tx.objectStore('deletedPacks').get(pack.plan.id);
  const legacy = await tx.objectStore('packs').get(pack.plan.id);
  if (prior && expectedRevision === undefined) {
    abortReadWrite(tx);
    throw new Error('pack-exists');
  }
  if (
    (prior && prior.pack.revision !== expectedRevision) ||
    (!prior && expectedRevision !== undefined)
  ) {
    abortReadWrite(tx);
    throw new Error('revision-conflict');
  }
  if (!prior && legacy && !deleted) {
    abortReadWrite(tx);
    throw new Error('pack-exists');
  }
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
    .put(
      { planId: pack.plan.id, source, savedAt },
      `${pack.plan.id}:import:${crypto.randomUUID()}`,
    );
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
  if (deleted) await tx.objectStore('deletedPacks').delete(pack.plan.id);
  await tx.done;
  return storedPack;
}
export async function saveRuntime(state: DatePackRuntimeState): Promise<void> {
  const db = await getDb();
  await db.put('runtime', state, state.planId);
}
export async function saveRuntimeAndAdvanceContext(runtime: DatePackRuntimeState): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(['runtime', 'device'], 'readwrite');
  const store = tx.objectStore('device');
  const current = (await store.get(runtime.planId)) ?? defaultDevice(runtime.planId);
  const contextRevision = (current.contextRevision ?? current.liveContext?.revision ?? 0) + 1;
  await tx.objectStore('runtime').put(runtime, runtime.planId);
  await store.put({ ...current, contextRevision }, runtime.planId);
  await tx.done;
  return contextRevision;
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
