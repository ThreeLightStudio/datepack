import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { CopyIcon, SparkleIcon } from '../../components/icons';
import { buildCreatePrompt } from './createPromptBuilder';
import type { DatePlan } from '@datepack/core';
import {
  buildPlanFromDraft,
  createDatePack,
  parsePlanDraft,
  extractJsonObject,
} from '@datepack/core';
import {
  applyAiPlan,
  getStoreState,
  markPendingRequestSent,
  createAiDraftPack,
  showToast,
  updatePendingRequest,
  useStore,
} from '../../store/datepackStore';
import type { PendingRequest } from '../../storage/indexedDb';
import { formatDate, format, useLocale } from '../../i18n';
import {
  parseAiResponse,
  responseFingerprint,
  responseContract,
  type AiRequestIdentity,
} from './exchange';
import { useAiForm, useAnswerSave, recoverAnswer } from './useAiDraft';
import { DraftSaveError, RequestHelp } from './RequestHelp';
import { copyRequestText } from './clipboard';
import { timingLabel } from './timingPresentation';

type Props = { open: boolean; onClose: () => void };
type Review = { plan: DatePlan; warnings: string[] } | { errors: string[] } | null;

export function CreateWithAiSheet({ open, onClose }: Props) {
  const locale = useLocale();
  const { pack, pendingRequest, contextRevision } = useStore();
  const form = useAiForm('create', {
    region: '',
    date: '',
    startTime: '',
    endTime: '',
    notes: '',
    importText: '',
    mode: 'request',
  });
  const { region, date, startTime, endTime, notes } = form.value;
  const setRegion = (v: string) => form.change('region', v);
  const setDate = (v: string) => form.change('date', v);
  const setStartTime = (v: string) => form.change('startTime', v);
  const setEndTime = (v: string) => form.change('endTime', v);
  const setNotes = (v: string) => form.change('notes', v);
  const answerSave = useAnswerSave(pendingRequest?.kind === 'create' ? pendingRequest : null);
  const checking = useRef(0);
  const [prompt, setPrompt] = useState('');
  const [replyText, setReplyText] = useState('');
  const [review, setReview] = useState<Review>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReview(null);
    if (
      pendingRequest?.kind !== 'create' ||
      ['applied', 'cancelled'].includes(pendingRequest.status)
    ) {
      setPrompt('');
      setReplyText('');
      return;
    }
    setPrompt(pendingRequest.input);
    setReplyText(recoverAnswer(pendingRequest));
    setReview(null);
  }, [open, pendingRequest?.id]);

  useEffect(() => {
    if (
      !open ||
      pendingRequest?.kind !== 'create' ||
      !pendingRequest.answerText ||
      recoverAnswer(pendingRequest) !== pendingRequest.answerText ||
      ['applied', 'cancelled'].includes(pendingRequest.status)
    )
      return;
    const token = ++checking.current;
    const timer = window.setTimeout(
      () => {
        void checkReply(pendingRequest.answerText, pendingRequest.status !== 'draft', token).catch(
          () => {
            if (checking.current === token)
              setReview({
                errors: [
                  locale === 'ko'
                    ? '검토 상태를 저장하지 못했어요. 답안을 유지했어요. 다시 확인해주세요.'
                    : 'Could not save the review. Your reply is kept. Check again.',
                ],
              });
          },
        );
      },
      pendingRequest.status === 'draft' ? 400 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      checking.current++;
    };
  }, [
    open,
    pendingRequest?.id,
    pendingRequest?.answerText,
    pendingRequest?.status,
    pack?.revision,
    contextRevision,
    locale,
  ]);

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
    if (!(await copyRequestText(prompt))) {
      showToast(
        locale === 'ko'
          ? '복사하지 못했어요. 요청문을 선택해 복사해주세요.'
          : 'Copy failed. Select and copy the request note.',
      );
      return;
    }
    if (pendingRequest?.kind === 'create') await markPendingRequestSent(pendingRequest.id);
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
      if (pendingRequest?.kind === 'create') await markPendingRequestSent(pendingRequest.id);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        showToast(format(locale, 'ai.request.cancelled'));
      } else
        showToast(
          locale === 'ko'
            ? '공유를 열지 못했어요. 복사 경로를 이용해주세요.'
            : 'Could not open sharing. Use Copy request instead.',
        );
    }
  }

  async function checkReply(
    raw = replyText,
    restoring = false,
    token = ++checking.current,
  ): Promise<void> {
    if (!identity || !pendingRequest || !pack || busy) return;
    const fingerprint = responseFingerprint(raw);
    if (pack.revision !== identity.baseRevision || contextRevision !== identity.contextRevision) {
      setReview({ errors: [format(locale, 'ai.request.stale')] });
      if (!restoring)
        await updatePendingRequest(
          {
            ...pendingRequest,
            status: 'stale',
            answerText: raw,
            updatedAt: new Date().toISOString(),
          },
          pendingRequest,
        );
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
      if (!restoring)
        await updatePendingRequest(
          {
            ...pendingRequest,
            status: 'error',
            answerText: raw,
            error: errorText,
            updatedAt: new Date().toISOString(),
          },
          pendingRequest,
        );
      return;
    }
    const parsed = parsePlanDraft(JSON.stringify(envelope.response.result), {
      allowEmpty: true,
      allowUndated: true,
    });
    if (!parsed.ok) {
      const errors = parsed.errors.map((issue) => format(locale, issue));
      setReview({ errors });
      if (!restoring)
        await updatePendingRequest(
          {
            ...pendingRequest,
            status: 'error',
            answerText: raw,
            responseFingerprint: fingerprint,
            error: errors.join('\n'),
            updatedAt: new Date().toISOString(),
          },
          pendingRequest,
        );
      return;
    }
    const draftPack = buildPlanFromDraft(parsed.draft);
    const proposed = { ...draftPack.plan, id: identity.packId };
    if (!restoring)
      await updatePendingRequest(
        {
          ...pendingRequest,
          status: 'review',
          answerText: raw,
          responseFingerprint: fingerprint,
          error: undefined,
          updatedAt: new Date().toISOString(),
        },
        pendingRequest,
      );
    if (checking.current !== token) return;
    setReview({ plan: proposed, warnings: parsed.warnings.map((issue) => format(locale, issue)) });
  }

  async function applyApproved(): Promise<void> {
    if (!review || !('plan' in review) || busy || answerSave.error) return;
    if (!identity) {
      if (form.value.mode !== 'import') return;
      await applyImported();
      return;
    }
    if (
      getStoreState().pendingRequest?.answerText !== replyText ||
      getStoreState().pendingRequest?.status !== 'review'
    )
      return;
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
      } else
        setReview({
          errors: [
            locale === 'ko'
              ? '적용하지 못했어요. 답안을 유지했어요. 현재 상태를 다시 확인한 뒤 시도해주세요.'
              : 'Could not apply. Your reply is kept. Review the current state and try again.',
          ],
        });
    } finally {
      setBusy(false);
    }
  }

  function reviewImported(): void {
    const parsed = parsePlanDraft(form.value.importText, { allowEmpty: true, allowUndated: true });
    setReview(
      parsed.ok
        ? {
            plan: buildPlanFromDraft(parsed.draft).plan,
            warnings: parsed.warnings.map((issue) => format(locale, issue)),
          }
        : { errors: parsed.errors.map((issue) => format(locale, issue)) },
    );
  }

  async function applyImported(): Promise<void> {
    if (!review || !('plan' in review)) return;
    setBusy(true);
    try {
      // An existing plan draft is a new local import, never an answer to a prior request.
      const blank = createDatePack({
        title: review.plan.title,
        ...(review.plan.date ? { date: review.plan.date } : {}),
      });
      const id = crypto.randomUUID();
      const stamp = new Date().toISOString();
      const localIdentity: AiRequestIdentity = {
        requestId: id,
        packId: blank.plan.id,
        baseRevision: 0,
        contextRevision: 0,
        generatedAt: stamp,
        kind: 'create',
      };
      const result = parsePlanDraft(form.value.importText, {
        allowEmpty: true,
        allowUndated: true,
      });
      if (!result.ok) return;
      const request: PendingRequest = {
        id,
        planId: blank.plan.id,
        kind: 'create',
        status: 'ready',
        input:
          locale === 'ko'
            ? '기존 AI 계획 가져오기 · 이 기기에서 새로 확인한 초안'
            : 'Imported AI plan · newly reviewed on this device',
        baseRevision: 0,
        contextRevision: 0,
        generatedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      };
      // Use the original portable result shape so recovery uses the same parser.
      const importedRaw = responseContract(localIdentity, extractJsonObject(form.value.importText));
      await createAiDraftPack(blank, request);
      await updatePendingRequest({
        ...request,
        status: 'review',
        answerText: importedRaw,
        responseFingerprint: responseFingerprint(importedRaw),
      });
      const proposed = { ...review.plan, id: blank.plan.id };
      if (await applyAiPlan({ ...request }, proposed)) {
        setReview(null);
        onClose();
      } else
        setReview({
          errors: [
            locale === 'ko'
              ? '저장하지 못했어요. 초안에서 다시 확인해주세요.'
              : 'Could not save. Review the preserved draft again.',
          ],
        });
    } catch {
      showToast(
        locale === 'ko'
          ? '가져오기를 저장하지 못했어요. 입력을 유지했어요.'
          : 'Could not save the import. Your input is kept.',
      );
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
      {!identity && form.value.mode !== 'import' && (
        <>
          <p className="sub-line">{format(locale, 'create.btn.sub')}</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              form.change('mode', 'import');
              setReview(null);
            }}
          >
            {locale === 'ko' ? '이미 만든 AI 계획 가져오기' : 'Import an existing AI plan'}
          </button>
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
              <span>
                {format(locale, 'create.date')} ({locale === 'ko' ? '선택' : 'optional'})
              </span>
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
      {!identity && form.value.mode === 'import' && (
        <>
          <p className="hint-text">
            {locale === 'ko'
              ? 'datepack.plan 형식의 기존 계획을 새 데이트로 가져와요. 현재 데이트는 따로 보관돼요. 요청에 대한 답안은 해당 요청에서 확인하세요.'
              : 'Import a datepack.plan draft as a new date. Your current date stays saved separately. Review request replies in their original request.'}
          </p>
          <label className="field">
            <span>{locale === 'ko' ? '기존 AI 계획' : 'Existing AI plan'}</span>
            <textarea
              rows={8}
              value={form.value.importText}
              onChange={(e) => {
                form.change('importText', e.target.value);
                setReview(null);
              }}
            />
          </label>
          <div className="action-row">
            <button
              type="button"
              className="btn btn-soft"
              onClick={reviewImported}
              disabled={busy || !form.value.importText.trim()}
            >
              {locale === 'ko' ? '가져올 계획 확인' : 'Review imported plan'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                form.change('mode', 'request');
                setReview(null);
              }}
            >
              {locale === 'ko' ? '새 요청 작성' : 'Write a new request'}
            </button>
          </div>
        </>
      )}
      {form.error && <DraftSaveError retry={form.retry} />}
      {identity && (
        <>
          <RequestHelp />
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
              checking.current++;
              setReplyText(event.target.value);
              setReview(null);
              answerSave.save(event.target.value);
            }}
            rows={8}
            aria-label={format(locale, 'create.step2')}
            placeholder={
              '{\n  "type": "datepack.response",\n  "version": 2,\n  "requestId": "…",\n  "packId": "…",\n  "baseRevision": 0,\n  "contextRevision": 0,\n  "generatedAt": "2026-09-29T10:00:00.000Z",\n  "kind": "create",\n  "result": { "type": "datepack.plan", "version": 1, "title": "...", "date": "YYYY-MM-DD", "events": [] }\n}'
            }
          />
          {answerSave.error && <DraftSaveError retry={() => answerSave.retry(replyText)} />}
          <div className="action-row">
            <button
              type="button"
              className="btn btn-soft"
              onClick={() =>
                void checkReply().catch(() =>
                  setReview({ errors: [format(locale, 'ai.request.stale')] }),
                )
              }
              disabled={
                !replyText.trim() ||
                busy ||
                pendingRequest?.answerText !== replyText ||
                answerSave.error
              }
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
        </>
      )}
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
                  {timingLabel(event.timing, locale)} {event.title}
                  {event.placeId
                    ? ` · ${review.plan.places?.find((place) => place.id === event.placeId)?.name ?? ''}`
                    : ''}
                  {event.estimatedDurationMinutes !== undefined
                    ? ` · ${locale === 'ko' ? '체류' : 'stay'} ${event.estimatedDurationMinutes} ${locale === 'ko' ? '분' : 'min'}`
                    : ''}
                  {event.protectedFields?.length
                    ? ` · ${locale === 'ko' ? '고정' : 'Protected'}: ${event.protectedFields.map((field) => ({ time: locale === 'ko' ? '시간' : 'time', place: locale === 'ko' ? '장소' : 'place', content: locale === 'ko' ? '내용' : 'content', delete: locale === 'ko' ? '삭제' : 'delete', order: locale === 'ko' ? '순서' : 'order' })[field]).join(' / ')}`
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
              onClick={() =>
                void applyApproved().catch(() =>
                  showToast(
                    locale === 'ko'
                      ? '저장하지 못했어요. 답안을 유지했어요.'
                      : 'Could not save. Your reply is kept.',
                  ),
                )
              }
              disabled={
                busy ||
                answerSave.error ||
                (Boolean(identity) && pendingRequest?.status !== 'review')
              }
            >
              {format(locale, 'create.review.apply')}
            </button>
          </div>
        </div>
      )}
      {review && 'errors' in review && (
        <div className="review-card error" role="alert">
          <p className="review-head">{format(locale, 'create.review.error')}</p>
          <RequestHelp correction />
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
    </Sheet>
  );
}
