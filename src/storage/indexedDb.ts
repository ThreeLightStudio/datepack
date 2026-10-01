import { openDB, type DBSchema, type IDBPTransaction, type IDBPDatabase } from 'idb';
import { toCoarseContext, type CoarseLocationAttempt } from '../features/day/location';
import {
  migrateLegacyDatePack,
  migrateLocalV3DatePack,
  createMemoriesPack,
  createId,
  datePackContentKey,
  type OutingDatePack,
  type LocalV3DatePack,
  type Experience,
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
  gpsConsent?: boolean;
  locationAttempt?: CoarseLocationAttempt;
};
export type PersonalJourney = {
  planId: string;
  updatedAt: string;
  origin?: string;
  mode?: string;
  note?: string;
};
function safeLiveContext(context: LiveContext): LiveContext {
  return {
    planId: context.planId,
    revision: context.revision,
    updatedAt: context.updatedAt,
    place: context.place,
    activity: context.activity,
    nextPlaceId: context.nextPlaceId,
    nextPlace: context.nextPlace,
    confirmedAt: context.confirmedAt,
    gpsConsent: context.gpsConsent,
    ...(context.locationAttempt
      ? { locationAttempt: toCoarseContext(context.locationAttempt) }
      : {}),
  };
}
export type PendingRequest = {
  id: string;
  /** Document ID (historical property name retained for device request compatibility). */
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
  /** Memory-only check inside the transaction, after revision/context/request guards. */
  validateImpact?: (before: DatePlan) => boolean;
};
export type DirectPlanGuard = {
  contextRevision: number;
  validateImpact: (before: DatePlan) => boolean;
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

/** Device-only form drafts. Never included in a portable DatePack. */
export async function loadAiFormDraft(key: string): Promise<unknown> {
  return (await getDb()).get('meta', `ai-form:${key}`);
}

export async function saveAiFormDraft(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('meta', structuredClone(value), `ai-form:${key}`);
}

export async function savePendingRequest(
  request: PendingRequest | undefined,
  expected: PendingRequestGuard | null,
): Promise<void> {
  if (!request) throw new Error('request-required');
  const db = await getDb();
  const tx = db.transaction(['packsV4', 'device'], 'readwrite');
  const row = await tx.objectStore('packsV4').get(request.planId);
  if (!row) {
    abortReadWrite(tx);
    throw new Error('pack-missing');
  }
  if (row.pack.kind === 'memories' && request.kind !== 'memory-edit') {
    abortReadWrite(tx);
    throw new Error('outing-required');
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
  if (
    actual?.id === request.id &&
    ['applied', 'cancelled'].includes(actual.status) &&
    request.status !== actual.status
  ) {
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
  packsV3: { key: string; value: { pack: LocalV3DatePack; savedAt: string } };
  packsV4: { key: string; value: { pack: DatePack; savedAt: string; importedFromId?: string } };
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
const DB_VERSION = 5;
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
        if (!db.objectStoreNames.contains('packsV4')) db.createObjectStore('packsV4');
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
  try {
    tx.abort();
  } catch {
    /* The transaction may already have aborted. */
  }
}
function validate(pack: DatePack): void {
  const result = validateDatePack(pack);
  if (!result.ok)
    throw new Error(`Invalid DatePack: ${result.errors.map((e) => e.key).join(', ')}`);
}
function hasUnestablishedBlankBaseline(pack: DatePack): pack is OutingDatePack {
  if (pack.kind !== 'outing') return false;
  if (pack.originalPlan.events.length !== 0) return false;
  return JSON.stringify({ ...pack.plan, events: [] }) === JSON.stringify(pack.originalPlan);
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
  await loadPack(pack.id);
  const db = await getDb();
  const tx = db.transaction(['packsV4', 'packs', 'deletedPacks', 'device'], 'readwrite');
  try {
    const prior = await tx.objectStore('packsV4').get(pack.id);
    const deleted = await tx.objectStore('deletedPacks').get(pack.id);
    const legacy = await tx.objectStore('packs').get(pack.id);
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
          meta: { ...pack.meta, updatedAt: savedAt },
          manifest: { ...pack.manifest, updatedAt: savedAt },
        }
      : initializeBlankBaseline && hasUnestablishedBlankBaseline(pack)
        ? { ...pack, originalPlan: structuredClone(pack.plan) }
        : pack;
    validate(storedPack);
    await tx.objectStore('packsV4').put({ ...prior, pack: storedPack, savedAt }, pack.id);
    if (prior && resetDevice) await tx.objectStore('device').put(defaultDevice(pack.id), pack.id);
    if (deleted) await tx.objectStore('deletedPacks').delete(pack.id);
    await tx.done;
    return storedPack;
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}

/** Create the blank AI draft and its request as one durable local transaction. */
export async function savePackWithPendingRequest(
  pack: OutingDatePack,
  pendingRequest: PendingRequest,
): Promise<void> {
  if (
    pendingRequest.kind !== 'create' ||
    pendingRequest.planId !== pack.id ||
    pendingRequest.baseRevision !== pack.revision ||
    pendingRequest.contextRevision !== 0 ||
    pendingRequest.status !== 'ready'
  )
    throw new Error('request-plan-mismatch');
  validate(pack);
  await loadPack(pack.id);
  const db = await getDb();
  const tx = db.transaction(['packsV4', 'runtime', 'device', 'meta'], 'readwrite');
  try {
    if (await tx.objectStore('packsV4').get(pack.id)) {
      abortReadWrite(tx);
      throw new Error('pack-already-exists');
    }
    await tx.objectStore('packsV4').put({ pack, savedAt: new Date().toISOString() }, pack.id);
    await tx
      .objectStore('runtime')
      .put({ planId: pack.id, updatedAt: new Date().toISOString(), events: {} }, pack.id);
    await tx
      .objectStore('device')
      .put({ ...defaultDevice(pack.id), pendingRequest: structuredClone(pendingRequest) }, pack.id);
    await tx.objectStore('meta').put(pack.id, CURRENT_PACK_KEY);
    await tx.done;
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}

export async function listPacks(): Promise<Array<{ pack: DatePack; savedAt: string }>> {
  const db = await getDb();
  const keys = new Set([...(await db.getAllKeys('packsV3')), ...(await db.getAllKeys('packs'))]);
  for (const key of keys) {
    if (
      typeof key !== 'string' ||
      (await db.get('packsV4', key)) ||
      (await db.get('deletedPacks', key))
    )
      continue;
    // A failure must remain visible and retryable, never look like an empty library.
    await loadPack(key);
  }
  return (await db.getAll('packsV4')).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Lazily convert existing local data. Previous rows and all device drafts remain intact. */
export async function loadPack(packId: string): Promise<DatePack | undefined> {
  const db = await getDb();
  if (await db.get('deletedPacks', packId)) return undefined;
  const current = await db.get('packsV4', packId);
  if (current) return current.pack;
  const v3 = await db.get('packsV3', packId);
  const stored = v3 ?? (await db.get('packs', packId));
  const old =
    unwrapLegacy(stored) ??
    (stored && typeof stored === 'object'
      ? { pack: stored, savedAt: new Date().toISOString() }
      : null);
  if (!old || !old.pack || typeof old.pack !== 'object') return undefined;
  const raw = old.pack as Partial<LegacyDatePack>;
  if (!raw.plan || !raw.manifest) throw new Error('migration-invalid-source');
  const pack =
    raw.manifest.version === '3.0'
      ? migrateLocalV3DatePack(raw as LocalV3DatePack)
      : migrateLegacyDatePack(raw as LegacyDatePack, await db.get('runtime', packId)).pack;
  // Retain the local key so runtime, AI requests, blobs and form drafts keep their ownership.
  pack.id = packId;
  validate(pack);
  const tx = db.transaction(
    ['packsV4', 'packsV3', 'packs', 'deletedPacks', 'sourceBackups', 'meta'],
    'readwrite',
  );
  try {
    if (await tx.objectStore('deletedPacks').get(packId)) {
      await tx.done;
      return undefined;
    }
    const raced = await tx.objectStore('packsV4').get(packId);
    if (!raced) {
      const latest = v3
        ? await tx.objectStore('packsV3').get(packId)
        : await tx.objectStore('packs').get(packId);
      if (JSON.stringify(latest) !== JSON.stringify(stored))
        throw new Error('migration-source-conflict');
      await tx.objectStore('packsV4').put({ pack, savedAt: old.savedAt }, packId);
      await tx
        .objectStore('sourceBackups')
        .put({ planId: packId, source: stored, savedAt: new Date().toISOString() }, `v4:${packId}`);
      await tx
        .objectStore('meta')
        .put(
          { completedAt: new Date().toISOString(), sourceVersion: raw.manifest.version },
          `migration:v4:${packId}`,
        );
    }
    await tx.done;
    return raced?.pack ?? pack;
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}

export async function commitPlanChange(
  outing: OutingDatePack,
  expectedRevision: number,
  label: string,
  nextPlan: DatePlan,
  nextAssets?: DatePackAsset[],
  assetWrites: Array<{ asset: DatePackAsset; blob: Blob }> = [],
  aiGuard?: AiCommitGuard,
  directGuard?: DirectPlanGuard,
): Promise<OutingDatePack> {
  if (aiGuard?.kind === 'memory-edit') throw new Error('request-kind-mismatch');
  if (outing.kind !== 'outing') throw new Error('outing-required');
  const planId = outing.id;
  const db = await getDb();
  const tx = db.transaction(['packsV4', 'device', 'assets'], 'readwrite');
  try {
    const row = await tx.objectStore('packsV4').get(planId);
    if (!row) {
      abortReadWrite(tx);
      throw new Error('pack-missing');
    }
    if (row.pack.kind !== 'outing') {
      abortReadWrite(tx);
      throw new Error('outing-required');
    }
    if (row.pack.revision !== expectedRevision) {
      abortReadWrite(tx);
      throw new Error('revision-conflict');
    }
    if (nextPlan.id !== row.pack.plan.id) {
      abortReadWrite(tx);
      throw new Error('plan-id-change-rejected');
    }
    const pack: OutingDatePack = {
      ...row.pack,
      plan: nextPlan,
      ...(hasUnestablishedBlankBaseline(row.pack) && nextPlan.events.length > 0
        ? { originalPlan: structuredClone(nextPlan) }
        : {}),
      ...(nextAssets ? { assets: nextAssets } : {}),
      revision: row.pack.revision + 1,
      meta: { ...row.pack.meta, updatedAt: new Date().toISOString() },
      manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
    };
    const requiredAssets = referencedAssetIds(pack);
    for (const asset of row.pack.assets)
      if (requiredAssets.has(asset.id) && !pack.assets.some((item) => item.id === asset.id))
        pack.assets.push(asset);
    validate(pack);
    if (assetWrites.some(({ asset }) => !pack.assets.some((item) => item.id === asset.id))) {
      abortReadWrite(tx);
      throw new Error('asset-not-registered');
    }
    const existing = (await tx.objectStore('device').get(planId)) ?? defaultDevice(planId);
    if (directGuard) {
      if (
        (existing.contextRevision ?? existing.liveContext?.revision ?? 0) !==
        directGuard.contextRevision
      ) {
        abortReadWrite(tx);
        throw new Error('context-revision-conflict');
      }
      if (!directGuard.validateImpact(row.pack.plan)) {
        abortReadWrite(tx);
        throw new Error('route-impact-conflict');
      }
    }
    if (aiGuard) {
      if (row.pack.revision !== aiGuard.baseRevision) {
        abortReadWrite(tx);
        throw new Error('revision-conflict');
      }
      if (
        (existing.contextRevision ?? existing.liveContext?.revision ?? 0) !==
        aiGuard.contextRevision
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
    if (aiGuard?.validateImpact && !aiGuard.validateImpact(row.pack.plan)) {
      abortReadWrite(tx);
      throw new Error('route-impact-conflict');
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
    await tx.objectStore('packsV4').put({ ...row, pack, savedAt: pack.meta.updatedAt }, planId);
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
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}

export async function commitUndo(
  planId: string,
  expectedRevision: number,
): Promise<{ pack: OutingDatePack; label: string }> {
  const db = await getDb();
  const tx = db.transaction(['packsV4', 'device'], 'readwrite');
  try {
    const row = await tx.objectStore('packsV4').get(planId);
    const existing = await tx.objectStore('device').get(planId);
    if (!row || !existing?.undoStack.length) {
      abortReadWrite(tx);
      throw new Error('undo-unavailable');
    }
    if (row.pack.kind !== 'outing') {
      abortReadWrite(tx);
      throw new Error('outing-required');
    }
    if (row.pack.revision !== expectedRevision) {
      abortReadWrite(tx);
      throw new Error('revision-conflict');
    }
    const undoStack = [...existing.undoStack];
    const entry = undoStack.pop()!;
    const pack: OutingDatePack = {
      ...row.pack,
      plan: entry.plan,
      assets: entry.assets,
      revision: row.pack.revision + 1,
      meta: { ...row.pack.meta, updatedAt: new Date().toISOString() },
      manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
    };
    const used = referencedAssetIds(pack);
    for (const asset of row.pack.assets)
      if (used.has(asset.id) && !pack.assets.some((item) => item.id === asset.id))
        pack.assets.push(asset);
    validate(pack);
    await tx.objectStore('packsV4').put({ ...row, pack, savedAt: pack.meta.updatedAt }, planId);
    await tx.objectStore('device').put({ ...existing, undoStack }, planId);
    await tx.done;
    return { pack, label: entry.label };
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
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
  const tx = db.transaction(['packsV4', 'assets', 'device'], 'readwrite');
  try {
    const row = await tx.objectStore('packsV4').get(planId);
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
        (existing.contextRevision ?? existing.liveContext?.revision ?? 0) !==
        aiGuard.contextRevision
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
    if (aiGuard) {
      if (aiGuard.kind !== 'memory-edit') {
        abortReadWrite(tx);
        throw new Error('request-kind-mismatch');
      }
      const payload = existing.pendingRequest?.payload as
        | { experienceId?: unknown; originalText?: unknown }
        | undefined;
      const original = row.pack.experiences.find((item) => item.id === payload?.experienceId);
      const proposed = experiences.find((item) => item.id === payload?.experienceId);
      const facts = (item: Experience) => {
        const { editedNote: _edited, ...rest } = item;
        return rest;
      };
      if (
        !original ||
        !proposed ||
        typeof proposed.editedNote !== 'string' ||
        !proposed.editedNote.trim() ||
        original.note !== payload?.originalText ||
        experiences.length !== row.pack.experiences.length ||
        experiences.some((item) => {
          const previous = row.pack.experiences.find((record) => record.id === item.id);
          return (
            !previous ||
            JSON.stringify(facts(previous)) !== JSON.stringify(facts(item)) ||
            (item.id !== original.id && previous.editedNote !== item.editedNote)
          );
        }) ||
        (assets && JSON.stringify(assets) !== JSON.stringify(row.pack.assets)) ||
        assetWrites.length
      ) {
        abortReadWrite(tx);
        throw new Error('memory-original-conflict');
      }
    }
    const pack: DatePack = {
      ...row.pack,
      experiences: structuredClone(experiences),
      ...(assets ? { assets: structuredClone(assets) } : {}),
      revision: row.pack.revision + 1,
      meta: { ...row.pack.meta, updatedAt: new Date().toISOString() },
      manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
    };
    validate(pack);
    if (assetWrites.some(({ asset }) => !pack.assets.some((item) => item.id === asset.id))) {
      abortReadWrite(tx);
      throw new Error('asset-not-registered');
    }
    await tx.objectStore('packsV4').put({ ...row, pack, savedAt: pack.meta.updatedAt }, planId);
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
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}

/** Explicitly refresh the portable baseline from the current plan. */
export async function commitBaselinePlan(
  outing: OutingDatePack,
  expectedRevision: number,
): Promise<OutingDatePack> {
  if (outing.kind !== 'outing') throw new Error('outing-required');
  const planId = outing.id;
  const db = await getDb();
  const tx = db.transaction('packsV4', 'readwrite');
  try {
    const row = await tx.store.get(planId);
    if (!row) {
      abortReadWrite(tx);
      throw new Error('pack-missing');
    }
    if (row.pack.kind !== 'outing') {
      abortReadWrite(tx);
      throw new Error('outing-required');
    }
    if (row.pack.revision !== expectedRevision) {
      abortReadWrite(tx);
      throw new Error('revision-conflict');
    }
    const pack: OutingDatePack = {
      ...row.pack,
      originalPlan: structuredClone(row.pack.plan),
      revision: row.pack.revision + 1,
      meta: { ...row.pack.meta, updatedAt: new Date().toISOString() },
      manifest: { ...row.pack.manifest, updatedAt: new Date().toISOString() },
    };
    validate(pack);
    await tx.store.put({ ...row, pack }, planId);
    await tx.done;
    return pack;
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
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
      ...(value.liveContext ? { liveContext: safeLiveContext(value.liveContext) } : {}),
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
  expectedDeviceContextRevision?: number,
): Promise<DeviceState> {
  const db = await getDb();
  const tx = db.transaction('device', 'readwrite');
  const current = (await tx.store.get(planId)) ?? defaultDevice(planId);
  if (
    expectedDeviceContextRevision !== undefined &&
    (current.contextRevision ?? current.liveContext?.revision ?? 0) !==
      expectedDeviceContextRevision
  ) {
    abortReadWrite(tx);
    throw new Error('context-revision-conflict');
  }
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
  const safeFields = { ...fields };
  if (safeFields.liveContext) safeFields.liveContext = safeLiveContext(safeFields.liveContext);
  const next = { ...current, ...safeFields, contextRevision, planId, undoStack: current.undoStack };
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
    ...(device.liveContext ? { liveContext: safeLiveContext(device.liveContext) } : {}),
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

/** Deleting an outing preserves its connected records and photos as a standalone document. */
export async function deletePack(
  packId: string,
  expectedRevision?: number,
): Promise<DatePack | undefined> {
  await loadPack(packId);
  const db = await getDb();
  const tx = db.transaction(
    ['packsV4', 'assets', 'runtime', 'device', 'meta', 'deletedPacks'],
    'readwrite',
  );
  try {
    const row = await tx.objectStore('packsV4').get(packId);
    if (expectedRevision !== undefined && row?.pack.revision !== expectedRevision)
      throw new Error('revision-conflict');
    const selected = (await tx.objectStore('meta').get(CURRENT_PACK_KEY)) === packId;
    let preserved: DatePack | undefined;
    if (row?.pack.kind === 'outing' && row.pack.experiences.length) {
      const experiences = row.pack.experiences.map((item) => {
        const copy = structuredClone(item);
        delete copy.eventId;
        return copy;
      });
      const ids = new Set(experiences.flatMap((item) => item.assetIds ?? []));
      preserved = createMemoriesPack(
        experiences,
        row.pack.assets.filter((asset) => ids.has(asset.id)),
      );
      validate(preserved);
      await tx
        .objectStore('packsV4')
        .put({ pack: preserved, savedAt: new Date().toISOString() }, preserved.id);
      for (const id of ids) {
        const binary = await tx.objectStore('assets').get(assetKey(packId, id));
        if (binary)
          await tx
            .objectStore('assets')
            .put({ ...binary, key: assetKey(preserved.id, id), packId: preserved.id });
      }
    }
    await deleteDocumentRows(tx, packId);
    await tx.objectStore('meta').delete(`ai-form:replan:${packId}`);
    await tx.objectStore('meta').delete(`ai-form:memory:${packId}`);
    if (selected && preserved) await tx.objectStore('meta').put(preserved.id, CURRENT_PACK_KEY);
    await tx.done;
    return preserved;
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
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

/** Import never overwrites: identical content reuses the row, conflicts get a new document ID. */
export async function saveImportedPack(
  pack: DatePack,
  source: Blob,
  entries: Array<{ asset: DatePackAsset; blob: Blob }>,
): Promise<DatePack> {
  validate(pack);
  await loadPack(pack.id);
  const db = await getDb();
  const prior = await db.get('packsV4', pack.id);
  let duplicateRow: DatePackDB['packsV4']['value'] | undefined;
  const candidates = (await db.getAll('packsV4')).filter(
    (row) => row.pack.id === pack.id || row.importedFromId === pack.id,
  );
  for (const candidate of candidates) {
    if (datePackContentKey({ ...candidate.pack, id: pack.id }) !== datePackContentKey(pack))
      continue;
    let same = true;
    const stored = await listPackAssetBlobs(candidate.pack.id);
    const incoming = new Map(entries.map((entry) => [entry.asset.id, entry.blob]));
    for (const asset of pack.assets) {
      const before = stored.get(asset.id),
        after = incoming.get(asset.id);
      if (!!before !== !!after || (before && after && !(await blobsEqual(before, after)))) {
        same = false;
        break;
      }
    }
    if (same) {
      duplicateRow = candidate;
      break;
    }
  }
  const tx = db.transaction(['packsV4', 'sourceBackups', 'assets', 'deletedPacks'], 'readwrite');
  try {
    const current = await tx.objectStore('packsV4').get(pack.id);
    if (JSON.stringify(current) !== JSON.stringify(prior)) throw new Error('revision-conflict');
    if (duplicateRow) {
      const latestDuplicate = await tx.objectStore('packsV4').get(duplicateRow.pack.id);
      if (JSON.stringify(latestDuplicate) !== JSON.stringify(duplicateRow))
        throw new Error('revision-conflict');
      await tx.done;
      return duplicateRow.pack;
    }
    const storedPack: DatePack = current
      ? { ...structuredClone(pack), id: createId('copy') }
      : structuredClone(pack);
    if (await tx.objectStore('packsV4').get(storedPack.id)) throw new Error('pack-exists');
    const savedAt = new Date().toISOString();
    await tx
      .objectStore('packsV4')
      .put({ pack: storedPack, savedAt, importedFromId: pack.id }, storedPack.id);
    await tx
      .objectStore('sourceBackups')
      .put(
        { planId: storedPack.id, source, savedAt },
        `${storedPack.id}:import:${crypto.randomUUID()}`,
      );
    for (const { asset, blob } of entries) {
      if (!storedPack.assets.some((item) => item.id === asset.id))
        throw new Error('asset-not-registered');
      await tx
        .objectStore('assets')
        .put({
          key: assetKey(storedPack.id, asset.id),
          packId: storedPack.id,
          assetId: asset.id,
          blob,
          filename: asset.filename,
        });
    }
    await tx.objectStore('deletedPacks').delete(storedPack.id);
    await tx.done;
    return storedPack;
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}
async function blobsEqual(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size || a.type !== b.type) return false;
  const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const bytes = new Uint8Array(right);
  return new Uint8Array(left).every((byte, i) => byte === bytes[i]);
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

export type AssetWrite = { asset: DatePackAsset; blob: Blob };

/** Create or edit a record and all new photos in one durable transaction. */
export async function saveExperience(
  experience: Experience,
  options: { packId?: string; expectedRevision?: number; assetWrites?: AssetWrite[] } = {},
): Promise<DatePack> {
  const writes = options.assetWrites ?? [];
  if (options.packId) {
    const before = await loadPack(options.packId);
    if (!before) throw new Error('pack-missing');
    if (options.expectedRevision === undefined) throw new Error('revision-required');
    const experiences = before.experiences.some((item) => item.id === experience.id)
      ? before.experiences.map((item) =>
          item.id === experience.id ? structuredClone(experience) : item,
        )
      : [...before.experiences, structuredClone(experience)];
    const assets = [...before.assets];
    for (const { asset } of writes) {
      if (assets.some((item) => item.id === asset.id)) throw new Error('asset-id-conflict');
      assets.push(asset);
    }
    return commitExperienceChange(before.id, options.expectedRevision, experiences, assets, writes);
  }
  const pack = createMemoriesPack(
    [experience],
    writes.map((item) => item.asset),
  );
  validate(pack);
  for (const id of experience.assetIds ?? [])
    if (!writes.some((item) => item.asset.id === id)) throw new Error('asset-missing');
  const db = await getDb();
  const tx = db.transaction(['packsV4', 'assets', 'meta'], 'readwrite');
  try {
    if (await tx.objectStore('packsV4').get(pack.id)) throw new Error('pack-exists');
    await tx.objectStore('packsV4').put({ pack, savedAt: new Date().toISOString() }, pack.id);
    for (const { asset, blob } of writes)
      await tx
        .objectStore('assets')
        .put({
          key: assetKey(pack.id, asset.id),
          packId: pack.id,
          assetId: asset.id,
          blob,
          filename: asset.filename,
        });
    await tx.objectStore('meta').put(pack.id, CURRENT_PACK_KEY);
    await tx.done;
    return pack;
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}

/** Full library, without loading binary image bodies. Document ownership is the connection. */
export async function listExperiences(): Promise<
  Array<{
    packId: string;
    kind: DatePack['kind'];
    revision: number;
    planTitle?: string;
    experience: Experience;
  }>
> {
  return (await listPacks())
    .flatMap(({ pack }) =>
      pack.experiences.map((experience) => ({
        packId: pack.id,
        kind: pack.kind,
        revision: pack.revision,
        ...(pack.kind === 'outing' ? { planTitle: pack.plan.title } : {}),
        experience,
      })),
    )
    .sort((a, b) => b.experience.recordedAt.localeCompare(a.experience.recordedAt));
}

function referencedAssetIds(pack: DatePack): Set<string> {
  const ids = new Set(pack.experiences.flatMap((item) => item.assetIds ?? []));
  if (pack.kind === 'outing')
    for (const plan of [pack.plan, pack.originalPlan]) {
      if (plan.coverAssetId) ids.add(plan.coverAssetId);
      for (const id of plan.galleryAssetIds ?? []) ids.add(id);
      for (const item of [...plan.events, ...(plan.candidates ?? []), ...(plan.places ?? [])])
        for (const id of item.assetIds ?? []) ids.add(id);
    }
  return ids;
}

export type ExperienceDestination = { packId: string; expectedRevision: number; eventId?: string };

/** Link/change/unlink: both documents and their binary ownership change atomically. */
export async function moveExperience(
  sourceId: string,
  expectedRevision: number,
  experienceId: string,
  destination?: ExperienceDestination,
): Promise<{ source?: DatePack; target: DatePack }> {
  const db = await getDb();
  const tx = db.transaction(
    ['packsV4', 'assets', 'device', 'runtime', 'meta', 'deletedPacks'],
    'readwrite',
  );
  try {
    const wasSelected = (await tx.objectStore('meta').get(CURRENT_PACK_KEY)) === sourceId;
    const sourceRow = await tx.objectStore('packsV4').get(sourceId);
    if (!sourceRow) throw new Error('pack-missing');
    if (sourceRow.pack.revision !== expectedRevision) throw new Error('revision-conflict');
    const original = sourceRow.pack.experiences.find((item) => item.id === experienceId);
    if (!original) throw new Error('experience-missing');
    const experience = structuredClone(original);
    delete experience.eventId;
    const targetRow = destination
      ? await tx.objectStore('packsV4').get(destination.packId)
      : undefined;
    if (destination && !targetRow) throw new Error('pack-missing');
    if (destination && targetRow && targetRow.pack.revision !== destination.expectedRevision)
      throw new Error('revision-conflict');
    if (destination && targetRow?.pack.kind !== 'outing') throw new Error('outing-required');
    if (destination?.eventId) {
      if (!targetRow?.pack.plan?.events.some((item) => item.id === destination.eventId))
        throw new Error('event-missing');
      experience.eventId = destination.eventId;
    }
    const now = new Date().toISOString();
    if (targetRow?.pack.id === sourceId) {
      const target = bumped(
        {
          ...sourceRow.pack,
          experiences: sourceRow.pack.experiences.map((item) =>
            item.id === experienceId ? experience : item,
          ),
        },
        now,
      );
      validate(target);
      await tx.objectStore('packsV4').put({ ...sourceRow, pack: target, savedAt: now }, sourceId);
      await tx.done;
      return { source: target, target };
    }
    const target: DatePack = targetRow
      ? structuredClone(targetRow.pack)
      : createMemoriesPack([experience]);
    if (targetRow) {
      if (target.experiences.some((item) => item.id === experienceId))
        throw new Error('experience-id-conflict');
      target.experiences.push(experience);
      target.revision++;
    }
    target.meta.updatedAt = now;
    target.manifest.updatedAt = now;
    const movedIds = new Set(original.assetIds ?? []);
    const remap = new Map<string, string>();
    for (const id of movedIds) {
      const asset = sourceRow.pack.assets.find((item) => item.id === id);
      if (!asset) throw new Error('asset-missing');
      const binary = await tx.objectStore('assets').get(assetKey(sourceId, id));
      // Imported partial files may have registry-only photos; preserve that state too.
      const targetId = target.assets.some((item) => item.id === id) ? createId('asset') : id;
      remap.set(id, targetId);
      target.assets.push({ ...asset, id: targetId });
      if (binary)
        await tx
          .objectStore('assets')
          .put({
            ...binary,
            key: assetKey(target.id, targetId),
            packId: target.id,
            assetId: targetId,
          });
    }
    experience.assetIds = original.assetIds?.map((id) => remap.get(id) ?? id);
    let source: DatePack | undefined = bumped(
      {
        ...sourceRow.pack,
        experiences: sourceRow.pack.experiences.filter((item) => item.id !== experienceId),
      },
      now,
    );
    if (source.kind === 'memories' && !source.experiences.length) {
      await deleteDocumentRows(tx, sourceId);
      source = undefined;
    } else {
      const used = referencedAssetIds(source);
      // Undo entries may still reference plan assets, so keep those binaries as well.
      const device = await tx.objectStore('device').get(sourceId);
      for (const entry of device?.undoStack ?? [])
        for (const asset of entry.assets) used.add(asset.id);
      source.assets = source.assets.filter(
        (asset) => !movedIds.has(asset.id) || used.has(asset.id),
      );
      for (const id of movedIds)
        if (!used.has(id)) await tx.objectStore('assets').delete(assetKey(sourceId, id));
      validate(source);
      await tx.objectStore('packsV4').put({ ...sourceRow, pack: source, savedAt: now }, sourceId);
    }
    validate(target);
    await tx.objectStore('packsV4').put({ ...targetRow, pack: target, savedAt: now }, target.id);
    if (wasSelected) await tx.objectStore('meta').put(target.id, CURRENT_PACK_KEY);
    await tx.done;
    return { source, target };
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}
function bumped(pack: DatePack, now: string): DatePack {
  return {
    ...pack,
    revision: pack.revision + 1,
    meta: { ...pack.meta, updatedAt: now },
    manifest: { ...pack.manifest, updatedAt: now },
  };
}

type DocumentTransaction = IDBPTransaction<
  DatePackDB,
  Array<'packsV4' | 'assets' | 'runtime' | 'device' | 'meta' | 'deletedPacks'>,
  'readwrite'
>;
async function deleteDocumentRows(tx: DocumentTransaction, packId: string): Promise<void> {
  await tx.objectStore('packsV4').delete(packId);
  const assets = tx.objectStore('assets');
  for (const key of await assets.index('byPack').getAllKeys(packId)) await assets.delete(key);
  await tx.objectStore('runtime').delete(packId);
  await tx.objectStore('device').delete(packId);
  await tx
    .objectStore('deletedPacks')
    .put({ planId: packId, deletedAt: new Date().toISOString() }, packId);
  if ((await tx.objectStore('meta').get(CURRENT_PACK_KEY)) === packId)
    await tx.objectStore('meta').delete(CURRENT_PACK_KEY);
}

/** Record deletion is explicit; deleting the last standalone record deletes its collection. */
export async function deleteExperience(
  packId: string,
  expectedRevision: number,
  experienceId: string,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ['packsV4', 'assets', 'runtime', 'device', 'meta', 'deletedPacks'],
    'readwrite',
  );
  try {
    const row = await tx.objectStore('packsV4').get(packId);
    if (!row) throw new Error('pack-missing');
    if (row.pack.revision !== expectedRevision) throw new Error('revision-conflict');
    if (!row.pack.experiences.some((item) => item.id === experienceId))
      throw new Error('experience-missing');
    const pack = bumped(
      { ...row.pack, experiences: row.pack.experiences.filter((item) => item.id !== experienceId) },
      new Date().toISOString(),
    );
    if (pack.kind === 'memories' && !pack.experiences.length) await deleteDocumentRows(tx, packId);
    else {
      const used = referencedAssetIds(pack);
      const device = await tx.objectStore('device').get(packId);
      for (const entry of device?.undoStack ?? [])
        for (const asset of entry.assets) used.add(asset.id);
      const deleted = row.pack.experiences.find((item) => item.id === experienceId)!;
      const candidates = new Set(deleted.assetIds ?? []);
      pack.assets = pack.assets.filter((asset) => !candidates.has(asset.id) || used.has(asset.id));
      for (const id of candidates)
        if (!used.has(id)) await tx.objectStore('assets').delete(assetKey(packId, id));
      validate(pack);
      await tx
        .objectStore('packsV4')
        .put({ ...row, pack, savedAt: new Date().toISOString() }, packId);
    }
    await tx.done;
  } catch (error) {
    abortReadWrite(tx);
    throw error;
  }
}
