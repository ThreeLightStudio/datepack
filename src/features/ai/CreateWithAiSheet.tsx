import { useEffect, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { CopyIcon, SparkleIcon } from '../../components/icons';
import { buildCreatePrompt } from './createPromptBuilder';
import type { DatePlan } from '@datepack/core';
import { buildPlanFromDraft, createDatePack, parsePlanDraft, todayISO } from '@datepack/core';
import {
  applyAiPlan,
  createAiDraftPack,
  showToast,
  updatePendingRequest,
  useStore,
} from '../../store/datepackStore';
import type { PendingRequest } from '../../storage/indexedDb';
import { formatDate, format, useLocale } from '../../i18n';
import { parseAiResponse, responseFingerprint, type AiRequestIdentity } from './exchange';

type Props = { open: boolean; onClose: () => void };
type Review = { plan: DatePlan; warnings: string[] } | { errors: string[] } | null;

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function CreateWithAiSheet({ open, onClose }: Props) {
  const locale = useLocale();
  const { pack, pendingRequest, contextRevision } = useStore();
  const [region, setRegion] = useState('');
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [prompt, setPrompt] = useState('');
  const [replyText, setReplyText] = useState('');
  const [review, setReview] = useState<Review>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (
      !open ||
      pendingRequest?.kind !== 'create' ||
      pendingRequest.status === 'applied' ||
      pendingRequest.status === 'cancelled'
    )
      return;
    setPrompt(pendingRequest.input);
    setReplyText(pendingRequest.answerText ?? '');
    setReview(null);
    if (pendingRequest.status === 'review' && pendingRequest.answerText) {
      window.setTimeout(
        () =>
          void checkReply(pendingRequest.answerText, true).catch(() =>
            setReview({ errors: [format(locale, 'ai.request.stale')] }),
          ),
        0,
      );
    }
  }, [open, pendingRequest?.id]);

  const identity: AiRequestIdentity | null =
    pendingRequest?.kind === 'create' &&
    !['applied', 'cancelled'].includes(pendingRequest.status) &&
    pack?.plan.id === pendingRequest.planId
      ? {
          requestId: pendingRequest.id,
          packId: pendingRequest.planId,
          baseRevision: pendingRequest.baseRevision,
          contextRevision: pendingRequest.contextRevision,
          generatedAt: pendingRequest.generatedAt,
          kind: 'create',
        }
      : null;

  async function makePrompt(): Promise<void> {
    if (!region.trim()) {
      showToast(format(locale, 'create.err.region'));
      return;
    }
    setBusy(true);
    try {
      // The empty draft and its first request share one durable transaction.
      const draftPack = createDatePack({
        title: locale === 'ko' ? '새 데이트' : 'New date',
        ...(date ? { date } : {}),
      });
      const requestId = crypto.randomUUID();
      const generatedAt = new Date().toISOString();
      const requestIdentity: AiRequestIdentity = {
        requestId,
        packId: draftPack.plan.id,
        baseRevision: draftPack.revision,
        contextRevision: 0,
        generatedAt,
        kind: 'create',
      };
      const nextPrompt = buildCreatePrompt({
        region,
        date,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        notes: notes || undefined,
        locale,
        identity: requestIdentity,
      });
      const request: PendingRequest = {
        id: requestId,
        planId: requestIdentity.packId,
        kind: 'create',
        status: 'ready',
        input: nextPrompt,
        baseRevision: requestIdentity.baseRevision,
        contextRevision: requestIdentity.contextRevision,
        generatedAt,
        createdAt: generatedAt,
        updatedAt: generatedAt,
      };
      await createAiDraftPack(draftPack, request);
      setPrompt(nextPrompt);
      setReplyText('');
      setReview(null);
      showToast(format(locale, 'ai.prompt.ready'));
    } catch {
      showToast(
        locale === 'ko'
          ? '요청을 저장하지 못했어요. 입력을 유지했어요.'
          : 'Could not save the request. Your entries are still here.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt(): Promise<void> {
    if (!(await copyText(prompt))) {
      showToast(
        locale === 'ko'
          ? '복사하지 못했어요. 요청문을 선택해 복사해주세요.'
          : 'Copy failed. Select and copy the request note.',
      );
      return;
    }
    if (pendingRequest?.kind === 'create')
      await updatePendingRequest({
        ...pendingRequest,
        status: 'waiting',
        updatedAt: new Date().toISOString(),
      });
    showToast(format(locale, 'create.toast.copied'));
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
      if (pendingRequest?.kind === 'create')
        await updatePendingRequest({
          ...pendingRequest,
          status: 'waiting',
          updatedAt: new Date().toISOString(),
        });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (pendingRequest?.kind === 'create')
          await updatePendingRequest({
            ...pendingRequest,
            status: 'ready',
            updatedAt: new Date().toISOString(),
          });
        showToast(format(locale, 'ai.request.cancelled'));
      } else
        showToast(
          locale === 'ko'
            ? '공유를 열지 못했어요. 복사 경로를 이용해주세요.'
            : 'Could not open sharing. Use Copy request instead.',
        );
    }
  }

  async function checkReply(raw = replyText, allowPreviouslyReviewed = false): Promise<void> {
    if (!identity || !pendingRequest || !pack || busy) return;
    const fingerprint = responseFingerprint(raw);
    if (
      !allowPreviouslyReviewed &&
      pendingRequest.responseFingerprint === fingerprint &&
      pendingRequest.answerText === raw
    ) {
      setReview({ errors: [format(locale, 'ai.request.duplicate')] });
      return;
    }
    if (pack.revision !== identity.baseRevision || contextRevision !== identity.contextRevision) {
      setReview({ errors: [format(locale, 'ai.request.stale')] });
      await updatePendingRequest({
        ...pendingRequest,
        status: 'stale',
        answerText: raw,
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
            : 'create.review.error';
      const errorText = format(locale, key);
      setReview({ errors: [errorText] });
      await updatePendingRequest({
        ...pendingRequest,
        status: 'error',
        answerText: raw,
        error: errorText,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const parsed = parsePlanDraft(JSON.stringify(envelope.response.result), {
      allowEmpty: true,
      allowUndated: true,
    });
    if (!parsed.ok) {
      const errors = parsed.errors.map((issue) => format(locale, issue));
      setReview({ errors });
      await updatePendingRequest({
        ...pendingRequest,
        status: 'error',
        answerText: raw,
        responseFingerprint: fingerprint,
        error: errors.join('\n'),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const draftPack = buildPlanFromDraft(parsed.draft);
    const proposed = { ...draftPack.plan, id: identity.packId };
    await updatePendingRequest({
      ...pendingRequest,
      status: 'review',
      answerText: raw,
      responseFingerprint: fingerprint,
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    setReview({ plan: proposed, warnings: parsed.warnings.map((issue) => format(locale, issue)) });
  }

  async function applyApproved(): Promise<void> {
    if (!review || !('plan' in review) || !identity || busy) return;
    setBusy(true);
    try {
      const applied = await applyAiPlan(
        {
          id: identity.requestId,
          planId: identity.packId,
          baseRevision: identity.baseRevision,
          contextRevision: identity.contextRevision,
          generatedAt: identity.generatedAt,
          kind: identity.kind,
        },
        review.plan,
      );
      if (applied) {
        setReview(null);
        showToast(locale === 'ko' ? '새 계획을 저장했어요.' : 'Plan saved.');
        onClose();
      } else setReview({ errors: [format(locale, 'ai.request.stale')] });
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(): Promise<void> {
    if (pendingRequest?.kind === 'create')
      await updatePendingRequest({
        ...pendingRequest,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
    setReview(null);
    setReplyText('');
  }

  return (
    <Sheet open={open} onClose={onClose} title={format(locale, 'create.title')}>
      {!identity && (
        <>
          <p className="sub-line">{format(locale, 'create.btn.sub')}</p>
          <p className="eyebrow">{format(locale, 'create.step1')}</p>
          <label className="field">
            <span>{format(locale, 'create.region')}</span>
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder={format(locale, 'create.region.ph')}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>{format(locale, 'create.date')}</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="field">
              <span>{format(locale, 'create.time')}</span>
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                aria-label={locale === 'ko' ? '시작 시각' : 'Start time'}
              />
            </label>
            <label className="field">
              <span>{format(locale, 'create.time')}</span>
              <input
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                aria-label={locale === 'ko' ? '종료 시각' : 'End time'}
              />
            </label>
          </div>
          <label className="field">
            <span>{format(locale, 'create.notes')}</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              placeholder={format(locale, 'create.notes.ph')}
            />
          </label>
          <div className="action-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void makePrompt()}
              disabled={busy}
            >
              <SparkleIcon width={16} height={16} /> {format(locale, 'create.makePrompt')}
            </button>
          </div>
        </>
      )}
      {identity && (
        <>
          <div className="prompt-box">
            <p className="eyebrow">{format(locale, 'create.prompt.eyebrow')}</p>
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
                <CopyIcon width={16} height={16} /> {format(locale, 'create.prompt.copy')}
              </button>
            </div>
          </div>
          <p className="hint-text">{format(locale, 'create.prompt.hint')}</p>
          <p className="eyebrow">{format(locale, 'create.step2')}</p>
          <p className="hint-text">{format(locale, 'create.step2.hint')}</p>
          <textarea
            className="patch-input"
            value={replyText}
            onChange={(event) => {
              setReplyText(event.target.value);
              setReview(null);
            }}
            rows={8}
            aria-label={format(locale, 'create.step2')}
            placeholder={
              '{\n  "type": "datepack.response",\n  "version": 2,\n  "requestId": "…",\n  "packId": "…",\n  "baseRevision": 0,\n  "contextRevision": 0,\n  "generatedAt": "2026-09-29T10:00:00.000Z",\n  "kind": "create",\n  "result": { "type": "datepack.plan", "version": 1, "title": "...", "date": "YYYY-MM-DD", "events": [] }\n}'
            }
          />
          <div className="action-row">
            <button
              type="button"
              className="btn btn-soft"
              onClick={() =>
                void checkReply().catch(() =>
                  setReview({ errors: [format(locale, 'ai.request.stale')] }),
                )
              }
              disabled={!replyText.trim() || busy}
            >
              {format(locale, 'create.check')}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                void cancelRequest().catch(() => showToast(format(locale, 'ai.request.stale')))
              }
            >
              {format(locale, 'create.review.cancel')}
            </button>
          </div>
          {review && 'plan' in review && (
            <div className="review-card" aria-live="polite">
              <p className="review-head">
                {format(locale, 'create.review.head', {
                  title: review.plan.title,
                  date: review.plan.date
                    ? formatDate(locale, review.plan.date)
                    : locale === 'ko'
                      ? '날짜 미정'
                      : 'Date undecided',
                })}
              </p>
              <p className="hint-text">
                {format(locale, 'create.review.events', { count: review.plan.events.length })}
              </p>
              {review.plan.events.length ? (
                <ul className="review-list">
                  {review.plan.events.map((event) => (
                    <li key={event.id}>
                      {event.start} {event.title}
                      {event.placeId
                        ? ` · ${review.plan.places?.find((place) => place.id === event.placeId)?.name ?? ''}`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint-text">
                  {locale === 'ko'
                    ? '빈 계획으로 저장돼요. 나중에 일정을 추가할 수 있어요.'
                    : 'This will save an empty plan. You can add stops later.'}
                </p>
              )}
              {review.warnings.length > 0 && (
                <ul className="review-list errors">
                  {review.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              )}
              <div className="action-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void applyApproved()}
                  disabled={busy}
                >
                  {format(locale, 'create.review.apply')}
                </button>
              </div>
            </div>
          )}
          {review && 'errors' in review && (
            <div className="review-card error" role="alert">
              <p className="review-head">{format(locale, 'create.review.error')}</p>
              <ul className="review-list errors">
                {review.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() =>
                  void checkReply().catch(() =>
                    setReview({ errors: [format(locale, 'ai.request.stale')] }),
                  )
                }
                disabled={busy}
              >
                {locale === 'ko' ? '다시 확인' : 'Check again'}
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
