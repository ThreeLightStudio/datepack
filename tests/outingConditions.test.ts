import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatePack,
  createMemoriesPack,
  parsePlanDraft,
  buildPlanFromDraft,
  writeDatePack,
  readDatePack,
  validateDatePack,
} from '@datepack/core';
import { initialOutingForm, outingBrief } from '../src/features/outing/conditions';
import { buildCreatePrompt } from '../src/features/ai/createPromptBuilder';
import { buildAiPrompt } from '../src/features/ai/promptBuilder';
import { responseContract, responseFingerprint } from '../src/features/ai/exchange';
import {
  closeStorage,
  loadPack,
  saveAiFormDraft,
  loadAiFormDraft,
  savePack,
} from '../src/storage/indexedDb';
import {
  applyAiPlan,
  createNewPack,
  createAiDraftPack,
  getStoreState,
  initStore,
  updatePendingRequest,
  dismissToast,
} from '../src/store/datepackStore';

beforeEach(async () => {
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase('datepack');
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
afterEach(async () => {
  dismissToast();
  await closeStorage();
});
const brief = outingBrief({
  ...initialOutingForm,
  party: 'solo',
  nearby: 'yes',
  singleStop: 'yes',
  budgetBasis: 'per-person',
  region: '성수동',
  budget: '10000',
  durationMinutes: '120',
  startTime: '23:00',
  endTime: '01:00',
  endDay: '1',
});

describe('portable outing brief and creation consistency', () => {
  it('keeps solo, KRW budget and loose duration through direct save, draft import and file round trip', async () => {
    await createNewPack('혼자 두 시간', '', brief);
    const direct = getStoreState().pack!;
    const draft = parsePlanDraft(
      JSON.stringify({
        type: 'datepack.plan',
        version: 1,
        title: '혼자 두 시간',
        ...brief,
        events: [{ title: '활동 하나' }],
      }),
      { allowUndated: true },
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const imported = buildPlanFromDraft(draft.draft);
    expect(imported.plan.outingConditions).toEqual(direct.plan.outingConditions);
    expect(imported.plan.events[0].timing).toEqual({ kind: 'unscheduled' });
    const restored = await readDatePack((await writeDatePack(imported, () => null)).blob);
    expect(restored.pack.kind).toBe('outing');
    if (restored.pack.kind === 'outing') expect(restored.pack.plan).toMatchObject(brief);
    expect((await loadPack(direct.id))?.kind).toBe('outing');
  });
  it.each(['-1', '1.5', 'abc', '9007199254740992'])(
    'rejects invalid total budgets %s before saving',
    (budget) => {
      expect(() => outingBrief({ ...initialOutingForm, budget })).toThrow();
      const pack = createDatePack({ title: 'bad' });
      pack.plan.outingConditions = {
        budget: { currency: 'KRW', amount: Number(budget), basis: 'total' },
      };
      expect(validateDatePack(pack).ok).toBe(false);
    },
  );
  it('rejects invalid portable brief shapes and accepts zero spending without a required start time', () => {
    expect(
      outingBrief({ ...initialOutingForm, budget: '0', durationMinutes: '120' }),
    ).toMatchObject({
      outingConditions: { budget: { amount: 0 }, durationMinutes: 120 },
      availableFrom: undefined,
    });
    for (const conditions of [
      { party: 'couple' },
      { durationMinutes: 0 },
      { budget: { currency: 'USD', amount: 10 } },
      { budget: { currency: 'KRW', amount: 100, verified: true } },
    ]) {
      expect(
        parsePlanDraft(
          JSON.stringify({
            type: 'datepack.plan',
            version: 1,
            title: 'invalid',
            outingConditions: conditions,
            events: [],
          }),
          { allowUndated: true, allowEmpty: true },
        ).ok,
      ).toBe(false);
    }
    expect(() =>
      outingBrief({ ...initialOutingForm, startTime: '23:00', endTime: '01:00' }),
    ).toThrow();
  });
  it('instructs AI to respect solo conditions without questions about companions, and carries the same brief into replanning', () => {
    const prompt = buildCreatePrompt({ region: '성수동', ...brief, locale: 'ko' });
    expect(prompt).toContain('10,000 원 이내');
    expect(prompt).toContain('120분 정도');
    expect(prompt).toContain('한 사람당');
    expect(prompt).toContain('한 곳만 방문');
    expect(prompt).toContain('가까운 이동 선호');
    expect(prompt).toContain('합류 정보는 질문하지');
    expect(prompt).toContain('확인되지 않은 비용');
    const plan = createDatePack({ title: 'Solo', ...brief }).plan;
    const replan = buildAiPrompt({
      plan,
      runtime: null,
      situationId: 'tired',
      locale: 'ko',
    } as Parameters<typeof buildAiPrompt>[0]);
    expect(replan).toContain('120분 정도');
    expect(replan).toContain('동행자나 합류 정보를 묻지');
  });
  it('uses document ID for AI creation and refuses an approved reply that changes the user brief', async () => {
    const pack = createDatePack({ title: 'Solo', ...brief });
    pack.id = 'document-independent';
    const stamp = '2026-10-02T00:00:00Z';
    const request = {
      id: 'request',
      planId: pack.id,
      kind: 'create' as const,
      status: 'ready' as const,
      input: 'brief',
      baseRevision: 0,
      contextRevision: 0,
      generatedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await createAiDraftPack(pack, request);
    const raw = responseContract(
      {
        requestId: request.id,
        packId: pack.id,
        kind: 'create',
        baseRevision: 0,
        contextRevision: 0,
        generatedAt: stamp,
      },
      { type: 'datepack.plan', version: 1, title: 'Solo', events: [] },
    );
    await updatePendingRequest(
      {
        ...request,
        status: 'review',
        answerText: raw,
        responseFingerprint: responseFingerprint(raw),
      },
      request,
    );
    const proposed = structuredClone(pack.plan);
    proposed.title = 'One stop';
    proposed.outingConditions!.budget!.amount = 20000;
    expect(await applyAiPlan(request, proposed)).toBe(false);
    expect((await loadPack(pack.id))?.revision).toBe(0);
    proposed.outingConditions = brief.outingConditions;
    expect(await applyAiPlan(request, proposed)).toBe(true);
    expect(getStoreState().pack?.plan.id).toBe(pack.plan.id);
  });
  it('restores new and legacy drafts independently of selected memories and documents', async () => {
    await saveAiFormDraft('create', {
      region: 'legacy',
      notes: 'kept',
      startTime: '',
      endTime: '',
    });
    await saveAiFormDraft('replan:outing', { customInput: 'one stop' });
    const memories = createMemoriesPack([
      { id: 'record', outcome: 'note', recordedAt: '2026-10-02T00:00:00Z', note: 'original' },
    ]);
    await savePack(memories);
    await saveAiFormDraft(`memory:${memories.id}`, {
      experienceId: 'record',
      note: 'partial answer',
    });
    await closeStorage();
    await initStore();
    expect({
      ...initialOutingForm,
      ...((await loadAiFormDraft('create')) as Record<string, string>),
    }).toMatchObject({
      party: '',
      budget: '',
      durationMinutes: '',
      region: 'legacy',
      notes: 'kept',
    });
    expect(await loadAiFormDraft(`memory:${memories.id}`)).toMatchObject({
      experienceId: 'record',
      note: 'partial answer',
    });
    expect(await loadAiFormDraft('replan:outing')).toMatchObject({ customInput: 'one stop' });
  });
});
