import { useEffect, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { CopyIcon, SparkleIcon } from '../../components/icons';
import { buildCreatePrompt } from './createPromptBuilder';
import type { DatePack } from '@datepack/core';
import { buildPlanFromDraft, parsePlanDraft, todayISO } from '@datepack/core';
import { createPackFromPlan, showToast } from '../../store/datepackStore';
import { formatDate, format, useLocale } from '../../i18n';

type Props = { open: boolean; onClose: () => void };

type Stage = 'form' | 'prompted';

type Review = { ok: true; pack: DatePack } | { ok: false; errors: string[] } | null;

/** Create a date by discussing it with an external AI: form → prompt → paste reply → review. */
export function CreateWithAiSheet({ open, onClose }: Props) {
  const locale = useLocale();
  const [stage, setStage] = useState<Stage>('form');
  const [region, setRegion] = useState('');
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [prompt, setPrompt] = useState('');
  const [replyText, setReplyText] = useState('');
  const [review, setReview] = useState<Review>(null);

  // A fresh paste deserves a fresh review: clear the reply when reopened.
  useEffect(() => {
    if (open) {
      setReplyText('');
      setReview(null);
    }
  }, [open]);

  function makePrompt(): void {
    if (!region.trim()) {
      showToast(format(locale, 'create.err.region'));
      return;
    }
    setPrompt(
      buildCreatePrompt({
        region,
        date,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        notes: notes || undefined,
        locale,
      }),
    );
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
    showToast(format(locale, 'create.toast.copied'));
  }

  function checkReply(): void {
    const parsed = parsePlanDraft(replyText);
    if (!parsed.ok) {
      setReview({ ok: false, errors: parsed.errors.map((e) => format(locale, e)) });
      return;
    }
    setReview({ ok: true, pack: buildPlanFromDraft(parsed.draft) });
  }

  function start(): void {
    if (!review?.ok) return;
    void createPackFromPlan(review.pack);
    onClose();
  }

  return (
    <Sheet open={open} title={format(locale, 'create.title')} onClose={onClose}>
      <p className="sub-line">{format(locale, 'create.btn.sub')}</p>

      <p className="eyebrow">{format(locale, 'create.step1')}</p>
      <div className="form">
        <label className="field">
          <span>{format(locale, 'create.region')}</span>
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder={format(locale, 'create.region.ph')}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>{format(locale, 'create.date')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="field">
            <span>{format(locale, 'create.time')}</span>
            <div className="field-row">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                aria-label={format(locale, 'create.time')}
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                aria-label={format(locale, 'create.time')}
              />
            </div>
          </div>
        </div>
        <label className="field">
          <span>{format(locale, 'create.notes')}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={format(locale, 'create.notes.ph')}
          />
        </label>
        <div className="action-row">
          <button type="button" className="btn btn-soft" onClick={makePrompt}>
            <SparkleIcon width={16} height={16} /> {format(locale, 'create.makePrompt')}
          </button>
        </div>
      </div>

      {stage === 'prompted' && (
        <>
          <div className="prompt-box">
            <p className="eyebrow">{format(locale, 'create.prompt.eyebrow')}</p>
            <pre>{prompt}</pre>
            <button type="button" className="btn btn-primary" onClick={() => void copyPrompt()}>
              <CopyIcon width={16} height={16} /> {format(locale, 'create.prompt.copy')}
            </button>
          </div>

          <div className="divider" />
          <p className="hint-text">{format(locale, 'create.prompt.hint')}</p>
          <p className="eyebrow">{format(locale, 'create.step2')}</p>
          <p className="hint-text">{format(locale, 'create.step2.hint')}</p>
          <textarea
            className="patch-input"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={8}
            placeholder={
              '{\n  "type": "datepack.plan",\n  "version": 1,\n  "title": "...",\n  "events": [...]\n}'
            }
          />
          <div className="action-row">
            <button
              type="button"
              className="btn btn-soft"
              onClick={checkReply}
              disabled={!replyText.trim()}
            >
              {format(locale, 'create.check')}
            </button>
          </div>

          {review?.ok && (
            <div className="review-card">
              <p className="review-head">
                {format(locale, 'create.review.head', {
                  title: review.pack.plan.title,
                  date: review.pack.plan.date
                    ? formatDate(locale, review.pack.plan.date)
                    : locale === 'ko'
                      ? '날짜 미정'
                      : 'Date undecided',
                })}
              </p>
              <p className="hint-text">
                {format(locale, 'create.review.events', { count: review.pack.plan.events.length })}
              </p>
              <ul className="review-list">
                {review.pack.plan.events.map((event) => (
                  <li key={event.id}>
                    {event.start} {event.title}
                  </li>
                ))}
              </ul>
              <div className="action-row">
                <button type="button" className="btn btn-primary" onClick={start}>
                  {format(locale, 'create.review.apply')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setReview(null)}>
                  {format(locale, 'create.review.cancel')}
                </button>
              </div>
            </div>
          )}
          {review && !review.ok && (
            <div className="review-card error">
              <p className="review-head">{format(locale, 'create.review.error')}</p>
              <ul className="review-list errors">
                {review.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
