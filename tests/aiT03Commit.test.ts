import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPlanFromDraft,
  createDatePack,
  parsePlanDraft,
  readDatePack as readAnyDatePack,
  writeDatePack,
  type Experience,
} from '@datepack/core';
import {
  closeStorage,
  loadDeviceState,
  loadPack as loadAnyPack,
  saveDeviceState,
  savePack,
  setCurrentPackId,
  type PendingRequest,
} from '../src/storage/indexedDb';
import {
  applyAiMemoryNote,
  applyAiPlan,
  dismissToast,
  initStore,
} from '../src/store/datepackStore';
import {
  parseAiResponse,
  responseContract,
  responseFingerprint,
  type AiRequestIdentity,
} from '../src/features/ai/exchange';
import { parseMemoryReply } from '../src/features/memories/aiMemory';

beforeEach(async () => {
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterEach(async () => {
  dismissToast();
  await closeStorage();
});

async function setup(
  kind: 'create' | 'memory-edit',
  result: unknown,
  experiences: Experience[] = [],
) {
  const pack = createDatePack({ title: 'Undated draft' });
  pack.experiences = experiences;
  const stamp = '2026-10-01T07:40:00Z';
  const identity: AiRequestIdentity = {
    requestId: `T03-${kind}-commit`,
    packId: pack.plan.id,
    baseRevision: 0,
    contextRevision: 0,
    generatedAt: stamp,
    kind,
  };
  const answerText = `Approved\n${responseContract(identity, result)}\nPaste into DatePack and review.`;
  const request: PendingRequest = {
    id: identity.requestId,
    planId: pack.plan.id,
    baseRevision: 0,
    contextRevision: 0,
    kind,
    status: 'review',
    generatedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
    input: 'Request',
    answerText,
    responseFingerprint: responseFingerprint(answerText),
    ...(kind === 'memory-edit'
      ? { payload: { experienceId: experiences[0].id, originalText: experiences[0].note } }
      : {}),
  };
  await savePack(pack);
  await saveDeviceState({ planId: pack.plan.id, undoStack: [], pendingRequest: request });
  await setCurrentPackId(pack.plan.id);
  await initStore();
  return { pack, identity, request, answerText };
}

describe('T03 response application and portable storage', () => {
  it('commits a parsed create result without forcing dates or sorting unset/window/next-day stops', async () => {
    const result = {
      type: 'datepack.plan',
      version: 1,
      title: 'Chosen order',
      events: [
        { title: 'Unset' },
        {
          title: 'Next day',
          timing: { kind: 'exact', start: { dayOffset: 1, time: '00:20' } },
          estimatedDurationMinutes: 30,
          protectedFields: ['time', 'order'],
        },
        {
          title: 'Window',
          timing: {
            kind: 'window',
            earliestStart: { dayOffset: 0, time: '23:10' },
            latestStart: { dayOffset: 1, time: '00:10' },
          },
        },
      ],
    };
    const { pack, request, identity, answerText } = await setup('create', result);
    const envelope = parseAiResponse(answerText, identity);
    if (!envelope.ok) throw new Error(envelope.reason);
    const draft = parsePlanDraft(JSON.stringify(envelope.response.result), {
      allowEmpty: true,
      allowUndated: true,
    });
    if (!draft.ok) throw new Error(JSON.stringify(draft.errors));
    const proposed = { ...buildPlanFromDraft(draft.draft).plan, id: pack.plan.id };
    expect(await applyAiPlan(request, proposed)).toBe(true);
    const saved = await loadPack(pack.plan.id);
    if (!saved) throw new Error('Missing saved pack');
    expect(saved.plan).toEqual(proposed);
    expect(saved.plan!.date).toBeUndefined();
    expect(saved.plan!.events.map((event) => event.title)).toEqual(['Unset', 'Next day', 'Window']);
    expect((await loadDeviceState(pack.plan.id)).pendingRequest?.status).toBe('applied');
    expect(await applyAiPlan(request, proposed)).toBe(false);
    const { blob } = await writeDatePack(saved, () => null);
    const imported = await readDatePack(blob);
    expect(imported.pack.plan.events.map((event) => event.timing)).toEqual(
      saved.plan!.events.map((event) => event.timing),
    );
    expect(imported.pack.plan.events[1].protectedFields).toEqual(['time', 'order']);
  });

  it('keeps the verbatim original and outcome while committing separately reviewed memory wording', async () => {
    const original: Experience = {
      id: 'T03-original',
      title: 'Break',
      outcome: 'note',
      recordedAt: '2026-10-01T07:30:00Z',
      note: '  비를 피했다.\n커피를 마셨다.  ',
    };
    const result = { experienceId: original.id, editedText: '비를 피하며 커피를 마셨다.' };
    const { pack, identity, request, answerText } = await setup('memory-edit', result, [original]);
    const parsed = parseMemoryReply(answerText, identity, original, original.note);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(await applyAiMemoryNote(request, parsed.experienceId, parsed.editedText)).toBe(true);
    const saved = await loadPack(pack.plan.id);
    if (!saved) throw new Error('Missing memory pack');
    expect(saved.experiences).toEqual([{ ...original, editedNote: result.editedText }]);
    expect(saved.plan).toEqual(pack.plan);
    expect(await applyAiMemoryNote(request, parsed.experienceId, parsed.editedText)).toBe(false);
    const imported = await readDatePack((await writeDatePack(saved, () => null)).blob);
    expect(imported.pack.experiences).toEqual(saved.experiences);
  });

  it('rejects mismatched memory IDs at the commit boundary without changing original or pending reply', async () => {
    const original: Experience = {
      id: 'T03-original',
      title: 'Break',
      outcome: 'note',
      recordedAt: '2026-10-01T07:30:00Z',
      note: 'Original',
    };
    const { pack, request, answerText } = await setup(
      'memory-edit',
      { experienceId: original.id, editedText: 'Edited' },
      [original],
    );
    expect(await applyAiMemoryNote(request, 'another-memory', 'Edited')).toBe(false);
    expect((await loadPack(pack.plan.id))?.experiences).toEqual([original]);
    expect((await loadDeviceState(pack.plan.id)).pendingRequest?.answerText).toBe(answerText);
    expect((await loadDeviceState(pack.plan.id)).pendingRequest?.status).toBe('review');
  });
});

async function readDatePack(file: Blob) {
  const result = await readAnyDatePack(file);
  if (result.pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return { ...result, pack: result.pack };
}

async function loadPack(id: string) {
  const pack = await loadAnyPack(id);
  if (pack && pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return pack;
}
