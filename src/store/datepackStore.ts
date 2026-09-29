import { useSyncExternalStore } from 'react';
import type {
  DatePack,
  DatePackAsset,
  DatePackRuntimeState,
  DatePlan,
  PatchChange,
  PatchOutcome,
} from '@datepack/core';
import {
  createAssetsFromFiles,
  createDatePack,
  downloadBlob,
  readDatePack,
  registerAsset,
  validateDatePack,
  writeDatePack,
} from '@datepack/core';
import {
  deletePack,
  getCurrentPackId,
  getAssetBlob,
  listPackAssetBlobs,
  listPacks,
  loadPack,
  loadRuntime,
  putAsset,
  saveImportedPack,
  savePack,
  savePackWithPendingRequest,
  saveRuntime,
  saveRuntimeAndAdvanceContext,
  setCurrentPackId,
  commitPlanChange,
  commitUndo,
  commitExperienceChange,
  commitBaselinePlan,
  loadDeviceState,
  saveDeviceFields,
  savePendingRequest,
  type PendingRequest,
  type AiCommitGuard,
  type LiveContext,
  type PersonalJourney,
} from '../storage/indexedDb';
import { createSeoulSeed } from '../seed/seoul';
import { emptyRuntime, getRuntimeEntry } from '../features/day/dayRuntime';
import { t, getLocale, type I18nIssue } from '../i18n/core';

export type SavedPackSummary = { pack: DatePack; savedAt: string };

export type UndoEntry = { label: string; plan: DatePlan; revision: number };

export type ToastAction = { label: string; onClick: () => void };

export type StoreState = {
  status: 'loading' | 'ready' | 'empty';
  pack: DatePack | null;
  runtime: DatePackRuntimeState | null;
  savedPacks: SavedPackSummary[];
  undoStack: UndoEntry[];
  liveContext: LiveContext | null;
  contextRevision: number;
  personalJourney: PersonalJourney | null;
  pendingRequest: PendingRequest | null;
  toast: { message: string; action?: ToastAction } | null;
  /** Fatal init error (e.g. storage failure) surfaced on the empty screen. */
  error: string | null;
};

let state: StoreState = {
  status: 'loading',
  pack: null,
  runtime: null,
  savedPacks: [],
  undoStack: [],
  liveContext: null,
  contextRevision: 0,
  personalJourney: null,
  pendingRequest: null,
  toast: null,
  error: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<StoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(message: string, action?: ToastAction): void {
  setState({ toast: { message, action } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), action ? 6500 : 3200);
}

export function dismissToast(): void {
  if (toastTimer) clearTimeout(toastTimer);
  setState({ toast: null });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStoreState(): StoreState {
  return state;
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getStoreState, getStoreState);
}

// ---------------------------------------------------------------------------
// Asset blobs: in-memory cache in front of IndexedDB
// ---------------------------------------------------------------------------

const blobCache = new Map<string, Blob>();

function cacheKey(packId: string, assetId: string): string {
  return `${packId}:${assetId}`;
}

export function getCachedBlob(packId: string, assetId: string): Blob | undefined {
  return blobCache.get(cacheKey(packId, assetId));
}

export async function resolveBlob(packId: string, assetId: string): Promise<Blob | undefined> {
  const key = cacheKey(packId, assetId);
  const cached = blobCache.get(key);
  if (cached) return cached;
  const blob = await getAssetBlob(packId, assetId);
  if (blob) blobCache.set(key, blob);
  return blob;
}

// ---------------------------------------------------------------------------
// Persistence — failures surface as a toast instead of vanishing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function isLoadablePack(pack: DatePack | undefined): pack is DatePack {
  return !!pack && validateDatePack(pack).ok;
}

export async function initStore(): Promise<void> {
  try {
    const [currentId, initialPacks] = await Promise.all([getCurrentPackId(), listPacks()]);

    // Never trust bytes read back from storage: a corrupt pack falls through
    // to the next saved one, and only a fully valid pack reaches the UI.
    let pack: DatePack | undefined;
    if (currentId) {
      const candidate = await loadPack(currentId);
      if (isLoadablePack(candidate)) pack = candidate;
      else if (candidate) console.error('[datepack] stored pack failed validation', currentId);
    }
    if (!pack) {
      for (const { pack: candidate } of initialPacks) {
        if (isLoadablePack(candidate)) {
          pack = candidate;
          break;
        }
      }
    }

    if (!pack) {
      // First run (or wiped storage): start empty so planning with the AI is
      // the primary path. The demo pack is opt-in via loadDemoPack().
      setState({
        status: 'empty',
        pack: null,
        runtime: null,
        savedPacks: [],
        undoStack: [],
        liveContext: null,
        contextRevision: 0,
        personalJourney: null,
        pendingRequest: null,
      });
      return;
    }

    const [runtimeValue, device, packs] = await Promise.all([
      loadRuntime(pack.plan.id),
      loadDeviceState(pack.plan.id),
      listPacks(),
    ]);
    const runtime = runtimeValue ?? emptyRuntime(pack.plan.id);
    setState({
      status: 'ready',
      pack,
      runtime,
      savedPacks: packs,
      undoStack: device.undoStack,
      liveContext: device.liveContext ?? null,
      contextRevision: device.contextRevision ?? device.liveContext?.revision ?? 0,
      personalJourney: device.personalJourney ?? null,
      pendingRequest: device.pendingRequest ?? null,
    });
  } catch (error) {
    setState({ status: 'empty', error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export function canUndo(): boolean {
  return state.undoStack.length > 0;
}

export async function undo(): Promise<void> {
  if (!state.pack) return;
  try {
    const { pack, label } = await commitUndo(state.pack.plan.id, state.pack.revision);
    const [runtime, device] = await Promise.all([
      loadRuntime(pack.plan.id),
      loadDeviceState(pack.plan.id),
    ]);
    setState({ pack, runtime: runtime ?? emptyRuntime(pack.plan.id), undoStack: device.undoStack });
    showToast(t('toast.undo', { label }));
  } catch (error) {
    await refreshAfterConflict(error);
  }
}

// ---------------------------------------------------------------------------
// Plan & runtime mutations
// ---------------------------------------------------------------------------

export async function updatePlan(
  label: string,
  mutate: (plan: DatePlan) => DatePlan,
): Promise<boolean> {
  if (!state.pack) return false;
  const plan = mutate(structuredClone(state.pack.plan));
  return commitCurrentPlan(label, plan);
}

async function commitCurrentPlan(
  label: string,
  plan: DatePlan,
  assets?: DatePackAsset[],
  assetWrites: Array<{ asset: DatePackAsset; blob: Blob }> = [],
): Promise<boolean> {
  if (!state.pack) return false;
  const prior = state.pack;
  try {
    const pack = await commitPlanChange(
      prior.plan.id,
      prior.revision,
      label,
      plan,
      assets,
      assetWrites,
    );
    const device = await loadDeviceState(plan.id);
    setState({ pack, undoStack: device.undoStack });
    return true;
  } catch (error) {
    await refreshAfterConflict(error);
    return false;
  }
}

async function refreshAfterConflict(error: unknown): Promise<void> {
  if (
    error instanceof Error &&
    ['revision-conflict', 'context-revision-conflict', 'request-conflict'].includes(
      error.message,
    ) &&
    state.pack
  ) {
    const pack = await loadPack(state.pack.plan.id);
    if (pack) {
      const [runtime, device] = await Promise.all([
        loadRuntime(pack.plan.id),
        loadDeviceState(pack.plan.id),
      ]);
      setState({
        pack,
        runtime: runtime ?? emptyRuntime(pack.plan.id),
        undoStack: device.undoStack,
        liveContext: device.liveContext ?? null,
        contextRevision: device.contextRevision ?? device.liveContext?.revision ?? 0,
        pendingRequest: device.pendingRequest ?? null,
      });
    }
  }
  console.error('[datepack] atomic plan change failed', error);
  showToast(t('toast.persistFailed'));
}

export async function updateLiveContext(context: Omit<LiveContext, 'revision'>): Promise<void> {
  const existing = await loadDeviceState(context.planId);
  const revision = (existing.liveContext?.revision ?? 0) + 1;
  const liveContext = { ...context, revision };
  const device = await saveDeviceFields(
    context.planId,
    { liveContext },
    existing.liveContext?.revision ?? 0,
  );
  if (state.pack?.plan.id === context.planId)
    setState({ liveContext, contextRevision: device.contextRevision ?? 0 });
}

export async function updatePersonalJourney(
  personalJourney: PersonalJourney | undefined,
): Promise<void> {
  if (!state.pack) return;
  await saveDeviceFields(state.pack.plan.id, { personalJourney });
  setState({ personalJourney: personalJourney ?? null });
}

export async function updatePendingRequest(pendingRequest: PendingRequest): Promise<void> {
  if (!state.pack) return;
  if (pendingRequest && pendingRequest.planId !== state.pack.plan.id)
    throw new Error('request-plan-mismatch');
  const expected = state.pendingRequest
    ? {
        id: state.pendingRequest.id,
        kind: state.pendingRequest.kind,
        status: state.pendingRequest.status,
        baseRevision: state.pendingRequest.baseRevision,
        contextRevision: state.pendingRequest.contextRevision,
        generatedAt: state.pendingRequest.generatedAt,
        updatedAt: state.pendingRequest.updatedAt,
        answerText: state.pendingRequest.answerText,
        responseFingerprint: state.pendingRequest.responseFingerprint,
      }
    : null;
  try {
    await savePendingRequest(pendingRequest, expected);
  } catch (error) {
    await refreshAfterConflict(error);
    throw error;
  }
  setState({ pendingRequest });
}

/** Commit an approved AI plan using the same validated transaction as direct edits. */
export async function applyAiPlan(
  identity: Pick<
    PendingRequest,
    'id' | 'planId' | 'baseRevision' | 'contextRevision' | 'generatedAt' | 'kind'
  >,
  plan: DatePlan,
): Promise<boolean> {
  const current = state.pack;
  const request = state.pendingRequest;
  if (
    !current ||
    current.plan.id !== identity.planId ||
    !request ||
    request.id !== identity.id ||
    request.kind !== identity.kind ||
    request.status !== 'review' ||
    !request.answerText ||
    !request.responseFingerprint ||
    request.baseRevision !== identity.baseRevision ||
    request.contextRevision !== identity.contextRevision ||
    request.generatedAt !== identity.generatedAt
  ) {
    showToast(t('ai.request.stale'));
    return false;
  }
  if (
    current.revision !== identity.baseRevision ||
    state.contextRevision !== identity.contextRevision
  ) {
    const stale = { ...request, status: 'stale' as const, updatedAt: new Date().toISOString() };
    try {
      await updatePendingRequest(stale);
    } catch {
      /* Keep the in-memory draft available. */
    }
    showToast(t('ai.request.stale'));
    return false;
  }
  const completed: PendingRequest = {
    ...request,
    status: 'applied',
    updatedAt: new Date().toISOString(),
  };
  const guard: AiCommitGuard = {
    requestId: identity.id,
    kind: identity.kind,
    baseRevision: identity.baseRevision,
    contextRevision: identity.contextRevision,
    generatedAt: identity.generatedAt,
    responseFingerprint: request.responseFingerprint,
    answerText: request.answerText,
    requestUpdate: completed,
  };
  try {
    const saved = await commitPlanChange(
      identity.planId,
      identity.baseRevision,
      t('undo.patch'),
      plan,
      undefined,
      [],
      guard,
    );
    const device = await loadDeviceState(identity.planId);
    setState({
      pack: saved,
      undoStack: device.undoStack,
      pendingRequest: device.pendingRequest ?? null,
    });
    return true;
  } catch (error) {
    await refreshAfterConflict(error);
    if (error instanceof Error && error.message === 'context-revision-conflict')
      showToast(t('ai.request.stale'));
    else if (error instanceof Error && error.message === 'request-conflict')
      showToast(t('ai.request.duplicate'));
    return false;
  }
}

/** Commit experience facts with the pack revision while leaving undo/device state intact. */
export async function updateExperiences(
  experiences: DatePack['experiences'],
  assets?: DatePackAsset[],
  assetWrites: Array<{ asset: DatePackAsset; blob: Blob }> = [],
  expectedRevision?: number,
): Promise<boolean> {
  if (!state.pack) return false;
  if (expectedRevision !== undefined && state.pack.revision !== expectedRevision) {
    await refreshAfterConflict(new Error('revision-conflict'));
    return false;
  }
  try {
    const pack = await commitExperienceChange(
      state.pack.plan.id,
      state.pack.revision,
      experiences,
      assets,
      assetWrites,
    );
    for (const { asset, blob } of assetWrites)
      blobCache.set(cacheKey(pack.plan.id, asset.id), blob);
    setState({ pack });
    return true;
  } catch (error) {
    await refreshAfterConflict(error);
    return false;
  }
}

/** Save reviewed wording as an additional field; the original note is retained verbatim. */
export async function applyAiMemoryNote(
  identity: Pick<
    PendingRequest,
    'id' | 'planId' | 'baseRevision' | 'contextRevision' | 'generatedAt' | 'kind'
  >,
  experienceId: string,
  editedText: string,
): Promise<boolean> {
  const current = state.pack;
  const request = state.pendingRequest;
  const payload = request?.payload as
    | { experienceId?: unknown; originalText?: unknown }
    | undefined;
  if (
    !current ||
    identity.kind !== 'memory-edit' ||
    current.plan.id !== identity.planId ||
    !request ||
    request.id !== identity.id ||
    request.kind !== identity.kind ||
    request.status !== 'review' ||
    !request.answerText ||
    !request.responseFingerprint ||
    request.baseRevision !== identity.baseRevision ||
    request.contextRevision !== identity.contextRevision ||
    request.generatedAt !== identity.generatedAt ||
    payload?.experienceId !== experienceId ||
    !editedText.trim()
  )
    return false;
  const experience = current.experiences.find((item) => item.id === experienceId);
  if (
    !experience ||
    experience.note !== payload.originalText ||
    current.revision !== identity.baseRevision ||
    state.contextRevision !== identity.contextRevision
  ) {
    try {
      await updatePendingRequest({
        ...request,
        status: 'stale',
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* retain local draft */
    }
    showToast(t('ai.request.stale'));
    return false;
  }
  const completed: PendingRequest = {
    ...request,
    status: 'applied',
    updatedAt: new Date().toISOString(),
  };
  const guard: AiCommitGuard = {
    requestId: identity.id,
    kind: identity.kind,
    baseRevision: identity.baseRevision,
    contextRevision: identity.contextRevision,
    generatedAt: identity.generatedAt,
    responseFingerprint: request.responseFingerprint,
    answerText: request.answerText,
    requestUpdate: completed,
  };
  const experiences = current.experiences.map((item) =>
    item.id === experienceId ? { ...item, editedNote: editedText.trim() } : item,
  );
  try {
    const saved = await commitExperienceChange(
      identity.planId,
      identity.baseRevision,
      experiences,
      undefined,
      [],
      guard,
    );
    const device = await loadDeviceState(identity.planId);
    setState({ pack: saved, pendingRequest: device.pendingRequest ?? null });
    return true;
  } catch (error) {
    await refreshAfterConflict(error);
    if (error instanceof Error && error.message === 'context-revision-conflict')
      showToast(t('ai.request.stale'));
    else if (error instanceof Error && error.message === 'request-conflict')
      showToast(t('ai.request.duplicate'));
    return false;
  }
}

/** P3's explicit “refresh baseline” action; first-record capture happens with experience commit. */
export async function updateBaselinePlan(): Promise<void> {
  if (!state.pack) return;
  try {
    const pack = await commitBaselinePlan(state.pack.plan.id, state.pack.revision);
    setState({ pack });
  } catch (error) {
    await refreshAfterConflict(error);
  }
}

export async function updateRuntime(
  label: string,
  mutate: (runtime: DatePackRuntimeState) => void,
): Promise<void> {
  if (!state.pack) return;
  const runtime: DatePackRuntimeState = structuredClone(
    state.runtime ?? emptyRuntime(state.pack.plan.id),
  );
  mutate(runtime);
  runtime.planId = state.pack.plan.id;
  runtime.updatedAt = new Date().toISOString();
  try {
    const contextRevision = await saveRuntimeAndAdvanceContext(runtime);
    setState({ runtime, contextRevision });
  } catch (error) {
    console.error('[datepack] runtime persist failed', error);
    showToast(t('toast.persistFailed'));
  }
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function addEventAssets(
  eventId: string | null,
  files: FileList | File[],
): Promise<void> {
  if (!state.pack) return;
  const created = await createAssetsFromFiles(files);
  if (created.length === 0) return;

  const pack: DatePack = structuredClone(state.pack);
  const registered: Array<{ asset: DatePackAsset; blob: Blob }> = [];
  for (const item of created) {
    registered.push({ asset: registerAsset(pack, item.asset), blob: item.blob });
  }

  const plan = pack.plan;
  if (eventId === null) {
    plan.galleryAssetIds = [...(plan.galleryAssetIds ?? []), ...registered.map((r) => r.asset.id)];
  } else {
    const event = plan.events.find((e) => e.id === eventId);
    if (event) event.assetIds = [...(event.assetIds ?? []), ...registered.map((r) => r.asset.id)];
  }

  // Persist blobs before rendering: AssetImage resolves the blob once on mount
  // (cache, then IndexedDB) and never retries — a miss would freeze the
  // placeholder in place until the next reload.
  if (!(await commitCurrentPlan(t('undo.photo'), plan, pack.assets, registered))) return;
  for (const { asset, blob } of registered) blobCache.set(cacheKey(plan.id, asset.id), blob);
  showToast(t('toast.photos.added'));
}

export async function setCoverFromFiles(files: FileList | File[]): Promise<void> {
  if (!state.pack) return;
  const first = (await createAssetsFromFiles(files))[0];
  if (!first) return;

  const pack: DatePack = structuredClone(state.pack);
  const asset = registerAsset(pack, first.asset);
  pack.plan.coverAssetId = asset.id;
  // Same ordering rule as addEventAssets: blob must be resolvable before the
  // cover image renders, or the placeholder sticks until a reload.
  if (
    !(await commitCurrentPlan(t('undo.cover'), pack.plan, pack.assets, [
      { asset, blob: first.blob },
    ]))
  )
    return;
  blobCache.set(cacheKey(pack.plan.id, asset.id), first.blob);
  showToast(t('toast.cover.changed'));
}

export async function removeAsset(assetId: string): Promise<void> {
  if (!state.pack) return;
  const pack: DatePack = structuredClone(state.pack);
  pack.assets = pack.assets.filter((a) => a.id !== assetId);
  const plan = pack.plan;
  if (plan.coverAssetId === assetId) plan.coverAssetId = undefined;
  plan.galleryAssetIds = plan.galleryAssetIds?.filter((id) => id !== assetId);
  for (const event of plan.events) {
    event.assetIds = event.assetIds?.filter((id) => id !== assetId);
  }
  if (!(await commitCurrentPlan(t('undo.photoRemove'), plan, pack.assets))) return;
  // Keep the binary while an undo entry may still restore its asset registry.
  showToast(t('toast.photo.removed'));
}

// ---------------------------------------------------------------------------
// Day mode runtime actions
// ---------------------------------------------------------------------------

function eventName(eventId: string): string {
  return state.pack?.plan.events.find((e) => e.id === eventId)?.title ?? '';
}

export async function completeEvent(eventId: string): Promise<void> {
  const name = eventName(eventId);
  await updateRuntime(t('undo.complete', { title: name }), (runtime) => {
    runtime.events[eventId] = {
      ...getRuntimeEntry(runtime, eventId),
      eventId,
      status: 'completed',
    };
  });
  showToast(t('toast.completed'));
}

export async function skipEvent(eventId: string): Promise<void> {
  const name = eventName(eventId);
  await updateRuntime(t('undo.skip', { title: name }), (runtime) => {
    runtime.events[eventId] = { ...getRuntimeEntry(runtime, eventId), eventId, status: 'skipped' };
  });
  showToast(t('toast.skipped'));
}

export async function setEventIncludedInRemaining(
  eventId: string,
  includeInRemaining: boolean,
): Promise<void> {
  await updateRuntime('Update remaining plan', (runtime) => {
    const entry = getRuntimeEntry(runtime, eventId);
    runtime.events[eventId] = { ...entry, eventId, includeInRemaining };
  });
}

export async function unmarkEvent(eventId: string): Promise<void> {
  const name = eventName(eventId);
  await updateRuntime(t('undo.reset', { title: name }), (runtime) => {
    delete runtime.events[eventId];
  });
}

export async function delayEvent(eventId: string, minutes = 15): Promise<void> {
  const name = eventName(eventId);
  await updateRuntime(t('undo.delay', { title: name, minutes }), (runtime) => {
    const entry = getRuntimeEntry(runtime, eventId);
    runtime.events[eventId] = {
      ...entry,
      eventId,
      delayedByMinutes: (entry.delayedByMinutes ?? 0) + minutes,
    };
  });
  showToast(t('toast.delayed', { minutes }));
}

export async function switchToPlanB(eventId: string): Promise<void> {
  const name = eventName(eventId);
  await updateRuntime(t('undo.planb', { title: name }), (runtime) => {
    const entry = getRuntimeEntry(runtime, eventId);
    runtime.events[eventId] = { ...entry, eventId, activePlan: 'B' };
  });
  showToast(t('toast.planb.on'));
}

export async function switchToPlanA(eventId: string): Promise<void> {
  const name = eventName(eventId);
  await updateRuntime(t('undo.plana', { title: name }), (runtime) => {
    const entry = getRuntimeEntry(runtime, eventId);
    runtime.events[eventId] = { ...entry, eventId, activePlan: 'A' };
  });
}

// ---------------------------------------------------------------------------
// AI patch
// ---------------------------------------------------------------------------

export type PatchApplyResult = { applied: PatchChange[]; skipped: I18nIssue[] };

export async function applyPatchWithUndo(
  outcome: PatchOutcome,
  basePlan: DatePlan,
): Promise<PatchApplyResult> {
  if (!state.pack) return { applied: [], skipped: [] };
  if (!outcome.canApply || state.pack.plan !== basePlan) {
    return {
      applied: [],
      skipped: [
        { key: state.pack.plan === basePlan ? 'err.patch.nothingApplied' : 'err.patch.stale' },
      ],
    };
  }
  const plan = outcome.plan;
  if (!(await commitCurrentPlan(t('undo.patch'), plan))) {
    return { applied: [], skipped: [{ key: 'err.patch.stale' }] };
  }
  return { applied: outcome.applied, skipped: outcome.skipped };
}

// ---------------------------------------------------------------------------
// Pack lifecycle
// ---------------------------------------------------------------------------

export async function createNewPack(title: string, date: string): Promise<void> {
  const pack = createDatePack({
    title: title.trim() || t('fallback.packTitle'),
    ...(date ? { date } : {}),
  });
  const runtime = emptyRuntime(pack.plan.id);
  await savePack(pack);
  await saveRuntime(runtime);
  await setCurrentPackId(pack.plan.id);
  setState({
    status: 'ready',
    pack,
    runtime,
    savedPacks: await listPacks(),
    undoStack: [],
    liveContext: null,
    contextRevision: 0,
    personalJourney: null,
    pendingRequest: null,
  });
  showToast(t('toast.pack.created'));
}

export async function createAiDraftPack(pack: DatePack, request: PendingRequest): Promise<void> {
  await savePackWithPendingRequest(pack, request);
  const runtime = emptyRuntime(pack.plan.id);
  setState({
    status: 'ready',
    pack,
    runtime,
    savedPacks: await listPacks(),
    undoStack: [],
    liveContext: null,
    contextRevision: 0,
    personalJourney: null,
    pendingRequest: request,
  });
  showToast(t('toast.pack.created'));
}

/** Create a pack from an AI-authored plan (datepack.plan draft already built). */
export async function createPackFromPlan(pack: DatePack): Promise<void> {
  const runtime = emptyRuntime(pack.plan.id);
  const savedPack = await savePack(pack, undefined, false, true);
  await saveRuntime(runtime);
  await setCurrentPackId(savedPack.plan.id);
  setState({
    status: 'ready',
    pack: savedPack,
    runtime,
    savedPacks: await listPacks(),
    undoStack: [],
    liveContext: null,
    contextRevision: 0,
    personalJourney: null,
    pendingRequest: null,
  });
  showToast(t('toast.pack.created'), {
    label: t('create.toast.download'),
    onClick: () => void exportCurrentPack(),
  });
}

/** Opt-in demo pack — the first run no longer seeds it automatically. */
export async function loadDemoPack(): Promise<void> {
  // The demo content is regenerated in the active UI locale (map queries stay Korean).
  const seed = createSeoulSeed(getLocale());
  const prior = await loadPack(seed.pack.plan.id);
  const pack = await savePack(seed.pack, prior?.revision, true, true);
  for (const { asset, blob } of seed.blobs) await putAsset(seed.pack.plan.id, asset, blob);
  for (const { asset, blob } of seed.blobs)
    blobCache.set(cacheKey(seed.pack.plan.id, asset.id), blob);
  const runtime = emptyRuntime(seed.pack.plan.id);
  await saveRuntime(runtime);
  await setCurrentPackId(seed.pack.plan.id);
  setState({
    status: 'ready',
    pack,
    runtime,
    savedPacks: await listPacks(),
    undoStack: [],
    liveContext: null,
    contextRevision: 0,
    personalJourney: null,
    pendingRequest: null,
  });
  showToast(t('toast.pack.imported', { title: seed.pack.plan.title, warn: '' }));
}

export async function importPackFile(file: File): Promise<void> {
  const result = await readDatePack(file);
  const imported = result.pack;
  const prior = await loadPack(imported.plan.id);
  const pack = await saveImportedPack(
    imported,
    file,
    [...result.blobs.entries()].map(([assetId, blob]) => {
      const asset = imported.assets.find((a) => a.id === assetId) ?? {
        id: assetId,
        filename: assetId,
        mimeType: blob.type,
        path: `assets/${assetId}`,
      };
      return { asset, blob };
    }),
    prior?.revision,
  );
  for (const [assetId, blob] of result.blobs) blobCache.set(cacheKey(pack.plan.id, assetId), blob);
  const runtime = (await loadRuntime(pack.plan.id)) ?? emptyRuntime(pack.plan.id);
  await saveRuntime(runtime);
  const device = await loadDeviceState(pack.plan.id);
  await setCurrentPackId(pack.plan.id);
  setState({
    status: 'ready',
    pack,
    runtime,
    savedPacks: await listPacks(),
    undoStack: device.undoStack,
    liveContext: device.liveContext ?? null,
    contextRevision: device.contextRevision ?? device.liveContext?.revision ?? 0,
    personalJourney: device.personalJourney ?? null,
    pendingRequest: device.pendingRequest ?? null,
  });
  const warnNote = result.warnings.length > 0 ? ` (${t(result.warnings[0])})` : '';
  showToast(t('toast.pack.imported', { title: pack.plan.title, warn: warnNote }));
}

export async function exportCurrentPack(): Promise<void> {
  if (!state.pack) return;
  const pack = state.pack;
  // Make sure every asset blob is in the cache (they may only live in IndexedDB
  // after a reload), then build the ZIP once.
  const missing = pack.assets.filter((a) => !blobCache.has(cacheKey(pack.plan.id, a.id)));
  if (missing.length > 0) {
    const stored = await listPackAssetBlobs(pack.plan.id);
    for (const asset of missing) {
      const blob = stored.get(asset.id);
      if (blob) blobCache.set(cacheKey(pack.plan.id, asset.id), blob);
    }
  }
  const result = await writeDatePack(
    pack,
    (assetId) => blobCache.get(cacheKey(pack.plan.id, assetId)) ?? null,
  );
  downloadBlob(result.blob, result.filename);
  showToast(
    result.missingAssetIds.length > 0 ? t('toast.pack.exportedPartial') : t('toast.pack.exported'),
  );
}

export async function switchPack(packId: string): Promise<void> {
  const pack = await loadPack(packId);
  if (!pack) return;
  if (!isLoadablePack(pack)) {
    showToast(t('err.read.invalidContent'));
    return;
  }
  const runtime = (await loadRuntime(packId)) ?? emptyRuntime(packId);
  await setCurrentPackId(packId);
  setState({ pack, runtime, undoStack: [] });
  showToast(t('toast.pack.switched', { title: pack.plan.title }));
}

export async function deletePackById(packId: string): Promise<void> {
  await deletePack(packId);
  for (const key of [...blobCache.keys()]) {
    if (key.startsWith(`${packId}:`)) blobCache.delete(key);
  }
  const saved = await listPacks();
  if (state.pack?.plan.id === packId) {
    const next = saved[0]?.pack;
    if (next) {
      await switchPack(next.plan.id);
    } else {
      setState({ pack: null, runtime: null, status: 'empty', savedPacks: [], undoStack: [] });
    }
    showToast(t('toast.pack.deleted'));
  } else {
    setState({ savedPacks: saved });
    showToast(t('toast.pack.deleted'));
  }
}
