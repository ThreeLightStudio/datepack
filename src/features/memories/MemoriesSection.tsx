import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createAssetsFromFiles, registerAsset, type Experience } from '@datepack/core';
import {
  useStore,
  updateExperiences,
  showToast,
  updatePendingRequest,
  applyAiMemoryNote,
  getStoreState,
  markPendingRequestSent,
} from '../../store/datepackStore';
import type { PendingRequest } from '../../storage/indexedDb';
import { responseFingerprint, type AiRequestIdentity } from '../ai/exchange';
import { useLocale, formatDate } from '../../i18n';
import { AssetImage } from '../../components/AssetImage';
import { buildExperienceShareText } from './shareText';
import { copyRequestText } from '../ai/clipboard';
import { useAiForm, useAnswerSave, recoverAnswer } from '../ai/useAiDraft';
import { DraftSaveError, RequestHelp } from '../ai/RequestHelp';
import { buildMemoryPrompt, parseMemoryReply } from './aiMemory';

async function copyText(text: string): Promise<void> {
  if (!(await copyRequestText(text))) throw new Error('clipboard-unavailable');
}

export function MemoriesSection() {
  const locale = useLocale();
  const ko = locale === 'ko';
  const { pack, pendingRequest, contextRevision } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const form = useAiForm(`memory:${pack?.id ?? 'none'}`, {
    title: '',
    eventId: '',
    placeName: '',
    occurredOn: '',
    time: '',
    outcome: 'note',
    note: '',
  });
  const { title, eventId, placeName, occurredOn, time, note } = form.value;
  const outcome = form.value.outcome as Experience['outcome'];
  const setTitle = (v: string) => form.change('title', v);
  const setEventId = (v: string) => form.change('eventId', v);
  const setPlaceName = (v: string) => form.change('placeName', v);
  const setOccurredOn = (v: string) => form.change('occurredOn', v);
  const setTime = (v: string) => form.change('time', v);
  const setOutcome = (v: Experience['outcome']) => form.change('outcome', v);
  const setNote = (v: string) => form.change('note', v);
  const answerSave = useAnswerSave(pendingRequest);
  const checking = useRef(0);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [noteIds, setNoteIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
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
  const experiences = activePack.experiences;

  const updateSet = (
    setter: (value: Set<string>) => void,
    current: Set<string>,
    id: string,
    checked: boolean,
  ) => {
    const next = new Set(current);
    if (checked) next.add(id);
    else next.delete(id);
    setter(next);
  };

  const shareText = buildExperienceShareText(experiences, selectedIds, noteIds, locale);
  const resetForm = () => {
    setTitle('');
    setEventId('');
    setPlaceName('');
    setTime('');
    setOutcome('note');
    setNote('');
    setFiles([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  async function saveExperience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const created = await createAssetsFromFiles(files);
      const nextPack = structuredClone(activePack);
      const registered: Array<{ asset: (typeof nextPack.assets)[number]; blob: Blob }> = [];
      for (const item of created) {
        registered.push({ asset: registerAsset(nextPack, item.asset), blob: item.blob });
      }
      const event = nextPack.plan.events.find((item) => item.id === eventId);
      const plannedPlace = event?.placeId
        ? nextPack.plan.places?.find((item) => item.id === event.placeId)
        : undefined;
      const placeSnapshotName = placeName.trim() || plannedPlace?.name;
      const experience: Experience = {
        id: crypto.randomUUID(),
        ...(event ? { eventId: event.id } : {}),
        title: title.trim(),
        ...(placeSnapshotName
          ? {
              placeSnapshot: {
                name: placeSnapshotName,
                ...((plannedPlace?.name === placeSnapshotName && plannedPlace.mapQuery) ||
                !plannedPlace
                  ? { mapQuery: plannedPlace?.mapQuery ?? placeSnapshotName }
                  : {}),
              },
            }
          : {}),
        outcome,
        recordedAt: new Date().toISOString(),
        ...(occurredOn ? { occurredOn } : {}),
        ...(time ? { timing: { kind: 'exact', at: { dayOffset: 0, time } } } : {}),
        ...(note ? { note } : {}),
        ...(registered.length ? { assetIds: registered.map(({ asset }) => asset.id) } : {}),
        source: { kind: 'user' },
      };
      const saved = await updateExperiences(
        [...activePack.experiences, experience],
        nextPack.assets,
        registered,
        activePack.revision,
      );
      if (saved) {
        resetForm();
        showToast(ko ? '추억을 이 DatePack에 저장했어요.' : 'Memory saved to this DatePack.');
      }
    } catch (error) {
      console.error('[datepack] memory save failed', error);
      showToast(
        ko
          ? '추억을 저장하지 못했어요. 입력은 그대로 남아 있어요.'
          : 'Could not save this memory. Your draft is still here.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function copySelected() {
    if (!shareText) return;
    try {
      await copyText(shareText);
      showToast(ko ? '선택한 기록을 복사했어요.' : 'Selected memories copied.');
    } catch {
      showToast(
        ko
          ? '복사하지 못했어요. 브라우저 권한을 확인해주세요.'
          : 'Could not copy. Check your browser permissions.',
      );
    }
  }

  async function shareSelected() {
    if (!shareText) return;
    if (!navigator.share) {
      await copySelected();
      return;
    }
    try {
      await navigator.share({ title: activePack.plan.title, text: shareText });
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        showToast(
          ko
            ? '공유를 열지 못했어요. 복사를 이용해보세요.'
            : 'Could not open sharing. Try copying instead.',
        );
      }
    }
  }

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
    <section className="details-section memories-section" aria-labelledby="memories-title">
      <div className="section-head">
        <h2 id="memories-title">{ko ? '함께한 순간' : 'The moments you shared'}</h2>
      </div>
      <p className="hint-text">
        {ko
          ? '계획을 완료하지 않아도 사진과 메모를 남길 수 있어요. 방문 날짜와 기록한 시각은 따로 보관돼요.'
          : 'Save a photo or note without completing the plan. The visit date and the time you saved it are kept separately.'}
      </p>

      {form.error && <DraftSaveError retry={form.retry} />}
      <form className="form memory-form" onSubmit={(event) => void saveExperience(event)}>
        <label className="field">
          <span>{ko ? '기억할 순간' : 'What do you want to remember?'}</span>
          <input
            required
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="field-row memory-fields-row">
          <label className="field">
            <span>{ko ? '계획에서 고르기 (선택)' : 'Link to a planned stop (optional)'}</span>
            <select
              value={eventId}
              onChange={(event) => {
                setEventId(event.target.value);
                const planned = activePack.plan.events.find(
                  (item) => item.id === event.target.value,
                );
                if (planned) {
                  if (!title.trim()) setTitle(planned.title);
                  const plannedPlace = planned.placeId
                    ? activePack.plan.places?.find((item) => item.id === planned.placeId)
                    : undefined;
                  if (plannedPlace) setPlaceName(plannedPlace.name);
                }
              }}
            >
              <option value="">{ko ? '계획에 없던 순간' : 'A moment outside the plan'}</option>
              {activePack.plan.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{ko ? '기록 종류' : 'Type of memory'}</span>
            <select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as Experience['outcome'])}
            >
              <option value="note">{ko ? '순간' : 'Moment'}</option>
              <option value="completed">{ko ? '방문' : 'Visited'}</option>
              <option value="skipped">{ko ? '건너뜀' : 'Skipped'}</option>
            </select>
          </label>
        </div>
        <div className="field-row memory-fields-row">
          <label className="field">
            <span>{ko ? '방문한 날짜 (선택)' : 'Date of visit (optional)'}</span>
            <input
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{ko ? '방문 시각 (선택)' : 'Time of visit (optional)'}</span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{ko ? '장소 (선택)' : 'Place (optional)'}</span>
          <input
            maxLength={160}
            value={placeName}
            onChange={(event) => setPlaceName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{ko ? '짧은 메모 (선택)' : 'A short note (optional)'}</span>
          <textarea
            rows={2}
            maxLength={1200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="memory-photo-row">
          <button type="button" className="btn btn-soft" onClick={() => fileRef.current?.click()}>
            {ko ? '사진 고르기' : 'Choose photos'}
          </button>
          <span className="hint-text">
            {files.length
              ? ko
                ? `${files.length}장 선택됨`
                : `${files.length} selected`
              : ko
                ? '사진은 이 파일 안에 보관돼요.'
                : 'Photos stay inside this DatePack.'}
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          hidden
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        <button type="submit" className="btn btn-primary" disabled={!title.trim() || saving}>
          {saving ? (ko ? '저장 중…' : 'Saving…') : ko ? '추억 저장' : 'Save memory'}
        </button>
      </form>

      {experiences.length > 0 ? (
        <>
          <fieldset className="memory-list">
            <legend>{ko ? '공유할 기록 선택' : 'Choose memories to share'}</legend>
            {experiences.map((experience) => {
              const date = experience.occurredOn
                ? formatDate(locale, experience.occurredOn)
                : ko
                  ? '날짜 미상'
                  : 'Date unknown';
              const recorded = new Intl.DateTimeFormat(ko ? 'ko-KR' : 'en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(experience.recordedAt));
              const checked = selectedIds.has(experience.id);
              const noteChecked = noteIds.has(experience.id);
              return (
                <article
                  className="memory-card"
                  key={experience.id}
                  id={`memory-${experience.id}`}
                  tabIndex={-1}
                >
                  <label className="memory-select">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        updateSet(setSelectedIds, selectedIds, experience.id, event.target.checked)
                      }
                    />
                    <span>
                      <strong>{experience.title}</strong>
                      <span className="memory-kind">
                        {experience.outcome === 'completed'
                          ? ko
                            ? '방문'
                            : 'Visited'
                          : experience.outcome === 'skipped'
                            ? ko
                              ? '건너뜀'
                              : 'Skipped'
                            : ko
                              ? '순간'
                              : 'Moment'}
                      </span>
                      <span className="memory-meta">
                        {experience.placeSnapshot?.name
                          ? `${experience.placeSnapshot.name} · `
                          : ''}
                        {date}
                        {experience.timing?.kind === 'exact'
                          ? ` · ${experience.timing.at.time}`
                          : ` · ${ko ? '방문 시각 미상' : 'time not recorded'}`}
                      </span>
                    </span>
                  </label>
                  {experience.note && (
                    <label className="memory-note-share">
                      <input
                        type="checkbox"
                        checked={noteChecked}
                        disabled={!checked}
                        onChange={(event) =>
                          updateSet(setNoteIds, noteIds, experience.id, event.target.checked)
                        }
                      />
                      {ko ? '공유 텍스트에 메모 포함' : 'Include note in shared text'}
                    </label>
                  )}
                  <p className="memory-recorded">
                    {ko ? '기록한 시각' : 'Recorded'} · {recorded}
                  </p>
                  {experience.note && (
                    <p className="memory-note">
                      {experience.editedNote && (
                        <>
                          <strong>{ko ? '원문 — 그대로 보존' : 'Original — kept unchanged'}</strong>
                          <br />
                        </>
                      )}
                      {experience.note}
                    </p>
                  )}
                  {experience.editedNote && (
                    <p className="memory-note">
                      <strong>{ko ? '확인해 저장한 문장' : 'Reviewed wording'}</strong>
                      <br />
                      {experience.editedNote}
                    </p>
                  )}
                  {experience.note && (
                    <div className="memory-ai-actions">
                      <button
                        type="button"
                        className="btn btn-soft"
                        onClick={() => void startMemoryEdit(experience)}
                      >
                        {ko ? 'AI로 문장 다듬기' : 'Polish text with AI'}
                      </button>
                    </div>
                  )}
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
                          <summary>
                            {ko ? 'AI에 보낼 요청문 보기' : 'Review the request sent to AI'}
                          </summary>
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
                              !aiReply.trim() ||
                              pendingRequest.answerText !== aiReply ||
                              answerSave.error
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
                        {answerSave.error && (
                          <DraftSaveError retry={() => answerSave.retry(aiReply)} />
                        )}
                        {aiReview && 'editedText' in aiReview && (
                          <div className="review-card" aria-live="polite">
                            <p className="review-head">
                              {ko ? '저장 전 확인' : 'Review before saving'}
                            </p>
                            <p className="eyebrow">
                              {ko ? '원문 — 그대로 보존' : 'Original — kept unchanged'}
                            </p>
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
                              disabled={
                                aiBusy || answerSave.error || pendingRequest.status !== 'review'
                              }
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
                  {experience.assetIds?.length ? (
                    <div className="memory-photos" aria-label={ko ? '추억 사진' : 'Memory photos'}>
                      {experience.assetIds.map((assetId) => (
                        <AssetImage
                          key={assetId}
                          packId={pack.id}
                          assetId={assetId}
                          className="memory-photo"
                          alt={ko ? `${experience.title} 사진` : `Photo for ${experience.title}`}
                        />
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </fieldset>
          <div className="action-row memory-share-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!shareText}
              onClick={() => void copySelected()}
            >
              {ko ? '선택한 기록 복사' : 'Copy selected'}
            </button>
            <button
              type="button"
              className="btn btn-soft"
              disabled={!shareText}
              onClick={() => void shareSelected()}
            >
              {ko ? '공유…' : 'Share…'}
            </button>
          </div>
          <p className="hint-text">
            {ko
              ? '공유되는 텍스트는 보관본을 바꾸지 않아요. 사진은 공유에 첨부되지 않고 DatePack 파일에 남아요.'
              : 'Sharing creates a separate text copy and never changes your archive. Photos stay in the DatePack and are not attached.'}
          </p>
        </>
      ) : (
        <p className="memory-empty">{ko ? '아직 남긴 추억이 없어요.' : 'No memories saved yet.'}</p>
      )}
    </section>
  );
}
