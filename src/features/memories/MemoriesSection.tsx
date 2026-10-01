import { useEffect, useRef, useState } from 'react';
import type { Experience } from '@datepack/core';
import {
  useStore,
  showToast,
  updatePendingRequest,
  applyAiMemoryNote,
  getStoreState,
  markPendingRequestSent,
} from '../../store/datepackStore';
import type { PendingRequest } from '../../storage/indexedDb';
import { responseFingerprint, type AiRequestIdentity } from '../ai/exchange';
import { useLocale } from '../../i18n';
import { copyRequestText } from '../ai/clipboard';
import { useAnswerSave, recoverAnswer } from '../ai/useAiDraft';
import { DraftSaveError, RequestHelp } from '../ai/RequestHelp';
import { buildMemoryPrompt, parseMemoryReply } from './aiMemory';
async function copyText(text: string): Promise<void> {
  if (!(await copyRequestText(text))) throw new Error('clipboard-unavailable');
}

/** AI wording tools opened from a record; U03 owns the full task-screen shell. */
export function MemoriesSection({ experience }: { experience: Experience }) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const { document: pack, pendingRequest, contextRevision } = useStore();
  const answerSave = useAnswerSave(pendingRequest);
  const checking = useRef(0);
  const [aiTargetId, setAiTargetId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiReply, setAiReply] = useState('');
  const [aiReview, setAiReview] = useState<
    { experienceId: string; originalText: string; editedText: string } | { error: string } | null
  >(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    const payload = pendingRequest?.payload as
      | { experienceId?: unknown; originalText?: unknown }
      | undefined;
    if (
      pendingRequest?.kind !== 'memory-edit' ||
      pendingRequest.planId !== pack?.id ||
      ['applied', 'cancelled'].includes(pendingRequest.status) ||
      typeof payload?.experienceId !== 'string'
    )
      return;
    setAiTargetId(payload.experienceId);
    setAiPrompt(pendingRequest.input);
    setAiReply(recoverAnswer(pendingRequest));
    setAiReview(null);
  }, [pendingRequest?.id, pack?.id]);

  useEffect(() => {
    if (
      pendingRequest?.kind !== 'memory-edit' ||
      !pendingRequest.answerText ||
      recoverAnswer(pendingRequest) !== pendingRequest.answerText ||
      ['applied', 'cancelled'].includes(pendingRequest.status)
    )
      return;
    const token = ++checking.current;
    const timer = window.setTimeout(
      () => {
        void reviewAiReply(
          pendingRequest.answerText,
          pendingRequest.status !== 'draft',
          token,
        ).catch(() => {
          if (checking.current === token)
            setAiReview({
              error: ko
                ? '검토 상태를 저장하지 못했어요. 답안을 유지했어요. 다시 확인해주세요.'
                : 'Could not save the review. Your reply is kept. Check again.',
            });
        });
      },
      pendingRequest.status === 'draft' ? 400 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      checking.current++;
    };
  }, [
    pendingRequest?.id,
    pendingRequest?.answerText,
    pendingRequest?.status,
    pack?.revision,
    contextRevision,
    locale,
    aiTargetId,
  ]);

  if (!pack) return null;
  const activePack = pack;
  async function startMemoryEdit(experience: Experience): Promise<void> {
    if (!experience.note?.trim() || !activePack) return;
    if (pendingRequest && !['applied', 'cancelled', 'stale'].includes(pendingRequest.status)) {
      showToast(
        ko
          ? '진행 중인 요청을 먼저 마치거나 취소해주세요.'
          : 'Finish or cancel the current request first.',
      );
      return;
    }
    const id = crypto.randomUUID();
    const generatedAt = new Date().toISOString();
    const identity: AiRequestIdentity = {
      requestId: id,
      packId: activePack.id,
      baseRevision: activePack.revision,
      contextRevision,
      generatedAt,
      kind: 'memory-edit',
    };
    const prompt = buildMemoryPrompt(experience, identity, locale);
    const request: PendingRequest = {
      id,
      planId: identity.packId,
      kind: 'memory-edit',
      status: 'ready',
      input: prompt,
      baseRevision: identity.baseRevision,
      contextRevision: identity.contextRevision,
      generatedAt,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      payload: {
        experienceId: experience.id,
        originalText: experience.note,
        title: experience.title,
      },
    };
    try {
      await updatePendingRequest(request);
      setAiTargetId(experience.id);
      setAiPrompt(prompt);
      setAiReply('');
      setAiReview(null);
    } catch {
      showToast(
        ko
          ? '요청을 저장하지 못했어요. 원문은 그대로예요.'
          : 'Could not save the request. The original is unchanged.',
      );
    }
  }

  async function copyAiPrompt(): Promise<void> {
    try {
      await copyText(aiPrompt);
    } catch {
      showToast(
        ko
          ? '복사하지 못했어요. 요청문을 선택해 복사해주세요.'
          : 'Copy failed. Select and copy the request note.',
      );
      return;
    }
    if (pendingRequest?.kind === 'memory-edit') await markPendingRequestSent(pendingRequest.id);
    showToast(ko ? '기록 정리 요청을 복사했어요.' : 'Memory edit request copied.');
  }

  async function shareAiPrompt(): Promise<void> {
    if (!navigator.share) {
      await copyAiPrompt();
      return;
    }
    try {
      await navigator.share({
        title: ko ? 'DatePack 기록 정리' : 'DatePack memory edit',
        text: aiPrompt,
      });
      if (pendingRequest?.kind === 'memory-edit') await markPendingRequestSent(pendingRequest.id);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        showToast(
          ko
            ? '공유를 취소했어요. 복사해 직접 붙여넣을 수 있어요.'
            : 'Sharing was cancelled. You can copy the request and paste it yourself.',
        );
      } else
        showToast(
          ko
            ? '공유를 열지 못했어요. 복사 경로를 이용해주세요.'
            : 'Could not open sharing. Use Copy request instead.',
        );
    }
  }

  async function reviewAiReply(
    raw = aiReply,
    restoring = false,
    token = ++checking.current,
  ): Promise<void> {
    if (
      !pendingRequest ||
      pendingRequest.kind !== 'memory-edit' ||
      !activePack ||
      !aiTargetId ||
      !raw.trim()
    )
      return;
    const identity: AiRequestIdentity = {
      requestId: pendingRequest.id,
      packId: pendingRequest.planId,
      baseRevision: pendingRequest.baseRevision,
      contextRevision: pendingRequest.contextRevision,
      generatedAt: pendingRequest.generatedAt,
      kind: pendingRequest.kind,
    };
    const fingerprint = responseFingerprint(raw);
    const payload = pendingRequest.payload as
      | { experienceId?: unknown; originalText?: unknown }
      | undefined;
    const fail = async (message: string, status: PendingRequest['status'] = 'error') => {
      setAiReview({ error: message });
      try {
        if (!restoring)
          await updatePendingRequest(
            {
              ...pendingRequest,
              status,
              answerText: raw,
              responseFingerprint: fingerprint,
              error: message,
              updatedAt: new Date().toISOString(),
            },
            pendingRequest,
          );
      } catch {
        showToast(
          ko
            ? '요청 상태가 달라졌어요. 최신 화면에서 다시 확인해주세요.'
            : 'The request changed. Check the latest state and try again.',
        );
      }
    };
    if (
      activePack.revision !== identity.baseRevision ||
      contextRevision !== identity.contextRevision
    ) {
      await fail(
        ko
          ? '요청 뒤 계획이나 현재 상황이 바뀌었어요. 새 요청을 만들어주세요.'
          : 'The plan or current situation changed. Start a new request.',
        'stale',
      );
      return;
    }
    const experience = activePack.experiences.find((item) => item.id === aiTargetId);
    const parsed = parseMemoryReply(raw, identity, experience, payload?.originalText);
    if (!parsed.ok) {
      await fail(
        parsed.reason === 'mismatch'
          ? ko
            ? '다른 요청이나 기록의 답안이에요.'
            : 'This reply belongs to another request or memory.'
          : parsed.reason === 'stale'
            ? ko
              ? '원문이 요청 이후 바뀌었어요. 새 요청을 만들어주세요.'
              : 'The original text changed. Start a new request.'
            : ko
              ? '요청문의 결과 형식으로 다시 답해주세요. 경험 ID와 다듬은 문장만 필요해요.'
              : 'Use the result format from the request: only the memory id and edited wording.',
        parsed.reason === 'stale' ? 'stale' : 'error',
      );
      return;
    }
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
    setAiReview({
      experienceId: parsed.experienceId,
      originalText: parsed.originalText,
      editedText: parsed.editedText,
    });
  }

  async function applyAiReply(): Promise<void> {
    if (
      !aiReview ||
      'error' in aiReview ||
      !pendingRequest ||
      aiBusy ||
      answerSave.error ||
      getStoreState().pendingRequest?.answerText !== aiReply ||
      getStoreState().pendingRequest?.status !== 'review'
    )
      return;
    setAiBusy(true);
    try {
      const saved = await applyAiMemoryNote(
        {
          id: pendingRequest.id,
          planId: pendingRequest.planId,
          baseRevision: pendingRequest.baseRevision,
          contextRevision: pendingRequest.contextRevision,
          generatedAt: pendingRequest.generatedAt,
          kind: 'memory-edit',
        },
        aiReview.experienceId,
        aiReview.editedText,
      );
      if (saved) {
        setAiReview(null);
        setAiReply('');
        showToast(
          ko
            ? '다듬은 문장을 원문과 함께 저장했어요.'
            : 'Edited wording saved alongside the original.',
        );
      } else
        setAiReview({
          error: ko
            ? '저장하지 못했어요. 답안을 유지했어요. 현재 상태를 다시 확인한 뒤 저장을 시도해주세요.'
            : 'Could not save. Your reply is kept. Review the current state and try saving again.',
        });
    } finally {
      setAiBusy(false);
    }
  }

  async function cancelAiEdit(): Promise<void> {
    if (pendingRequest?.kind === 'memory-edit')
      await updatePendingRequest({
        ...pendingRequest,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
    setAiReview(null);
    setAiTargetId(null);
    setAiReply('');
    setAiPrompt('');
  }
  return (
    <section className="memory-ai-task">
      <h2>{ko ? 'AI로 문장 다듬기' : 'Polish text with AI'}</h2>
      <p className="memory-note">{experience.note}</p>
      <button
        type="button"
        className="btn btn-soft"
        disabled={!experience.note?.trim()}
        onClick={() => void startMemoryEdit(experience)}
      >
        {ko ? '새 다듬기 요청 만들기' : 'Create wording request'}
      </button>
      {aiTargetId === experience.id &&
        aiPrompt &&
        pendingRequest?.kind === 'memory-edit' &&
        !['applied', 'cancelled'].includes(pendingRequest.status) && (
          <div
            className="memory-ai-editor"
            id={`ai-memory-${experience.id}`}
            tabIndex={-1}
            aria-label={ko ? 'AI 기록 문장 정리' : 'AI memory wording review'}
          >
            <RequestHelp purpose="memory" />
            <p className="hint-text">
              {ko
                ? '보내는 내용은 이 기록의 제목과 메모뿐이에요. 사진과 계획은 포함하지 않아요.'
                : 'Only this memory title and note are included. Photos and the plan are not sent.'}
            </p>
            <details>
              <summary>{ko ? 'AI에 보낼 요청문 보기' : 'Review the request sent to AI'}</summary>
              <pre className="memory-ai-prompt">{aiPrompt}</pre>
            </details>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  void shareAiPrompt().catch(() =>
                    showToast(ko ? '요청 상태가 달라졌어요.' : 'The request changed.'),
                  )
                }
              >
                {ko ? '요청문 공유' : 'Share request'}
              </button>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() =>
                  void copyAiPrompt().catch(() =>
                    showToast(ko ? '요청 상태가 달라졌어요.' : 'The request changed.'),
                  )
                }
              >
                {ko ? '요청문 복사' : 'Copy request'}
              </button>
            </div>
            <label className="field">
              <span>{ko ? 'AI 답안 붙여넣기' : 'Paste AI reply'}</span>
              <textarea
                rows={6}
                value={aiReply}
                onChange={(event) => {
                  checking.current++;
                  setAiReply(event.target.value);
                  setAiReview(null);
                  answerSave.save(event.target.value);
                }}
              />
            </label>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-soft"
                disabled={
                  !aiReply.trim() || pendingRequest.answerText !== aiReply || answerSave.error
                }
                onClick={() =>
                  void reviewAiReply().catch(() =>
                    showToast(ko ? '요청 상태가 달라졌어요.' : 'The request changed.'),
                  )
                }
              >
                {ko ? '다듬은 문장 검토' : 'Review wording'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void cancelAiEdit().catch(() =>
                    showToast(ko ? '요청 상태가 달라졌어요.' : 'The request changed.'),
                  )
                }
              >
                {ko ? '요청 취소' : 'Cancel request'}
              </button>
            </div>
            {answerSave.error && <DraftSaveError retry={() => answerSave.retry(aiReply)} />}
            {aiReview && 'editedText' in aiReview && (
              <div className="review-card" aria-live="polite">
                <p className="review-head">{ko ? '저장 전 확인' : 'Review before saving'}</p>
                <p className="eyebrow">{ko ? '원문 — 그대로 보존' : 'Original — kept unchanged'}</p>
                <p className="memory-note">{aiReview.originalText}</p>
                <p className="eyebrow">{ko ? '다듬은 문장' : 'Edited wording'}</p>
                <p className="memory-note">{aiReview.editedText}</p>
                <p className="hint-text">
                  {ko
                    ? '사실이 달라지지 않았는지 확인하세요. 적용해도 원문은 그대로 남아요.'
                    : 'Check the facts. Applying this keeps the original text as well.'}
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={aiBusy || answerSave.error || pendingRequest.status !== 'review'}
                  onClick={() => void applyAiReply()}
                >
                  {ko ? '원문과 함께 저장' : 'Save alongside original'}
                </button>
              </div>
            )}
            {aiReview && 'error' in aiReview && (
              <div className="form-warning" role="alert">
                <p>{aiReview.error}</p>
                <RequestHelp correction purpose="memory" />
              </div>
            )}
          </div>
        )}
    </section>
  );
}
