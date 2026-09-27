import { useMemo, useState } from 'react';
import type { DateEvent, DatePackRuntimeState, DatePlan } from '@datepack/core';
import { formatTime, parseTime, todayISO } from '@datepack/core';
import { computeDayContext } from '../day/dayRuntime';
import { unmarkEvent, completeEvent, skipEvent } from '../../store/datepackStore';
import { EventEditorSheet } from '../editor/EventEditorSheet';
import { PlanMetaSheet } from '../editor/PlanMetaSheet';
import { AssetImage } from '../../components/AssetImage';
import {
  CheckIcon,
  EditIcon,
  EVENT_TYPE_ICONS,
  LockIcon,
  PlusIcon,
  SkipIcon,
} from '../../components/icons';
import { formatDate, eventTypeLabel, useLocale } from '../../i18n';
import { useNow } from '../../hooks/useNow';

type Props = { plan: DatePlan; runtime: DatePackRuntimeState | null };

export function PlanView({ plan, runtime }: Props) {
  const locale = useLocale();
  const now = useNow(30_000);
  const ctx = useMemo(() => computeDayContext(plan, runtime, now), [plan, runtime, now]);
  const [editing, setEditing] = useState<DateEvent | 'new' | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);

  const statusById = new Map(ctx.events.map((v) => [v.event.id, v.status]));
  const sorted = useMemo(
    () => [...plan.events].sort((a, b) => (parseTime(a.start) ?? 0) - (parseTime(b.start) ?? 0)),
    [plan.events],
  );

  // One source of truth per event: started events on today's plan carry their
  // log controls inline — no separate checklist section duplicating them.
  const recordable = plan.date === todayISO(now) && ctx.events.some((v) => v.status !== 'upcoming');

  return (
    <div className="view plan-view">
      <header className="view-head">
        <p className="eyebrow">{formatDate(locale, plan.date)}</p>
        <div className="title-row">
          <h1 className="plan-title">{plan.title}</h1>
          <button
            type="button"
            className="icon-btn framed"
            onClick={() => setMetaOpen(true)}
            aria-label={locale === 'ko' ? '데이트 정보 편집' : 'Edit date details'}
          >
            <EditIcon width={17} height={17} />
          </button>
        </div>
        {plan.memo && <p className="sub-line">{plan.memo}</p>}
      </header>

      <ol className="timeline">
        {sorted.map((event) => {
          const status = statusById.get(event.id) ?? 'upcoming';
          const place = plan.places?.find((p) => p.id === event.placeId);
          const activeB = runtime?.events[event.id]?.activePlan === 'B' && event.planB;
          const canLog =
            recordable &&
            (status === 'past' ||
              status === 'current' ||
              status === 'completed' ||
              status === 'skipped');
          const subParts = [
            status === 'current'
              ? locale === 'ko'
                ? '지금'
                : 'Now'
              : status === 'skipped'
                ? locale === 'ko'
                  ? '건너뜀'
                  : 'Skipped'
                : status === 'past'
                  ? locale === 'ko'
                    ? '지나감'
                    : 'Passed'
                  : null,
            eventTypeLabel(locale, event.type),
            place?.name,
            event.assetIds?.length ? (locale === 'ko' ? '사진' : 'Photos') : null,
            event.planB ? 'Plan B' : null,
          ].filter(Boolean);
          return (
            <li key={event.id} className={canLog ? 'tl-loggable' : undefined}>
              <button
                type="button"
                className={`tl-row tl-${status}`}
                onClick={() => setEditing(event)}
              >
                <span className="tl-time">
                  {formatTime(parseTime(event.start) ?? 0)}
                  {event.end && <em>–{formatTime(parseTime(event.end) ?? 0)}</em>}
                </span>
                <span className="tl-icon">
                  <span className="tl-icon-circle">
                    {status === 'completed' ? (
                      <CheckIcon width={13} height={13} />
                    ) : status === 'skipped' ? (
                      <span className="tl-skip-mark">×</span>
                    ) : (
                      (() => {
                        const Icon = EVENT_TYPE_ICONS[event.type];
                        return <Icon width={15} height={15} />;
                      })()
                    )}
                  </span>
                  {status === 'current' && <span className="tl-now-dot" aria-hidden="true" />}
                </span>
                <span className="tl-main">
                  <span className="tl-title">
                    {activeB ? event.planB!.title : event.title}
                    {event.fixed && <LockIcon width={12} height={12} />}
                    {activeB && <span className="planb-chip">Plan B</span>}
                  </span>
                  <span className="tl-sub">{subParts.join(' · ')}</span>
                </span>
                {event.assetIds?.length ? (
                  <AssetImage
                    packId={plan.id}
                    assetId={event.assetIds[0]}
                    fallbackIcon={event.type}
                    className="tl-thumb"
                    alt=""
                  />
                ) : null}
              </button>
              {canLog && (
                <div className="tl-seg-bar">
                  <button
                    type="button"
                    className={`tl-seg ${status === 'completed' ? 'is-active' : ''}`}
                    onClick={() =>
                      void (status === 'completed'
                        ? unmarkEvent(event.id)
                        : completeEvent(event.id))
                    }
                    aria-pressed={status === 'completed'}
                  >
                    <CheckIcon width={14} height={14} />
                    {locale === 'ko' ? '완료' : 'Done'}
                  </button>
                  <button
                    type="button"
                    className={`tl-seg ${status === 'skipped' ? 'is-active skipped' : ''}`}
                    onClick={() =>
                      void (status === 'skipped' ? unmarkEvent(event.id) : skipEvent(event.id))
                    }
                    aria-pressed={status === 'skipped'}
                  >
                    <SkipIcon width={14} height={14} />
                    {locale === 'ko' ? '건너뛰기' : 'Skip'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        className="btn btn-soft add-event-btn"
        onClick={() => setEditing('new')}
      >
        <PlusIcon width={18} height={18} /> {locale === 'ko' ? '일정 추가' : 'Add a stop'}
      </button>

      {plan.constraints && (
        <section className="constraint-box">
          <p className="eyebrow">
            {locale === 'ko' ? '이 데이트의 약속' : 'Ground rules for the day'}
          </p>
          <div className="chip-row wrap">
            {plan.constraints.must?.map((c) => (
              <span key={c} className="chip chip-must">
                {locale === 'ko' ? `반드시 · ${c}` : `Must · ${c}`}
              </span>
            ))}
            {plan.constraints.prefer?.map((c) => (
              <span key={c} className="chip chip-prefer">
                {locale === 'ko' ? `가능하면 · ${c}` : `Nice to · ${c}`}
              </span>
            ))}
            {plan.constraints.avoid?.map((c) => (
              <span key={c} className="chip chip-avoid">
                {locale === 'ko' ? `피하기 · ${c}` : `Avoid · ${c}`}
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
      {metaOpen && <PlanMetaSheet plan={plan} onClose={() => setMetaOpen(false)} />}
    </div>
  );
}
