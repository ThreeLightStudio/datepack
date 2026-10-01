import { useSyncExternalStore } from 'react';
import type {
  DatePack,
  OutingDatePack,
  Experience,
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
  saveExperience,
  moveExperience,
  deleteExperience,
  type AssetWrite,
  type ExperienceDestination,
  type PendingRequest,
  type AiCommitGuard,
  type LiveContext,
  type PersonalJourney,
} from '../storage/indexedDb';
import { createSeoulSeed } from '../seed/seoul';
import { emptyRuntime, getRuntimeEntry } from '../features/day/dayRuntime';
import {
  hasRouteImpact,
  protectionReasons,
  localImpactInput,
  snapshotMatches,
  validateImpact,
  prepareImpact,
  type ImpactResult,
  type ValidationSnapshot,
} from '../features/day/routeImpact';
import { reorderPlan, adjustReorderedTimes } from '../features/plan/reorder';
import { parseMemoryReply } from '../features/memories/aiMemory';
import { getAiScopeEventIds } from '../features/ai/promptBuilder';
import { t, getLocale, type I18nIssue } from '../i18n/core';
import { summarizeActivity, type LibraryActivity } from '../features/home/libraryActivity';

export type SavedPackSummary = { pack: OutingDatePack; savedAt: string };

export type UndoEntry = { label: string; plan: DatePlan; revision: number };

export type ToastAction = { label: string; onClick: () => void };

export type StoreState = {
  status: 'loading' | 'ready' | 'empty';
  pack: OutingDatePack | null;
  document: DatePack | null;
  savedDocuments: Array<{ pack: DatePack; savedAt: string }>;
  savedActivities: LibraryActivity[];
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
  document: null,
  savedDocuments: [],
  savedActivities: [],
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
  if ('pack' in patch && !('document' in patch)) patch.document = patch.pack ?? null;
  if (patch.document) {
    const document = patch.document;
    patch.savedDocuments = (patch.savedDocuments ?? state.savedDocuments).map((row) =>
      row.pack.id === document.id ? { pack: document, savedAt: document.meta.updatedAt } : row,
    );
    patch.savedPacks = (patch.savedPacks ?? state.savedPacks).map((row) =>
      row.pack.id === document.id && document.kind === 'outing'
        ? { pack: document, savedAt: document.meta.updatedAt }
        : row,
    );
  }
  state = { ...state, ...patch };
  if (patch.savedDocuments) {
    const ids = new Set(patch.savedDocuments.map(({ pack }) => pack.id));
    state.savedActivities = state.savedActivities.filter((item) => ids.has(item.packId));
  }
  if (
    state.document &&
    ['document', 'pack', 'pendingRequest', 'liveContext', 'runtime'].some((key) => key in patch)
  ) {
    const activity = summarizeActivity(
      state.document,
      {
        pendingRequest: state.pendingRequest ?? undefined,
        liveContext: state.liveContext ?? undefined,
      },
      state.runtime,
    );
    state.savedActivities = [
      ...state.savedActivities.filter((item) => item.packId !== activity.packId),
      activity,
    ];
  }
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

function isLoadablePack(pack: DatePack | undefined): pack is OutingDatePack {
  return !!pack && pack.kind === 'outing' && validateDatePack(pack).ok;
}

export async function initStore(): Promise<void> {
  try {
    const [currentId, savedDocuments] = await Promise.all([getCurrentPackId(), listPacks()]);
    const current = currentId ? await loadPack(currentId) : undefined;
    const document =
      current && validateDatePack(current).ok
        ? current
        : savedDocuments.find((row) => validateDatePack(row.pack).ok)?.pack;
    const savedPacks = savedDocuments.filter(
      (row): row is SavedPackSummary => row.pack.kind === 'outing',
    );
    const savedActivities = await readLibraryActivities(savedDocuments);
    if (!document) {
      setState({
        status: 'empty',
        pack: null,
        document: null,
        runtime: null,
        savedPacks,
        savedDocuments,
        savedActivities,
        undoStack: [],
        liveContext: null,
        contextRevision: 0,
        personalJourney: null,
        pendingRequest: null,
        error: null,
      });
      return;
    }
    const [runtime, device] = await Promise.all([
      loadRuntime(document.id),
      loadDeviceState(document.id),
    ]);
    setState({
      status: 'ready',
      document,
      pack: document.kind === 'outing' ? document : null,
      runtime: document.kind === 'outing' ? (runtime ?? emptyRuntime(document.id)) : null,
      savedPacks,
      savedDocuments,
      savedActivities,
      undoStack: document.kind === 'outing' ? device.undoStack : [],
      liveContext: device.liveContext ?? null,
      contextRevision: device.contextRevision ?? device.liveContext?.revision ?? 0,
      personalJourney: device.personalJourney ?? null,
      pendingRequest: device.pendingRequest ?? null,
      error: null,
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
    const { pack, label } = await commitUndo(state.pack.id, state.pack.revision);
    const [runtime, device] = await Promise.all([loadRuntime(pack.id), loadDeviceState(pack.id)]);
    setState({ pack, runtime: runtime ?? emptyRuntime(pack.id), undoStack: device.undoStack });
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

export type ReorderReview = {
  documentId: string;
  before: DatePlan;
  proposed: DatePlan;
  revision: number;
  contextRevision: number;
  impact: ImpactResult;
};
export async function prepareReorder(
  eventId: string,
  beforeId: string | null,
): Promise<ReorderReview | null> {
  if (!state.pack) return null;
  const documentId = state.pack.id;
  const before = state.pack.plan;
  const proposed = reorderPlan(before, eventId, beforeId);
  if (!proposed) return null;
  const revision = state.pack.revision,
    contextRevision = state.contextRevision;
  const impact = await prepareImpact({
    documentId,
    before,
    proposed,
    planRevision: revision,
    contextRevision,
    phase: 'plan',
  });
  return { documentId, before, proposed, revision, contextRevision, impact };
}
export async function prepareReorderTimeAdjustment(
  review: ReorderReview,
): Promise<ReorderReview | null> {
  const proposed = adjustReorderedTimes(review.proposed);
  if (!proposed) return null;
  const impact = await prepareImpact({
    documentId: review.documentId,
    before: review.before,
    proposed,
    planRevision: review.revision,
    contextRevision: review.contextRevision,
    phase: 'plan',
  });
  return { ...review, proposed, impact };
}
export async function commitReviewedReorder(review: ReorderReview): Promise<boolean> {
  const current = state.pack;
  const check = (before: DatePlan): boolean => {
    const age = Date.now() - Date.parse(review.impact.snapshot.evaluatedAt);
    const input = localImpactInput({
      documentId: current?.id,
      before,
      proposed: review.proposed,
      planRevision: review.revision,
      contextRevision: review.contextRevision,
      phase: 'plan',
    });
    return (
      age >= 0 &&
      age <= 300_000 &&
      snapshotMatches(review.impact.snapshot, input) &&
      validateImpact(input).status === 'verified'
    );
  };
  if (
    !current ||
    current.id !== review.documentId ||
    current.plan.id !== review.before.id ||
    current.revision !== review.revision ||
    state.contextRevision !== review.contextRevision ||
    !check(current.plan)
  ) {
    showToast(t('reorder.stale'));
    return false;
  }
  try {
    const pack = await commitPlanChange(
      current,
      review.revision,
      t('undo.reorder'),
      review.proposed,
      undefined,
      [],
      undefined,
      { contextRevision: review.contextRevision, validateImpact: check },
    );
    const device = await loadDeviceState(pack.id);
    setState({ pack, undoStack: device.undoStack });
    showToast(t('reorder.saved'), { label: t('app.undo'), onClick: () => void undo() });
    return true;
  } catch (error) {
    await refreshAfterConflict(error);
    return false;
  }
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
    const pack = await commitPlanChange(prior, prior.revision, label, plan, assets, assetWrites);
    const device = await loadDeviceState(prior.id);
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
    state.document
  ) {
    const pack = await loadPack(state.document.id);
    if (pack) {
      const [runtime, device] = await Promise.all([loadRuntime(pack.id), loadDeviceState(pack.id)]);
      setState({
        pack: pack.kind === 'outing' ? pack : null,
        document: pack,
        runtime: runtime ?? emptyRuntime(pack.id),
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

export async function updateLiveContext(
  context: Omit<LiveContext, 'revision'>,
  expectedContextRevision?: number,
): Promise<void> {
  const existing = await loadDeviceState(context.planId);
  const revision = (existing.liveContext?.revision ?? 0) + 1;
  const liveContext = { ...context, revision };
  const device = await saveDeviceFields(
    context.planId,
    { liveContext },
    existing.liveContext?.revision ?? 0,
    undefined,
    expectedContextRevision,
  );
  if (state.pack?.id === context.planId)
    setState({ liveContext, contextRevision: device.contextRevision ?? 0 });
}

export async function updatePersonalJourney(
  personalJourney: PersonalJourney | undefined,
): Promise<void> {
  if (!state.pack) return;
  await saveDeviceFields(state.pack.id, { personalJourney });
  setState({ personalJourney: personalJourney ?? null });
}

// Serialize this tab's edits; IndexedDB still arbitrates across tabs. Capture the
// expected snapshot before queueing so a late preview cannot overwrite new input.
let requestWrites: Promise<unknown> = Promise.resolve();
function enqueueRequestWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = requestWrites.then(write, write);
  requestWrites = result.catch(() => undefined);
  return result;
}

async function writePendingRequest(
  pendingRequest: PendingRequest,
  expected: PendingRequest | null,
): Promise<void> {
  const document = state.document ?? state.pack;
  if (!document || pendingRequest.planId !== document.id) throw new Error('request-plan-mismatch');
  try {
    await savePendingRequest(pendingRequest, expected);
  } catch (error) {
    await refreshAfterConflict(error);
    throw error;
  }
  if (state.document?.id === pendingRequest.planId) setState({ pendingRequest });
}

export function updatePendingRequest(
  pendingRequest: PendingRequest,
  expected = state.pendingRequest,
): Promise<void> {
  return enqueueRequestWrite(() => writePendingRequest(pendingRequest, expected));
}

/** Each keystroke/paste is queued immediately, including before preview. */
export function savePendingAnswer(requestId: string, answerText: string): Promise<void> {
  return enqueueRequestWrite(async () => {
    const request = state.pendingRequest;
    if (!request || request.id !== requestId || ['applied', 'cancelled'].includes(request.status))
      throw new Error('request-conflict');
    await writePendingRequest(
      {
        ...request,
        status: request.status === 'stale' ? 'stale' : 'draft',
        answerText,
        responseFingerprint: undefined,
        error: undefined,
        updatedAt: new Date().toISOString(),
      },
      request,
    );
  });
}

/** Sharing may finish after a paste or review. It cannot downgrade that answer. */
export function markPendingRequestSent(requestId: string): Promise<void> {
  return enqueueRequestWrite(async () => {
    const request = state.pendingRequest;
    if (!request || request.id !== requestId || request.status !== 'ready') return;
    await writePendingRequest(
      { ...request, status: 'waiting', updatedAt: new Date().toISOString() },
      request,
    );
  });
}

/** Commit an approved AI plan using the same validated transaction as direct edits. */
export async function applyAiPlan(
  identity: Pick<
    PendingRequest,
    'id' | 'planId' | 'baseRevision' | 'contextRevision' | 'generatedAt' | 'kind'
  >,
  plan: DatePlan,
  impactSnapshot?: ValidationSnapshot,
): Promise<boolean> {
  const current = state.pack;
  const request = state.pendingRequest;
  if (
    !current ||
    current.id !== identity.planId ||
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
  const replan = request.kind === 'next-change' || request.kind === 'remaining-change';
  const checkImpact = (before: DatePlan): boolean => {
    if (protectionReasons(before, plan).length) return false;
    if (!replan) return true;
    const allowed = getAiScopeEventIds(
      before,
      state.runtime,
      request.kind as 'next-change' | 'remaining-change',
      new Date(),
      state.liveContext,
    );
    if ((request.scopeEventIds ?? []).some((id) => !allowed.includes(id))) return false;
    const input = localImpactInput({
      documentId: current?.id,
      before,
      proposed: plan,
      planRevision: identity.baseRevision,
      contextRevision: identity.contextRevision,
      requestId: identity.id,
      scopeEventIds: request.scopeEventIds ?? [],
      eventIds: getAiScopeEventIds(
        before,
        state.runtime,
        'remaining-change',
        new Date(),
        state.liveContext,
      ),
    });
    if (
      hasRouteImpact(before, plan) &&
      (!impactSnapshot || !snapshotMatches(impactSnapshot, input))
    )
      return false;
    return validateImpact(input).status === 'verified';
  };
  if (!checkImpact(current.plan)) {
    showToast(
      getLocale() === 'ko'
        ? '동선을 확인하지 못했어요. 기존 일정을 유지하고 다른 후보를 확인해주세요.'
        : 'Route not confirmed. Keep this plan and check another option.',
    );
    return false;
  }
  const guard: AiCommitGuard = {
    requestId: identity.id,
    kind: identity.kind,
    baseRevision: identity.baseRevision,
    contextRevision: identity.contextRevision,
    generatedAt: identity.generatedAt,
    responseFingerprint: request.responseFingerprint,
    answerText: request.answerText,
    requestUpdate: completed,
    validateImpact: checkImpact,
  };
  try {
    const saved = await commitPlanChange(
      current,
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
  const current = state.document ?? state.pack;
  if (!current) return false;
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    await refreshAfterConflict(new Error('revision-conflict'));
    return false;
  }
  try {
    const pack = await commitExperienceChange(
      current.id,
      current.revision,
      experiences,
      assets,
      assetWrites,
    );
    for (const { asset, blob } of assetWrites) blobCache.set(cacheKey(pack.id, asset.id), blob);
    setState({ pack: pack.kind === 'outing' ? pack : null, document: pack });
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
  const current = state.document ?? state.pack;
  const request = state.pendingRequest;
  const payload = request?.payload as
    | { experienceId?: unknown; originalText?: unknown }
    | undefined;
  if (
    !current ||
    identity.kind !== 'memory-edit' ||
    current.id !== identity.planId ||
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
  const parsed = parseMemoryReply(
    request.answerText,
    {
      requestId: request.id,
      packId: request.planId,
      baseRevision: request.baseRevision,
      contextRevision: request.contextRevision,
      generatedAt: request.generatedAt,
      kind: 'memory-edit',
    },
    experience,
    payload.originalText,
  );
  if (!parsed.ok || parsed.experienceId !== experienceId || parsed.editedText !== editedText.trim())
    return false;
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
    setState({
      pack: saved.kind === 'outing' ? saved : null,
      document: saved,
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

/** P3's explicit “refresh baseline” action; first-record capture happens with experience commit. */
export async function updateBaselinePlan(): Promise<void> {
  if (!state.pack) return;
  try {
    const pack = await commitBaselinePlan(state.pack, state.pack.revision);
    setState({ pack: pack.kind === 'outing' ? pack : null, document: pack });
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
    state.runtime ?? emptyRuntime(state.pack.id),
  );
  mutate(runtime);
  runtime.planId = state.pack.id;
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

  const pack: OutingDatePack = structuredClone(state.pack);
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
  for (const { asset, blob } of registered) blobCache.set(cacheKey(pack.id, asset.id), blob);
  showToast(t('toast.photos.added'));
}

export async function setCoverFromFiles(files: FileList | File[]): Promise<void> {
  if (!state.pack) return;
  const first = (await createAssetsFromFiles(files))[0];
  if (!first) return;

  const pack: OutingDatePack = structuredClone(state.pack);
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
  blobCache.set(cacheKey(pack.id, asset.id), first.blob);
  showToast(t('toast.cover.changed'));
}

export async function removeAsset(assetId: string): Promise<void> {
  if (!state.pack) return;
  const pack: OutingDatePack = structuredClone(state.pack);
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
  impactSnapshot?: ValidationSnapshot,
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
  const input = localImpactInput({
    documentId: state.pack.id,
    before: basePlan,
    proposed: plan,
    planRevision: state.pack.revision,
    contextRevision: state.contextRevision,
  });
  if (
    validateImpact(input).status !== 'verified' ||
    (hasRouteImpact(basePlan, plan) && (!impactSnapshot || !snapshotMatches(impactSnapshot, input)))
  ) {
    return { applied: [], skipped: [{ key: 'err.patch.nothingApplied' }] };
  }
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
  const runtime = emptyRuntime(pack.id);
  await savePack(pack);
  await saveRuntime(runtime);
  await setCurrentPackId(pack.id);
  setState({
    status: 'ready',
    pack: pack.kind === 'outing' ? pack : null,
    document: pack,
    runtime,
    savedPacks: await listOutings(),
    undoStack: [],
    liveContext: null,
    contextRevision: 0,
    personalJourney: null,
    pendingRequest: null,
  });
  showToast(t('toast.pack.created'));
}

export async function createAiDraftPack(
  pack: OutingDatePack,
  request: PendingRequest,
): Promise<void> {
  await savePackWithPendingRequest(pack, request);
  const runtime = emptyRuntime(pack.id);
  setState({
    status: 'ready',
    pack: pack.kind === 'outing' ? pack : null,
    document: pack,
    runtime,
    savedPacks: await listOutings(),
    undoStack: [],
    liveContext: null,
    contextRevision: 0,
    personalJourney: null,
    pendingRequest: request,
  });
  showToast(t('toast.pack.created'));
}

/** Create a pack from an AI-authored plan (datepack.plan draft already built). */
export async function createPackFromPlan(pack: OutingDatePack): Promise<void> {
  const runtime = emptyRuntime(pack.id);
  const savedPack = await savePack(pack, undefined, false, true);
  await saveRuntime(runtime);
  await setCurrentPackId(savedPack.id);
  setState({
    status: 'ready',
    pack: savedPack.kind === 'outing' ? savedPack : null,
    document: savedPack,
    runtime,
    savedPacks: await listOutings(),
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
  const prior = await loadPack(seed.pack.id);
  const pack = await savePack(seed.pack, prior?.revision, true, true);
  for (const { asset, blob } of seed.blobs) await putAsset(seed.pack.id, asset, blob);
  for (const { asset, blob } of seed.blobs) blobCache.set(cacheKey(seed.pack.id, asset.id), blob);
  const runtime = emptyRuntime(seed.pack.id);
  await saveRuntime(runtime);
  await setCurrentPackId(seed.pack.id);
  setState({
    status: 'ready',
    pack: pack.kind === 'outing' ? pack : null,
    document: pack,
    runtime,
    savedPacks: await listOutings(),
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
  );
  for (const [assetId, blob] of result.blobs) blobCache.set(cacheKey(pack.id, assetId), blob);
  const runtime =
    pack.kind === 'outing' ? ((await loadRuntime(pack.id)) ?? emptyRuntime(pack.id)) : null;
  if (runtime) await saveRuntime(runtime);
  const device = await loadDeviceState(pack.id);
  await setCurrentPackId(pack.id);
  setState({
    status: 'ready',
    pack: pack.kind === 'outing' ? pack : null,
    document: pack,
    runtime,
    savedPacks: await listOutings(),
    undoStack: device.undoStack,
    liveContext: device.liveContext ?? null,
    contextRevision: device.contextRevision ?? device.liveContext?.revision ?? 0,
    personalJourney: device.personalJourney ?? null,
    pendingRequest: device.pendingRequest ?? null,
  });
  const warnNote = result.warnings.length > 0 ? ` (${t(result.warnings[0])})` : '';
  showToast(
    t('toast.pack.imported', {
      title: pack.plan?.title ?? pack.meta.title ?? t('fallback.packTitle'),
      warn: warnNote,
    }),
  );
}

export async function exportCurrentPack(): Promise<void> {
  const pack = state.document ?? state.pack;
  if (!pack) return;
  // Make sure every asset blob is in the cache (they may only live in IndexedDB
  // after a reload), then build the portable JSON once.
  const missing = pack.assets.filter((a) => !blobCache.has(cacheKey(pack.id, a.id)));
  if (missing.length > 0) {
    const stored = await listPackAssetBlobs(pack.id);
    for (const asset of missing) {
      const blob = stored.get(asset.id);
      if (blob) blobCache.set(cacheKey(pack.id, asset.id), blob);
    }
  }
  const result = await writeDatePack(
    pack,
    (assetId) => blobCache.get(cacheKey(pack.id, assetId)) ?? null,
  );
  downloadBlob(result.blob, result.filename);
  showToast(
    result.missingAssetIds.length > 0 ? t('toast.pack.exportedPartial') : t('toast.pack.exported'),
  );
}

export async function switchPack(packId: string): Promise<void> {
  const document = await loadPack(packId);
  if (!document || !validateDatePack(document).ok) {
    showToast(t('err.read.invalidContent'));
    return;
  }
  const [runtime, device] = await Promise.all([loadRuntime(packId), loadDeviceState(packId)]);
  await setCurrentPackId(packId);
  setState({
    status: 'ready',
    document,
    pack: document.kind === 'outing' ? document : null,
    runtime: document.kind === 'outing' ? (runtime ?? emptyRuntime(packId)) : null,
    undoStack: document.kind === 'outing' ? device.undoStack : [],
    liveContext: device.liveContext ?? null,
    contextRevision: device.contextRevision ?? 0,
    personalJourney: device.personalJourney ?? null,
    pendingRequest: device.pendingRequest ?? null,
  });
  showToast(
    t('toast.pack.switched', {
      title: document.plan?.title ?? document.meta.title ?? t('fallback.packTitle'),
    }),
  );
}

export async function deletePackById(packId: string): Promise<void> {
  const wasSelected = state.document?.id === packId;
  const preserved = await deletePack(packId, wasSelected ? state.document?.revision : undefined);
  blobCache.clear();
  await refreshLibrary();
  if (wasSelected) {
    const nextId = preserved?.id ?? state.savedDocuments[0]?.pack.id;
    if (nextId) await switchPack(nextId);
    else
      setState({
        status: 'empty',
        pack: null,
        document: null,
        runtime: null,
        pendingRequest: null,
        undoStack: [],
        liveContext: null,
        personalJourney: null,
        contextRevision: 0,
      });
  }
  showToast(t('toast.pack.deleted'));
}

async function listOutings(): Promise<SavedPackSummary[]> {
  const documents = await listPacks();
  const savedActivities = await readLibraryActivities(documents);
  setState({ savedDocuments: documents, savedActivities });
  return documents.filter((row): row is SavedPackSummary => row.pack.kind === 'outing');
}

/** Library actions do not discard selected photos or drafts on a failed write. */
export async function saveRecord(
  experience: Experience,
  options: { packId?: string; expectedRevision?: number; assetWrites?: AssetWrite[] } = {},
): Promise<DatePack> {
  const document = await saveExperience(experience, options);
  await presentSavedDocument(document);
  return document;
}
export async function connectRecord(
  sourceId: string,
  revision: number,
  experienceId: string,
  destination?: ExperienceDestination,
): Promise<DatePack> {
  const { target } = await moveExperience(sourceId, revision, experienceId, destination);
  blobCache.clear();
  await presentSavedDocument(target);
  return target;
}
export async function deleteRecord(
  packId: string,
  revision: number,
  experienceId: string,
): Promise<void> {
  await deleteExperience(packId, revision, experienceId);
  blobCache.clear();
  await refreshLibrary();
  if (state.document?.id === packId) {
    const current = await loadPack(packId);
    if (current) await switchPack(packId);
    else if (state.savedDocuments[0]) await switchPack(state.savedDocuments[0].pack.id);
    else
      setState({
        status: 'empty',
        pack: null,
        document: null,
        runtime: null,
        pendingRequest: null,
        undoStack: [],
      });
  }
}
export async function refreshLibrary(): Promise<void> {
  const savedDocuments = await listPacks();
  const savedActivities = await readLibraryActivities(savedDocuments);
  setState({
    savedDocuments,
    savedActivities,
    savedPacks: savedDocuments.filter((row): row is SavedPackSummary => row.pack.kind === 'outing'),
  });
}

/** Device/request metadata is small; no photo binaries are loaded for the home screen. */
async function readLibraryActivities(
  documents: Array<{ pack: DatePack }>,
): Promise<LibraryActivity[]> {
  return Promise.all(
    documents.map(async ({ pack }) => {
      const [device, runtime] = await Promise.all([
        loadDeviceState(pack.id),
        pack.kind === 'outing' ? loadRuntime(pack.id) : Promise.resolve(undefined),
      ]);
      return summarizeActivity(pack, device, runtime);
    }),
  );
}
/** Export any document without changing the current selection. */
export async function exportPackById(packId: string): Promise<void> {
  const pack = await loadPack(packId);
  if (!pack) throw new Error('pack-missing');
  const blobs = await listPackAssetBlobs(packId);
  const result = await writeDatePack(pack, (id) => blobs.get(id));
  downloadBlob(result.blob, result.filename);
}

/** A library refresh failure cannot turn an already committed record into a failed save. */
async function presentSavedDocument(document: DatePack): Promise<void> {
  const sameDocument = state.document?.id === document.id;
  const rows = state.savedDocuments.filter((row) => row.pack.id !== document.id);
  rows.unshift({ pack: document, savedAt: document.meta.updatedAt });
  setState({
    status: 'ready',
    document,
    pack: document.kind === 'outing' ? document : null,
    savedDocuments: rows,
    savedPacks: rows.filter((row): row is SavedPackSummary => row.pack.kind === 'outing'),
    ...(!sameDocument
      ? {
          runtime: document.kind === 'outing' ? emptyRuntime(document.id) : null,
          undoStack: [],
          liveContext: null,
          contextRevision: 0,
          personalJourney: null,
          pendingRequest: null,
        }
      : {}),
  });
  try {
    await refreshLibrary();
    await switchPack(document.id);
  } catch (error) {
    console.error('[datepack] saved record library refresh failed', error);
    showToast(
      getLocale() === 'ko'
        ? '기록은 저장됐어요. 목록을 다시 열어주세요.'
        : 'Record saved. Please reopen the library.',
    );
  }
}
