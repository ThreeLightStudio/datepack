import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { sortEventsByOrder } from '@datepack/core';
import type { DatePlan } from '@datepack/core';
import { Sheet } from '../../components/Sheet';
import { ArrowDownIcon, ArrowUpIcon, GripIcon } from '../../components/icons';
import { format, useLocale } from '../../i18n';
import {
  commitReviewedReorder,
  prepareReorder,
  prepareReorderTimeAdjustment,
  type ReorderReview,
} from '../../store/datepackStore';
import { impactMessage } from '../day/routeCopy';
import { timingLabel } from '../ai/timingPresentation';
import { adjustReorderedTimes } from './reorder';

export function usePlanReorder(plan: DatePlan) {
  const locale = useLocale();
  const msg = (key: Parameters<typeof format>[1], values?: Record<string, string | number>) =>
    format(locale, key, values);
  const [review, setReview] = useState<ReorderReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [drop, setDrop] = useState<{ id: string; beforeId: string | null } | null>(null);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    pointerX: number;
    pointerY: number;
    moved: boolean;
    target?: string | null;
  } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const ordered = sortEventsByOrder(plan.events);
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [plan.events]);
  async function move(id: string, beforeId: string | null) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await prepareReorder(id, beforeId);
      if (!result) return;
      if (
        result.impact.status === 'verified' &&
        result.impact.reasonCodes.includes('no-route-impact')
      ) {
        const saved = await commitReviewedReorder(result);
        setNotice(msg(saved ? 'reorder.saved' : 'reorder.stale'));
      } else setReview(result);
    } catch {
      setNotice(msg('reorder.failed'));
    } finally {
      setBusy(false);
    }
  }
  function step(id: string, direction: -1 | 1) {
    const index = ordered.findIndex((event) => event.id === id);
    if (index < 0 || index + direction < 0 || index + direction >= ordered.length) return;
    void move(id, direction === -1 ? ordered[index - 1].id : (ordered[index + 2]?.id ?? null));
  }
  function pointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (busy || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    cancel();
    drag.current = {
      id,
      x: event.clientX,
      y: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      moved: false,
    };
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8 && !current.moved)
      return;
    current.moved = true;
    current.pointerX = event.clientX;
    current.pointerY = event.clientY;
    updateTarget();
    if (scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(scrollAtEdge);
  }
  function updateTarget() {
    const current = drag.current;
    if (!current) return;
    const element = document
      .elementFromPoint(current.pointerX, current.pointerY)
      ?.closest<HTMLElement>('[data-event-id]');
    if (!element || !list.current?.contains(element)) {
      current.target = undefined;
      setDrop(null);
      return;
    }
    const id = element.dataset.eventId!;
    const box = element.getBoundingClientRect();
    const index = ordered.findIndex((entry) => entry.id === id);
    current.target =
      current.pointerY < box.top + box.height / 2 ? id : (ordered[index + 1]?.id ?? null);
    const beforeId = current.target;
    setDrop((old) =>
      old?.id === current.id && old.beforeId === beforeId ? old : { id: current.id, beforeId },
    );
  }
  function scrollAtEdge() {
    scrollFrame.current = null;
    const current = drag.current;
    if (!current?.moved || current.target === undefined) return;
    const distance =
      current.pointerY < 120 ? -12 : current.pointerY > window.innerHeight - 120 ? 12 : 0;
    if (!distance) return;
    const previous = window.scrollY;
    window.scrollBy(0, distance);
    updateTarget();
    if (window.scrollY !== previous && drag.current)
      scrollFrame.current = requestAnimationFrame(scrollAtEdge);
  }
  function cancel() {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    drag.current = null;
    setDrop(null);
  }
  function pointerUp() {
    const current = drag.current;
    cancel();
    if (current?.moved && current.target !== undefined) void move(current.id, current.target);
  }
  function controls(id: string, position: number, title: string) {
    return (
      <div className="reorder-controls">
        <button
          type="button"
          className="reorder-handle"
          disabled={busy}
          aria-label={msg('reorder.handle', { title })}
          aria-describedby={ordered.length > 1 ? 'reorder-help' : undefined}
          title={msg('reorder.help')}
          onPointerDown={(event) => pointerDown(event, id)}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel();
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              step(id, event.key === 'ArrowUp' ? -1 : 1);
            }
          }}
        >
          <GripIcon width={20} height={20} />
        </button>
        <button
          type="button"
          className="link-btn reorder-step"
          disabled={busy || position === 0}
          aria-label={msg('reorder.upLabel', { title })}
          onClick={() => step(id, -1)}
        >
          <ArrowUpIcon width={16} height={16} aria-hidden="true" /> {msg('reorder.up')}
        </button>
        <button
          type="button"
          className="link-btn reorder-step"
          disabled={busy || position === ordered.length - 1}
          aria-label={msg('reorder.downLabel', { title })}
          onClick={() => step(id, 1)}
        >
          <ArrowDownIcon width={16} height={16} aria-hidden="true" /> {msg('reorder.down')}
        </button>
      </div>
    );
  }
  const sheet = review && (
    <Sheet
      open
      title={msg('reorder.review')}
      onClose={() => {
        if (!busy) setReview(null);
      }}
    >
      <p className="hint-text">{msg('reorder.reviewHint')}</p>
      <ol className="reorder-preview">
        {sortEventsByOrder(review.proposed.events).map((event) => {
          const prior = review.before.events.find((old) => old.id === event.id)!;
          return (
            <li key={event.id}>
              <strong>{event.title}</strong>
              <span className="meta-line">
                {JSON.stringify(prior.timing) !== JSON.stringify(event.timing)
                  ? `${timingLabel(prior.timing, locale)} → `
                  : ''}
                {timingLabel(event.timing, locale)}
              </span>
            </li>
          );
        })}
      </ol>
      <p
        className={`hint-text${review.impact.status === 'verified' ? '' : ' error-text'}`}
        role="status"
      >
        {impactMessage(review.impact, locale)}
      </p>
      {adjustReorderedTimes(review.proposed) && (
        <button
          type="button"
          className="btn btn-soft"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const adjusted = await prepareReorderTimeAdjustment(review);
              if (adjusted) setReview(adjusted);
            } catch {
              setNotice(msg('reorder.failed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          {msg('reorder.adjust')}
        </button>
      )}
      <div className="action-row">
        <button
          type="button"
          className="btn btn-soft"
          disabled={busy}
          onClick={() => setReview(null)}
        >
          {msg('reorder.keep')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || review.impact.status !== 'verified'}
          onClick={async () => {
            setBusy(true);
            try {
              if (await commitReviewedReorder(review)) {
                setReview(null);
                setNotice(msg('reorder.saved'));
              } else setNotice(msg('reorder.stale'));
            } finally {
              setBusy(false);
            }
          }}
        >
          {msg('reorder.confirm')}
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </Sheet>
  );
  return { list, controls, drop, sheet, notice, busy };
}
