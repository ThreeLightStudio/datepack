import { useState } from 'react';
import type {
  Candidate,
  DateEvent,
  DatePackRuntimeState,
  DatePlan,
  DateEventType,
} from '@datepack/core';
import { createEvent, localPointMinutes, sortEventsByOrder } from '@datepack/core';
import {
  completeEvent,
  skipEvent,
  switchToPlanA,
  switchToPlanB,
  unmarkEvent,
  updatePlan,
} from '../../store/datepackStore';
import { EventEditorSheet } from '../editor/EventEditorSheet';
import { PlanMetaSheet } from '../editor/PlanMetaSheet';
import { CurrentContextSheet } from '../day/CurrentContextSheet';
import { useStore } from '../../store/datepackStore';
import { CheckIcon, EditIcon, EVENT_TYPE_ICONS, PlusIcon, SkipIcon } from '../../components/icons';
import { eventTypeLabel, format, formatDate, useLocale } from '../../i18n';
import { useNow } from '../../hooks/useNow';
import { computeDayContext, timeRangeLabel } from '../day/dayRuntime';

function pointLabel(point: { time: string; dayOffset: 0 | 1 }, locale: 'ko' | 'en'): string {
  return `${point.time}${point.dayOffset ? (locale === 'ko' ? ' (다음 날)' : ' (next day)') : ''}`;
}

type Props = { plan: DatePlan; runtime: DatePackRuntimeState | null; onOpenAi: () => void };
export function PlanView({ plan, runtime, onOpenAi }: Props) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const store = useStore();
  const now = useNow(30_000);
  const ctx = computeDayContext(plan, runtime, now);
  const [editing, setEditing] = useState<DateEvent | null | 'new'>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [candidateTitle, setCandidateTitle] = useState('');
  const [candidateType, setCandidateType] = useState<DateEventType>('place');
  const ordered = sortEventsByOrder(plan.events);
  const statusById = new Map(ctx.events.map((entry) => [entry.event.id, entry.status]));
  function addCandidate() {
    if (!candidateTitle.trim()) return;
    const candidate: Candidate = {
      id: `candidate-${crypto.randomUUID()}`,
      title: candidateTitle.trim(),
      type: candidateType,
    };
    updatePlan(ko ? '후보 추가' : 'Add candidate', (draft) => {
      draft.candidates = [...(draft.candidates ?? []), candidate];
      return draft;
    });
    setCandidateTitle('');
  }
  function promote(candidate: Candidate) {
    updatePlan(ko ? '후보를 일정에 추가' : 'Add candidate to plan', (draft) => {
      const event = createEvent({
        title: candidate.title,
        type: candidate.type ?? 'place',
        placeId: candidate.placeId,
        note: candidate.note,
        timing: { kind: 'unscheduled' },
        order: draft.events.length,
      });
      draft.events.push(event);
      draft.candidates = (draft.candidates ?? []).filter((item) => item.id !== candidate.id);
      return draft;
    });
  }
  return (
    <div className="view plan-view">
      <header className="view-head">
        <p className="eyebrow">
          {plan.date ? formatDate(locale, plan.date) : ko ? '날짜 미정' : 'Date not set'}
        </p>
        <div className="title-row">
          <h1 className="plan-title">{plan.title}</h1>
          <button
            type="button"
            className="icon-btn framed"
            onClick={() => setMetaOpen(true)}
            aria-label={ko ? '데이트 정보 편집' : 'Edit date details'}
          >
            <EditIcon width={17} height={17} />
          </button>
        </div>
        {plan.memo && <p className="sub-line">{plan.memo}</p>}
        {plan.availableFrom || plan.mustEndBy ? (
          <p className="meta-line">
            {ko ? '가능 시간' : 'Available'}:{' '}
            {plan.availableFrom ? pointLabel(plan.availableFrom, locale) : '—'}
            {plan.mustEndBy ? ` – ${pointLabel(plan.mustEndBy, locale)}` : ''}
          </p>
        ) : null}
      </header>
      <section className="meeting-summary">
        <div>
          <p className="eyebrow">{format(locale, 'p3.meeting')}</p>
          <strong>
            {plan.meeting?.placeId
              ? plan.places?.find((p) => p.id === plan.meeting?.placeId)?.name
              : format(locale, 'p3.meeting.unset')}
          </strong>
          {plan.meeting?.locationNote && <p className="sub-line">{plan.meeting.locationNote}</p>}
          {plan.meeting?.timing?.kind === 'exact' && (
            <p className="meta-line">{plan.meeting.timing.start.time}</p>
          )}
        </div>
        <button type="button" className="btn btn-soft" onClick={() => setMetaOpen(true)}>
          {ko ? '수정' : 'Edit'}
        </button>
      </section>
      <section className="context-summary">
        <div>
          <p className="eyebrow">{ko ? '마지막으로 알려준 상황' : 'Last situation you shared'}</p>
          {store.liveContext?.planId === plan.id ? (
            <p className="sub-line">
              {[
                store.liveContext.place,
                store.liveContext.activity,
                store.liveContext.nextPlace ??
                  plan.events.find((e) => e.id === store.liveContext?.nextPlaceId)?.title,
              ]
                .filter(Boolean)
                .join(' · ') || (ko ? '상황 정보 없음' : 'No details')}
            </p>
          ) : (
            <p className="sub-line">{ko ? '아직 입력하지 않았어요' : 'Nothing added yet'}</p>
          )}
        </div>
        <button type="button" className="btn btn-soft" onClick={() => setContextOpen(true)}>
          {ko ? '지금 상황' : 'Update now'}
        </button>
      </section>

      <div className="action-row">
        <button type="button" className="btn btn-soft" onClick={onOpenAi}>
          {ko ? 'AI와 다시 계획하기' : 'Replan with AI'}
        </button>
      </div>

      <section aria-labelledby="selected-heading">
        <h2 id="selected-heading" className="section-title">
          {format(locale, 'p3.plan.selected')}
        </h2>
        {ordered.length ? (
          <ol className="timeline">
            {ordered.map((event, position) => {
              const status = statusById.get(event.id) ?? 'upcoming';
              const place = plan.places?.find((p) => p.id === event.placeId);
              const Icon = EVENT_TYPE_ICONS[event.type];
              const previous = ordered[position - 1];
              const orderConflict = Boolean(
                previous?.timing.kind === 'exact' &&
                event.timing.kind === 'exact' &&
                (localPointMinutes(event.timing.start)! <
                  localPointMinutes(previous.timing.start)! ||
                  (previous.timing.end &&
                    localPointMinutes(event.timing.start)! <
                      localPointMinutes(previous.timing.end)!)),
              );
              const eventStart =
                event.timing.kind === 'exact'
                  ? localPointMinutes(event.timing.start)!
                  : event.timing.kind === 'window'
                    ? localPointMinutes(event.timing.earliestStart)!
                    : null;
              const eventEnd =
                event.timing.kind === 'exact'
                  ? localPointMinutes(event.timing.end ?? event.timing.start)!
                  : event.timing.kind === 'window'
                    ? localPointMinutes(event.timing.latestStart)!
                    : null;
              const availabilityConflict = Boolean(
                (eventStart !== null &&
                  plan.availableFrom &&
                  eventStart < localPointMinutes(plan.availableFrom)!) ||
                (eventEnd !== null &&
                  plan.mustEndBy &&
                  eventEnd > localPointMinutes(plan.mustEndBy)!),
              );
              const statusText =
                status === 'completed'
                  ? ko
                    ? '완료 확인'
                    : 'Marked done'
                  : status === 'skipped'
                    ? ko
                      ? '건너뜀 확인'
                      : 'Marked skipped'
                    : status === 'unknown-past'
                      ? ko
                        ? '예정 시각 지남 · 실제 상황 미확인'
                        : 'Planned time passed · actual status unknown'
                      : status === 'current'
                        ? ko
                          ? '예정 시간대'
                          : 'Planned now'
                        : ko
                          ? '예정'
                          : 'Planned';
              return (
                <li key={event.id} className="plan-event">
                  <button
                    type="button"
                    className={`tl-row tl-${status}`}
                    onClick={() => setEditing(event)}
                  >
                    <span className="tl-time">
                      {timeRangeLabel(
                        {
                          event,
                          status,
                          startMinutes: null,
                          endMinutes: null,
                          delayedByMinutes: 0,
                          activePlan: 'A',
                        },
                        locale,
                      )}
                    </span>
                    <span className="tl-icon">
                      <span className="tl-icon-circle">
                        <Icon width={15} height={15} />
                      </span>
                    </span>
                    <span className="tl-main">
                      <span className="tl-title">
                        {event.title}
                        {event.importance === 'core' && (
                          <span className="core-chip">{ko ? '중요' : 'Core'}</span>
                        )}
                      </span>
                      <span className="tl-sub">
                        {availabilityConflict
                          ? `${format(locale, 'p3.plan.availabilityConflict')} · `
                          : ''}
                        {orderConflict ? `${format(locale, 'p3.plan.conflict')} · ` : ''}
                        {statusText}
                        {place ? ` · ${place.name}` : ''}
                        {` · ${eventTypeLabel(locale, event.type)}`}
                      </span>
                    </span>
                  </button>
                  <div className="event-plan-actions">
                    <button type="button" className="link-btn" onClick={() => setEditing(event)}>
                      {ko ? '편집' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      aria-label={ko ? `${event.title} 완료로 표시` : `Mark ${event.title} done`}
                      aria-pressed={status === 'completed'}
                      onClick={() =>
                        void (status === 'completed'
                          ? unmarkEvent(event.id)
                          : completeEvent(event.id))
                      }
                    >
                      <CheckIcon width={14} height={14} />
                      {format(locale, 'p3.plan.markDone')}
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      aria-label={
                        ko ? `${event.title} 건너뜀으로 표시` : `Mark ${event.title} skipped`
                      }
                      aria-pressed={status === 'skipped'}
                      onClick={() =>
                        void (status === 'skipped' ? unmarkEvent(event.id) : skipEvent(event.id))
                      }
                    >
                      <SkipIcon width={14} height={14} />
                      {format(locale, 'p3.plan.markSkipped')}
                    </button>
                    {event.planB && (
                      <button
                        type="button"
                        className="link-btn"
                        aria-pressed={runtime?.events[event.id]?.activePlan === 'B'}
                        onClick={() =>
                          void (runtime?.events[event.id]?.activePlan === 'B'
                            ? switchToPlanA(event.id)
                            : switchToPlanB(event.id))
                        }
                      >
                        {runtime?.events[event.id]?.activePlan === 'B'
                          ? ko
                            ? 'Plan A로 돌아가기'
                            : 'Use Plan A'
                          : ko
                            ? `Plan B · ${event.planB.title}`
                            : `Use Plan B · ${event.planB.title}`}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="empty-inline">{format(locale, 'p3.plan.empty')}</p>
        )}
        <button
          type="button"
          className="btn btn-soft add-event-btn"
          onClick={() => setEditing('new')}
        >
          <PlusIcon width={18} height={18} />
          {ko ? '활동 추가' : 'Add activity'}
        </button>
      </section>

      <section className="candidate-section" aria-labelledby="candidate-heading">
        <h2 id="candidate-heading" className="section-title">
          {format(locale, 'p3.plan.candidates')}
        </h2>
        <p className="hint-text">{format(locale, 'p3.plan.candidates.note')}</p>
        {(plan.candidates ?? []).map((candidate) => (
          <div
            key={candidate.id}
            className={`candidate-row${candidate.excluded ? ' is-excluded' : ''}`}
          >
            <div>
              <strong>{candidate.title}</strong>
              {candidate.proposedBy && <span className="tl-sub"> · {candidate.proposedBy}</span>}
            </div>
            <button
              type="button"
              className="link-btn"
              onClick={() => promote(candidate)}
              disabled={candidate.excluded}
            >
              {format(locale, 'p3.plan.promote')}
            </button>
            <button
              type="button"
              className="link-btn"
              aria-pressed={Boolean(candidate.excluded)}
              onClick={() =>
                updatePlan(ko ? '후보 제외' : 'Exclude idea', (draft) => {
                  draft.candidates = (draft.candidates ?? []).map((item) =>
                    item.id === candidate.id ? { ...item, excluded: !item.excluded } : item,
                  );
                  return draft;
                })
              }
            >
              {candidate.excluded
                ? format(locale, 'p3.plan.restore')
                : format(locale, 'p3.plan.exclude')}
            </button>
          </div>
        ))}
        <div className="field-row">
          <label className="field">
            <span>{ko ? '새 후보' : 'New idea'}</span>
            <input
              value={candidateTitle}
              onChange={(e) => setCandidateTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCandidate();
                }
              }}
            />
          </label>
          <label className="field">
            <span>{ko ? '종류' : 'Type'}</span>
            <select
              value={candidateType}
              onChange={(e) => setCandidateType(e.target.value as DateEventType)}
            >
              <option value="place">{ko ? '장소' : 'Place'}</option>
              <option value="meal">{ko ? '식사' : 'Meal'}</option>
              <option value="cafe">{ko ? '카페' : 'Café'}</option>
              <option value="activity">{ko ? '활동' : 'Activity'}</option>
            </select>
          </label>
          <button type="button" className="btn btn-soft candidate-add" onClick={addCandidate}>
            <PlusIcon width={16} height={16} />
            {format(locale, 'p3.plan.addCandidate')}
          </button>
        </div>
      </section>
      {plan.constraints && (
        <section className="constraint-box">
          <p className="eyebrow">{ko ? '데이트 약속' : 'Date preferences'}</p>
          <div className="chip-row wrap">
            {(plan.constraints.must ?? []).map((x) => (
              <span className="chip" key={`m${x}`}>
                {ko ? '꼭 · ' : 'Must · '}
                {x}
              </span>
            ))}
            {(plan.constraints.prefer ?? []).map((x) => (
              <span className="chip" key={`p${x}`}>
                {ko ? '하고 싶음 · ' : 'Would like · '}
                {x}
              </span>
            ))}
            {(plan.constraints.avoid ?? []).map((x) => (
              <span className="chip chip-muted" key={`a${x}`}>
                {ko ? '피하기 · ' : 'Avoid · '}
                {x}
              </span>
            ))}
          </div>
        </section>
      )}
      {editing !== null && (
        <EventEditorSheet
          plan={plan}
          event={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {metaOpen && (
        <PlanMetaSheet
          plan={plan}
          personalJourney={store.personalJourney}
          onClose={() => setMetaOpen(false)}
        />
      )}
      {contextOpen && (
        <CurrentContextSheet
          plan={plan}
          runtime={runtime}
          context={store.liveContext}
          onClose={() => setContextOpen(false)}
        />
      )}
    </div>
  );
}
