import { useEffect, useRef, useState } from 'react';
import type {
  DatePackRuntimeState,
  DatePlan,
  PatchChange,
  PatchChangeDetail,
  PatchOutcome,
  EventTiming,
} from '@datepack/core';
import { describePatch, parsePatch } from '@datepack/core';
import { buildAiPrompt, getAiScopeEventIds, SITUATIONS } from './promptBuilder';
import { timingLabel } from './timingPresentation';
import {
  applyAiPlan,
  showToast,
  undo,
  updatePendingRequest,
  updateLiveContext,
  getStoreState,
  useStore,
} from '../../store/datepackStore';
import type { PendingRequest } from '../../storage/indexedDb';
import { acquireLocation, setLocalObservation, toCoarseContext } from '../day/location';
import { prepareImpact, type ImpactResult } from '../day/routeImpact';
import { impactMessage, locationMessage } from '../day/routeCopy';
import { CopyIcon, SparkleIcon, UndoIcon } from '../../components/icons';
import { eventTypeLabel, format, useLocale } from '../../i18n';
import {
  isPatchWithinScope,
  parseAiResponse,
  responseFingerprint,
  type AiRequestIdentity,
} from './exchange';

type Props = { plan: DatePlan; runtime: DatePackRuntimeState | null };

type Stage = 'idle' | 'prompted';

function detailLabel(locale: 'ko' | 'en', d: PatchChangeDetail): string {
  switch (d.field) {
    case 'timing':
      return `${locale === 'ko' ? '시간' : 'Time'}: ${d.from ? timingLabel(JSON.parse(d.from) as EventTiming, locale) : ''} → ${d.to ? timingLabel(JSON.parse(d.to) as EventTiming, locale) : ''}`;
    case 'place':
      return `${locale === 'ko' ? '장소' : 'Place'}: ${d.from ?? ''} → ${d.to ?? ''}`;
    case 'duration':
      return `${locale === 'ko' ? '체류 시간' : 'Duration'}: ${d.from ?? (locale === 'ko' ? '미정' : 'unset')} → ${d.to} ${locale === 'ko' ? '분' : 'min'}`;
    case 'start':
      return format(locale, 'change.field.start', { from: d.from ?? '', to: d.to ?? '' });
    case 'end':
      return format(locale, 'change.field.end', { from: d.from ?? '', to: d.to ?? '' });
    case 'title':
      return format(locale, 'change.field.title', { from: d.from ?? '', to: d.to ?? '' });
    case 'type':
      return format(locale, 'change.field.type', {
        from: eventTypeLabel(locale, d.from ?? ''),
        to: eventTypeLabel(locale, d.to ?? ''),
      });
    case 'note':
      return format(locale, 'change.field.note');
    case 'travelMinutes':
      return format(locale, 'change.field.travel', { from: d.from ?? '', to: d.to ?? '' });
    case 'fixedOn':
      return format(locale, 'change.field.fixedOn');
    case 'fixedOff':
      return format(locale, 'change.field.fixedOff');
    default:
      return format(locale, 'change.field.other', { field: d.field, to: d.to ?? '' });
  }
}

function changeLabel(locale: 'ko' | 'en', change: PatchChange): string {
  const label = (() => {
    switch (change.op) {
      case 'move':
        if (change.toTiming)
          return `${change.title} · ${change.fromTiming ? timingLabel(change.fromTiming, locale) : ''} → ${timingLabel(change.toTiming, locale)}`;
        return format(locale, 'change.move', {
          title: change.title,
          from: change.from ?? '',
          to: change.to ?? '',
        });
      case 'remove':
        return format(locale, 'change.remove', { title: change.title });
      case 'insertBefore':
      case 'insertAfter': {
        const inserted = format(
          locale,
          change.op === 'insertBefore' ? 'change.insertBefore' : 'change.insertAfter',
          {
            title: change.title,
            newTitle: change.newTitle,
            time: change.newTiming
              ? timingLabel(change.newTiming, locale)
              : (change.newStart ?? (locale === 'ko' ? '시간 미정' : 'time unset')),
          },
        );
        return change.newPlace
          ? `${inserted} · ${locale === 'ko' ? '장소' : 'Place'}: ${change.newPlace}`
          : inserted;
      }
      case 'insertFirst': {
        const inserted = format(locale, 'change.insertFirst', {
          newTitle: change.newTitle,
          time: change.newTiming
            ? timingLabel(change.newTiming, locale)
            : (change.newStart ?? (locale === 'ko' ? '시간 미정' : 'time unset')),
        });
        return change.newPlace
          ? `${inserted} · ${locale === 'ko' ? '장소' : 'Place'}: ${change.newPlace}`
          : inserted;
      }
      case 'replace':
        return format(locale, 'change.replace', {
          title: change.title,
          details: change.details.map((d) => detailLabel(locale, d)).join(', '),
        });
    }
  })();
  // A locked stop changing hands is legal (the user may have rebooked it) but
  // must be impossible to miss in the review list.
  return 'fixed' in change && change.fixed
    ? `${label} ${format(locale, 'change.fixedTag')}`
    : label;
}

export function AiSection({ plan, runtime }: Props) {
  const locale = useLocale();
  const { undoStack, pack, contextRevision, pendingRequest, liveContext } = useStore();
  const requestBusy = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [situationId, setSituationId] = useState<string | null>(null);
  const [scopeKind, setScopeKind] = useState<'next-change' | 'remaining-change'>(
    'remaining-change',
  );
  const [customInput, setCustomInput] = useState('');
  const [prompt, setPrompt] = useState('');
  const [patchText, setPatchText] = useState('');
  const [review, setReview] = useState<
    | {
        ok: true;
        changes: PatchChange[];
        warnings: string[];
        prepared: PatchOutcome;
        impact: ImpactResult;
      }
    | { ok: false; errors: string[] }
    | null
  >(null);

  const isCustom = situationId === 'custom';

  useEffect(() => {
    if (
      !pendingRequest ||
      (pendingRequest.kind !== 'next-change' && pendingRequest.kind !== 'remaining-change') ||
      pendingRequest.planId !== plan.id ||
      ['applied', 'cancelled'].includes(pendingRequest.status)
    )
      return;
    setStage('prompted');
    setPrompt(pendingRequest.input);
    setPatchText(pendingRequest.answerText ?? '');
    setScopeKind(pendingRequest.kind);
    setReview(null);
    if (pendingRequest.status === 'review' && pendingRequest.answerText) {
      window.setTimeout(
        () =>
          void checkPatch(pendingRequest.answerText, true).catch(() =>
            setReview({ ok: false, errors: [format(locale, 'ai.request.stale')] }),
          ),
        0,
      );
    }
  }, [pendingRequest?.id, plan.id]);

  const activeRequest =
    pendingRequest &&
    pendingRequest.planId === plan.id &&
    (pendingRequest.kind === 'next-change' || pendingRequest.kind === 'remaining-change') &&
    !['applied', 'cancelled'].includes(pendingRequest.status)
      ? pendingRequest
      : null;
  const identity: AiRequestIdentity | null = activeRequest
    ? {
        requestId: activeRequest.id,
        packId: activeRequest.planId,
        baseRevision: activeRequest.baseRevision,
        contextRevision: activeRequest.contextRevision,
        generatedAt: activeRequest.generatedAt,
        kind: activeRequest.kind,
      }
    : null;

  function eligibleIds(kind: 'next-change' | 'remaining-change'): string[] {
    return getAiScopeEventIds(plan, runtime, kind, new Date(), liveContext);
  }

  async function prepareRequest(id: string, custom?: string): Promise<void> {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setPreparing(true);
    try {
      await prepareRequestWithLocation(id, custom);
    } catch {
      showToast(
        locale === 'ko'
          ? '현재 상황을 저장하지 못했어요. 다시 시도해주세요.'
          : 'Could not save the current context. Try again.',
      );
    } finally {
      requestBusy.current = false;
      setPreparing(false);
    }
  }

  async function prepareRequestWithLocation(id: string, custom?: string): Promise<void> {
    if (!pack || pack.plan.id !== plan.id) return;
    if (
      pendingRequest &&
      pendingRequest.planId === plan.id &&
      !['applied', 'cancelled', 'stale'].includes(pendingRequest.status)
    ) {
      showToast(
        locale === 'ko'
          ? '진행 중인 요청을 먼저 마치거나 취소해주세요.'
          : 'Finish or cancel the current request first.',
      );
      return;
    }
    const startingState = getStoreState();
    if (liveContext?.gpsConsent) {
      const lastKnown = liveContext.locationAttempt?.observation?.coarseLabel
        ? liveContext.locationAttempt.observation
        : (liveContext.locationAttempt?.lastKnown ??
          (liveContext.place
            ? {
                source: 'manual' as const,
                coarseLabel: liveContext.place,
                observedAt: liveContext.confirmedAt ?? liveContext.updatedAt,
              }
            : undefined));
      const attempt = await acquireLocation(true, { lastKnown });
      const after = getStoreState();
      if (
        after.pack?.plan.id !== plan.id ||
        after.pack.revision !== pack.revision ||
        after.contextRevision !== startingState.contextRevision
      ) {
        showToast(format(locale, 'ai.request.stale'));
        return;
      }
      await updateLiveContext(
        {
          ...liveContext,
          updatedAt: new Date().toISOString(),
          locationAttempt: toCoarseContext(attempt),
        },
        startingState.contextRevision,
      );
      setLocalObservation(plan.id, attempt.observation);
    } else setLocalObservation(plan.id);
    const fresh = getStoreState();
    if (fresh.pack?.plan.id !== plan.id || fresh.pack.revision !== pack.revision) return;
    if (
      fresh.pendingRequest?.id !== startingState.pendingRequest?.id ||
      fresh.pendingRequest?.updatedAt !== startingState.pendingRequest?.updatedAt
    ) {
      showToast(format(locale, 'ai.request.stale'));
      return;
    }
    const eventIds = getAiScopeEventIds(plan, runtime, scopeKind, new Date(), fresh.liveContext);
    const requestId = crypto.randomUUID();
    const generatedAt = new Date().toISOString();
    const requestIdentity: AiRequestIdentity = {
      requestId,
      packId: plan.id,
      baseRevision: pack.revision,
      contextRevision: fresh.contextRevision,
      generatedAt,
      kind: scopeKind,
    };
    const note = buildAiPrompt({
      plan,
      runtime,
      situationId: id,
      customInput: custom,
      locale,
      identity: requestIdentity,
      scopeEventIds: eventIds,
      liveContext: fresh.liveContext,
    });
    const request: PendingRequest = {
      id: requestId,
      planId: plan.id,
      kind: scopeKind,
      status: 'ready',
      input: note,
      baseRevision: requestIdentity.baseRevision,
      contextRevision: requestIdentity.contextRevision,
      generatedAt,
      scopeEventIds: eventIds,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };
    try {
      await updatePendingRequest(request);
      setSituationId(id);
      setPrompt(note);
      setPatchText('');
      setReview(null);
      setStage('prompted');
    } catch {
      showToast(
        locale === 'ko'
          ? '요청을 저장하지 못했어요. 다시 시도해주세요.'
          : 'Could not save the request. Please try again.',
      );
    }
  }

  function choose(id: string): void {
    if (id !== 'custom') {
      void prepareRequest(id);
    } else {
      setSituationId(id);
    }
  }

  function buildCustom(): void {
    if (!customInput.trim()) {
      showToast(
        locale === 'ko' ? '상황을 한 줄 입력해주세요.' : 'Describe what happened in a line.',
      );
      return;
    }
    void prepareRequest('custom', customInput);
  }

  async function copyPrompt(): Promise<void> {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      const area = document.createElement('textarea');
      area.value = prompt;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      copied = document.execCommand('copy');
      area.remove();
    }
    if (!copied) {
      showToast(
        locale === 'ko'
          ? '복사하지 못했어요. 요청문을 선택해 직접 복사해주세요.'
          : 'Copy failed. Select the request note and copy it.',
      );
      return;
    }
    if (activeRequest)
      await updatePendingRequest({
        ...activeRequest,
        status: 'waiting',
        updatedAt: new Date().toISOString(),
      });
    showToast(locale === 'ko' ? 'AI 요청문을 복사했어요.' : 'Note copied.');
  }

  async function sharePrompt(): Promise<void> {
    if (!navigator.share) {
      await copyPrompt();
      return;
    }
    try {
      await navigator.share({
        title: locale === 'ko' ? 'DatePack AI 요청' : 'DatePack AI request',
        text: prompt,
      });
      if (activeRequest)
        await updatePendingRequest({
          ...activeRequest,
          status: 'waiting',
          updatedAt: new Date().toISOString(),
        });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (activeRequest)
          await updatePendingRequest({
            ...activeRequest,
            status: 'ready',
            updatedAt: new Date().toISOString(),
          });
        showToast(format(locale, 'ai.request.cancelled'));
      } else
        showToast(
          locale === 'ko'
            ? '공유를 열지 못했어요. 복사해 직접 전달해주세요.'
            : 'Could not open sharing. Copy the request instead.',
        );
    }
  }

  async function checkPatch(raw = patchText, allowPreviouslyReviewed = false): Promise<void> {
    if (!identity || !activeRequest || !pack) return;
    const fingerprint = responseFingerprint(raw);
    if (
      !allowPreviouslyReviewed &&
      activeRequest.responseFingerprint === fingerprint &&
      activeRequest.answerText === raw
    ) {
      setReview({ ok: false, errors: [format(locale, 'ai.request.duplicate')] });
      return;
    }
    if (pack.revision !== identity.baseRevision || contextRevision !== identity.contextRevision) {
      const message = format(locale, 'ai.request.stale');
      setReview({ ok: false, errors: [message] });
      await updatePendingRequest({
        ...activeRequest,
        status: 'stale',
        answerText: raw,
        error: message,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const currentlyAllowed = new Set(
      eligibleIds(identity.kind as 'next-change' | 'remaining-change'),
    );
    if ((activeRequest.scopeEventIds ?? []).some((eventId) => !currentlyAllowed.has(eventId))) {
      const message = format(locale, 'ai.request.stale');
      setReview({ ok: false, errors: [message] });
      await updatePendingRequest({
        ...activeRequest,
        status: 'stale',
        answerText: raw,
        error: message,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const envelope = parseAiResponse(raw, identity);
    if (!envelope.ok) {
      const key =
        envelope.reason === 'mismatch'
          ? 'ai.request.mismatch'
          : envelope.reason === 'missing-id'
            ? 'ai.request.missing'
            : 'ai.review.error';
      const message = format(locale, key);
      setReview({ ok: false, errors: [message] });
      await updatePendingRequest({
        ...activeRequest,
        status: 'error',
        answerText: raw,
        error: message,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const responsePatch = JSON.stringify(envelope.response.result);
    const parsed = parsePatch(responsePatch);
    if (!parsed.ok) {
      const errors = parsed.errors.map((e) => format(locale, e));
      setReview({ ok: false, errors });
      await updatePendingRequest({
        ...activeRequest,
        status: 'error',
        answerText: raw,
        responseFingerprint: fingerprint,
        error: errors.join('\n'),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const allowFirstInsert =
      plan.events.length === 0 && (activeRequest.scopeEventIds?.length ?? 0) === 0;
    if (!isPatchWithinScope(parsed.patch, activeRequest.scopeEventIds ?? [], allowFirstInsert)) {
      const message =
        locale === 'ko'
          ? '요청 범위 밖의 일정이 포함되어 있어 적용할 수 없어요.'
          : 'The reply changes a stop outside this request scope.';
      setReview({ ok: false, errors: [message] });
      await updatePendingRequest({
        ...activeRequest,
        status: 'error',
        answerText: raw,
        responseFingerprint: fingerprint,
        error: message,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const outcome = describePatch(plan, parsed.patch);
    const warnings = [
      ...(Date.now() - Date.parse(activeRequest.generatedAt) > 60_000
        ? [
            locale === 'ko'
              ? '요청 후 시간이 지났어요. 지금 상황과 장소 운영 여부를 다시 확인해주세요.'
              : 'Time has passed since this request. Recheck the current situation and venue hours.',
          ]
        : []),
      ...parsed.warnings.map((w) => format(locale, w)),
      ...outcome.skipped.map((s) => format(locale, s)),
      // Conflicts in the would-be plan are advisory — apply stays possible.
      ...outcome.newConflicts.map((c) => format(locale, c)),
    ];
    if (!outcome.canApply) {
      setReview({
        ok: false,
        errors: warnings.length > 0 ? warnings : [format(locale, 'err.patch.nothingApplied')],
      });
      await updatePendingRequest({
        ...activeRequest,
        status: 'error',
        answerText: raw,
        responseFingerprint: fingerprint,
        error: warnings.join('\n'),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const impact = await prepareImpact({
      before: plan,
      proposed: outcome.plan,
      planRevision: identity.baseRevision,
      contextRevision: identity.contextRevision,
      requestId: identity.requestId,
      scopeEventIds: activeRequest.scopeEventIds ?? [],
      eventIds: eligibleIds('remaining-change'),
    });
    const current = getStoreState();
    if (
      current.pack?.revision !== identity.baseRevision ||
      current.contextRevision !== identity.contextRevision ||
      current.pendingRequest?.id !== identity.requestId
    ) {
      setReview({ ok: false, errors: [format(locale, 'ai.request.stale')] });
      return;
    }
    if (impact.status !== 'verified') {
      const message = impactMessage(impact, locale);
      setReview({ ok: false, errors: [message] });
      await updatePendingRequest({
        ...activeRequest,
        status: 'error',
        answerText: raw,
        responseFingerprint: fingerprint,
        error: message,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    await updatePendingRequest({
      ...activeRequest,
      status: 'review',
      answerText: raw,
      responseFingerprint: fingerprint,
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    setReview({ ok: true, changes: outcome.applied, warnings, prepared: outcome, impact });
  }

  function applyApproved(): void {
    if (!review?.ok || !identity) return;
    const currentlyAllowed = new Set(
      eligibleIds(identity.kind as 'next-change' | 'remaining-change'),
    );
    if ((activeRequest?.scopeEventIds ?? []).some((eventId) => !currentlyAllowed.has(eventId))) {
      setReview({ ok: false, errors: [format(locale, 'ai.request.stale')] });
      if (activeRequest)
        void updatePendingRequest({
          ...activeRequest,
          status: 'stale',
          updatedAt: new Date().toISOString(),
        }).catch(() => undefined);
      return;
    }
    void applyAiPlan(
      {
        id: identity.requestId,
        planId: identity.packId,
        baseRevision: identity.baseRevision,
        contextRevision: identity.contextRevision,
        generatedAt: identity.generatedAt,
        kind: identity.kind,
      },
      review.prepared.plan,
      review.impact.snapshot,
    ).then((applied) => {
      if (!applied) {
        setReview({ ok: false, errors: [format(locale, 'ai.request.stale')] });
        return;
      }
      setReview(null);
      setPatchText('');
      setStage('idle');
      setPrompt('');
      showToast(format(locale, 'ai.toast.applied', { count: review.changes.length }), {
        label: locale === 'ko' ? '되돌리기' : 'Undo',
        onClick: () => undo(),
      });
    });
  }

  async function cancelRequest(): Promise<void> {
    if (activeRequest)
      await updatePendingRequest({
        ...activeRequest,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
    setStage('idle');
    setPrompt('');
    setPatchText('');
    setReview(null);
  }

  async function dismissReview(): Promise<void> {
    if (review?.ok && activeRequest)
      await updatePendingRequest({
        ...activeRequest,
        status: 'waiting',
        responseFingerprint: undefined,
        error: undefined,
        updatedAt: new Date().toISOString(),
      });
    setReview(null);
  }

  const undoAvailable = undoStack.length > 0;

  return (
    <section className="ai-section" id="ai-section">
      <div className="section-head">
        <SparkleIcon width={18} height={18} />
        <h2>{locale === 'ko' ? '다시 계획하기' : 'Replan'}</h2>
      </div>
      <p className="sub-line">
        {locale === 'ko'
          ? '지금 상황을 알려주면 AI에게 보낼 요청문이 만들어져요. AI의 답안을 붙여넣으면 검토 후 적용할 수 있어요.'
          : 'Tell the app what happened and it drafts a note for your AI assistant. Paste the reply back — nothing changes until you approve it.'}
      </p>

      {liveContext?.gpsConsent && (
        <p className="hint-text">
          {locale === 'ko'
            ? '새 요청을 만들 때 현재 위치를 한 번 조회해요. 상황 수정에서 언제든 끌 수 있어요.'
            : 'Each new request looks up your location once. Turn this off in your situation settings.'}
        </p>
      )}
      {preparing && (
        <p className="hint-text" role="status">
          {locale === 'ko' ? '현재 상황을 확인하고 있어요…' : 'Checking your current context…'}
        </p>
      )}
      {liveContext?.locationAttempt && (
        <p className="hint-text" role="status">
          {locationMessage(liveContext.locationAttempt, locale)}
        </p>
      )}

      <fieldset className="ai-scope" aria-label={locale === 'ko' ? '변경 범위' : 'Change scope'}>
        <legend className="eyebrow">{locale === 'ko' ? '변경 범위' : 'Change scope'}</legend>
        <div className="chip-row wrap">
          <button
            type="button"
            className={`chip chip-btn ${scopeKind === 'next-change' ? 'chip-selected' : ''}`}
            aria-pressed={scopeKind === 'next-change'}
            onClick={() => setScopeKind('next-change')}
          >
            {locale === 'ko' ? '다음 일정' : 'Next stop'}
          </button>
          <button
            type="button"
            className={`chip chip-btn ${scopeKind === 'remaining-change' ? 'chip-selected' : ''}`}
            aria-pressed={scopeKind === 'remaining-change'}
            onClick={() => setScopeKind('remaining-change')}
          >
            {locale === 'ko' ? '남은 일정' : 'Remaining schedule'}
          </button>
        </div>
      </fieldset>

      <p className="eyebrow">{locale === 'ko' ? '1. 무슨 일이 생겼나요?' : '1. What happened?'}</p>
      <div className="chip-row wrap">
        {SITUATIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip chip-btn ${situationId === s.id ? 'chip-selected' : ''}`}
            onClick={() => choose(s.id)}
            disabled={preparing}
          >
            {format(locale, s.labelKey)}
          </button>
        ))}
      </div>
      {isCustom && (
        <div className="custom-row">
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder={
              locale === 'ko'
                ? '예: 갑자기 소개팅이 1시간 늦게 끝나요'
                : 'e.g. dinner is running an hour late'
            }
          />
          <button type="button" className="btn btn-soft" onClick={buildCustom}>
            {locale === 'ko' ? '요청문 만들기' : 'Draft the note'}
          </button>
        </div>
      )}

      {stage === 'prompted' && (
        <>
          <div className="prompt-box">
            <p className="eyebrow">
              {locale === 'ko'
                ? 'AI 요청문 — 복사해서 AI에게 보내주세요'
                : 'The note — copy it over to your AI assistant'}
            </p>
            <pre>{prompt}</pre>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  void sharePrompt().catch(() => showToast(format(locale, 'ai.request.stale')))
                }
              >
                {format(locale, 'ai.share')}
              </button>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() =>
                  void copyPrompt().catch(() => showToast(format(locale, 'ai.request.stale')))
                }
              >
                <CopyIcon width={16} height={16} />{' '}
                {locale === 'ko' ? 'AI 요청문 복사' : 'Copy the note'}
              </button>
            </div>
          </div>

          <div className="divider" />
          <p className="eyebrow">
            {locale === 'ko' ? '2. AI의 답안 붙여넣기' : '2. Paste the reply'}
          </p>
          <p className="hint-text">
            {locale === 'ko'
              ? 'AI가 답한 내용을 그대로 붙여넣으면, 변경을 먼저 보여드려요.'
              : "Paste the reply as-is — you'll preview every change first."}
          </p>
          <textarea
            className="patch-input"
            aria-label={locale === 'ko' ? 'AI 답안 붙여넣기' : 'Paste AI reply'}
            value={patchText}
            onChange={(e) => setPatchText(e.target.value)}
            rows={8}
            placeholder={
              '{\n  "type": "datepack.response",\n  "version": 2,\n  "requestId": "…",\n  "packId": "…",\n  "baseRevision": 0,\n  "contextRevision": 0,\n  "generatedAt": "2026-09-29T10:00:00.000Z",\n  "kind": "remaining-change",\n  "result": { "type": "datepack.patch", "version": 1, "operations": [] }\n}'
            }
          />
          <div className="action-row">
            <button
              type="button"
              className="btn btn-soft"
              onClick={() =>
                void checkPatch().catch(() =>
                  setReview({ ok: false, errors: [format(locale, 'ai.request.stale')] }),
                )
              }
              disabled={!patchText.trim()}
            >
              {locale === 'ko' ? '변경 내용 보기' : 'Preview changes'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                void cancelRequest().catch(() => showToast(format(locale, 'ai.request.stale')))
              }
            >
              {locale === 'ko' ? '요청 취소' : 'Cancel request'}
            </button>
          </div>

          {review?.ok && (
            <div className="review-card" aria-live="polite">
              <p className="review-head">
                {locale === 'ko'
                  ? `AI가 ${review.changes.length}개의 변경을 제안했어요`
                  : `${review.changes.length} suggested changes`}
              </p>
              <ul className="review-list">
                {review.changes.map((change, i) => (
                  <li key={i}>{changeLabel(locale, change)}</li>
                ))}
              </ul>
              <p className="hint-text">{impactMessage(review.impact, locale)}</p>
              {review.warnings.length > 0 && (
                <p className="form-warning">{review.warnings.join(' ')}</p>
              )}
              <div className="action-row">
                <button type="button" className="btn btn-primary" onClick={applyApproved}>
                  {locale === 'ko' ? '적용' : 'Apply'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    void dismissReview().catch(() => showToast(format(locale, 'ai.request.stale')))
                  }
                >
                  {locale === 'ko' ? '취소' : 'Cancel'}
                </button>
              </div>
              <p className="hint-text">
                {locale === 'ko'
                  ? '적용 전 상태는 자동 저장돼요 — 언제든 되돌릴 수 있어요.'
                  : 'The current state is saved first — undo any time.'}
              </p>
            </div>
          )}
          {review && !review.ok && (
            <div className="review-card error" role="alert">
              <p className="review-head">
                {locale === 'ko' ? 'Patch에 문제가 있어요' : "That reply won't apply"}
              </p>
              <ul className="review-list errors">
                {review.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {undoAvailable && (
        <button type="button" className="btn btn-ghost undo-btn" onClick={undo}>
          <UndoIcon width={16} height={16} />{' '}
          {locale === 'ko' ? '마지막 변경 되돌리기' : 'Undo last change'}
        </button>
      )}
    </section>
  );
}
