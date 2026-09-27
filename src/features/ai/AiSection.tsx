import { useState } from 'react';
import type { DatePackRuntimeState, DatePlan } from '../../datepack/types';
import { buildAiPrompt, SITUATIONS } from './promptBuilder';
import {
  describePatch,
  parsePatch,
  type PatchChange,
  type PatchChangeDetail,
} from '../../datepack/patch';
import { applyPatchWithUndo, showToast, undo, useStore } from '../../store/datepackStore';
import { CopyIcon, SparkleIcon, UndoIcon } from '../../components/icons';
import { eventTypeLabel, format, useLocale } from '../../i18n';

type Props = { plan: DatePlan; runtime: DatePackRuntimeState | null };

type Stage = 'idle' | 'prompted';

function detailLabel(locale: 'ko' | 'en', d: PatchChangeDetail): string {
  switch (d.field) {
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
  switch (change.op) {
    case 'move':
      return format(locale, 'change.move', {
        title: change.title,
        from: change.from ?? '',
        to: change.to ?? '',
      });
    case 'remove':
      return format(locale, 'change.remove', { title: change.title });
    case 'insertBefore':
      return format(locale, 'change.insertBefore', {
        title: change.title,
        newTitle: change.newTitle,
        time: change.newStart,
      });
    case 'insertAfter':
      return format(locale, 'change.insertAfter', {
        title: change.title,
        newTitle: change.newTitle,
        time: change.newStart,
      });
    case 'replace':
      return format(locale, 'change.replace', {
        title: change.title,
        details: change.details.map((d) => detailLabel(locale, d)).join(', '),
      });
  }
}

export function AiSection({ plan, runtime }: Props) {
  const locale = useLocale();
  const { undoStack } = useStore();
  const [stage, setStage] = useState<Stage>('idle');
  const [situationId, setSituationId] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState('');
  const [prompt, setPrompt] = useState('');
  const [patchText, setPatchText] = useState('');
  const [review, setReview] = useState<
    | { ok: true; changes: PatchChange[]; warnings: string[]; patchJson: string }
    | { ok: false; errors: string[] }
    | null
  >(null);

  const isCustom = situationId === 'custom';

  function choose(id: string): void {
    setSituationId(id);
    if (id !== 'custom') {
      setPrompt(buildAiPrompt({ plan, runtime, situationId: id, locale }));
      setStage('prompted');
    }
  }

  function buildCustom(): void {
    if (!customInput.trim()) {
      showToast(
        locale === 'ko' ? '상황을 한 줄 입력해주세요.' : 'Describe what happened in a line.',
      );
      return;
    }
    setPrompt(buildAiPrompt({ plan, runtime, situationId: 'custom', customInput, locale }));
    setStage('prompted');
  }

  async function copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const area = document.createElement('textarea');
      area.value = prompt;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    showToast(locale === 'ko' ? 'AI 요청문을 복사했어요.' : 'Note copied.');
  }

  function checkPatch(): void {
    const parsed = parsePatch(patchText);
    if (!parsed.ok) {
      setReview({ ok: false, errors: parsed.errors.map((e) => format(locale, e)) });
      return;
    }
    const outcome = describePatch(plan, parsed.patch);
    if (outcome.errors.length > 0) {
      setReview({ ok: false, errors: outcome.errors.map((e) => format(locale, e)) });
      return;
    }
    setReview({
      ok: true,
      changes: outcome.applied,
      warnings: parsed.warnings.map((w) => format(locale, w)),
      patchJson: patchText,
    });
  }

  function applyApproved(): void {
    if (!review?.ok) return;
    const parsed = parsePatch(review.patchJson);
    if (!parsed.ok) {
      setReview({ ok: false, errors: parsed.errors.map((e) => format(locale, e)) });
      return;
    }
    void applyPatchWithUndo(parsed.patch).then((result) => {
      if (result.errors.length > 0) {
        setReview({ ok: false, errors: result.errors.map((e) => format(locale, e as never)) });
        return;
      }
      setReview(null);
      setPatchText('');
      showToast(format(locale, 'ai.toast.applied', { count: result.applied.length }), {
        label: locale === 'ko' ? '되돌리기' : 'Undo',
        onClick: () => undo(),
      });
    });
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

      <p className="eyebrow">{locale === 'ko' ? '1. 무슨 일이 생겼나요?' : '1. What happened?'}</p>
      <div className="chip-row wrap">
        {SITUATIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip chip-btn ${situationId === s.id ? 'chip-selected' : ''}`}
            onClick={() => choose(s.id)}
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
            <button type="button" className="btn btn-primary" onClick={() => void copyPrompt()}>
              <CopyIcon width={16} height={16} />{' '}
              {locale === 'ko' ? 'AI 요청문 복사' : 'Copy the note'}
            </button>
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
            value={patchText}
            onChange={(e) => setPatchText(e.target.value)}
            rows={8}
            placeholder={
              '{\n  "type": "datepack.patch",\n  "version": 1,\n  "operations": [...]\n}'
            }
          />
          <div className="action-row">
            <button
              type="button"
              className="btn btn-soft"
              onClick={checkPatch}
              disabled={!patchText.trim()}
            >
              {locale === 'ko' ? '변경 내용 보기' : 'Preview changes'}
            </button>
          </div>

          {review?.ok && (
            <div className="review-card">
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
              {review.warnings.length > 0 && (
                <p className="form-warning">{review.warnings.join(' ')}</p>
              )}
              <div className="action-row">
                <button type="button" className="btn btn-primary" onClick={applyApproved}>
                  {locale === 'ko' ? '적용' : 'Apply'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setReview(null)}>
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
            <div className="review-card error">
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
