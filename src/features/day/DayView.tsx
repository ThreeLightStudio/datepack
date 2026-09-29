import { useMemo, useState } from 'react';
import type { DatePackRuntimeState, DatePlan } from '@datepack/core';
import { completeEvent } from '../../store/datepackStore';
import { useStore } from '../../store/datepackStore';
import { CurrentContextSheet } from './CurrentContextSheet';
import { computeDayContext, timeRangeLabel } from './dayRuntime';
import { format, formatDate, useLocale } from '../../i18n';
import { useNow } from '../../hooks/useNow';
import { CheckIcon, MapIcon } from '../../components/icons';
import { mapBridgeUrl } from '../../utils/mapBridge';

type Props = {
  plan: DatePlan;
  runtime: DatePackRuntimeState | null;
  onOpenAi: () => void;
  onOpenPlan: () => void;
};
export function DayView({ plan, runtime, onOpenAi: _onOpenAi, onOpenPlan }: Props) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const store = useStore();
  const now = useNow(30_000);
  const ctx = useMemo(() => computeDayContext(plan, runtime, now), [plan, runtime, now]);
  const [contextOpen, setContextOpen] = useState(false);
  const current = ctx.current;
  const selectedNext =
    store.liveContext?.planId === plan.id
      ? plan.events.find((event) => event.id === store.liveContext?.nextPlaceId)
      : null;
  const ordered = [...plan.events].sort((a, b) => a.order - b.order);
  const first =
    ctx.next?.event ??
    ordered.find(
      (event) =>
        event.timing.kind === 'unscheduled' &&
        !['completed', 'skipped'].includes(runtime?.events[event.id]?.status ?? 'pending'),
    ) ??
    (!ctx.isToday
      ? ordered.find(
          (event) =>
            !['completed', 'skipped'].includes(runtime?.events[event.id]?.status ?? 'pending'),
        )
      : null);
  const visibleCurrent =
    current ??
    (first
      ? {
          event: first,
          status: 'upcoming' as const,
          startMinutes: null,
          endMinutes: null,
          delayedByMinutes: 0,
          activePlan: 'A' as const,
        }
      : null);
  const plannedPlace = visibleCurrent?.event.placeId
    ? plan.places?.find((place) => place.id === visibleCurrent.event.placeId)
    : undefined;
  const mapUrl = plannedPlace ? mapBridgeUrl(plannedPlace.mapQuery || plannedPlace.name) : '';
  return (
    <div className="view day-view">
      <header className="view-head">
        <p className="eyebrow">
          {plan.date ? formatDate(locale, plan.date) : ko ? '날짜 미정' : 'Date not set'}
        </p>
        <h1 className="plan-title">{plan.title}</h1>
        <span className={`date-chip${ctx.isToday ? ' today' : ''}`}>
          {ctx.isToday ? (ko ? '오늘' : 'Today') : ko ? '예정' : 'Planned'}
        </span>
      </header>
      <section className="context-card" aria-labelledby="context-heading">
        <div className="context-card-copy">
          <p className="eyebrow" id="context-heading">
            {format(locale, 'p3.day.context')}
          </p>
          {store.liveContext?.planId === plan.id ? (
            <>
              <strong>
                {store.liveContext.place ||
                  store.liveContext.activity ||
                  (ko ? '상황을 기록했어요' : 'Situation saved')}
              </strong>
              <p className="sub-line">
                {[store.liveContext.activity, store.liveContext.nextPlace ?? selectedNext?.title]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="hint-text">
                {ko
                  ? '직접 확인한 내용'
                  : `Confirmed ${new Date(store.liveContext.confirmedAt ?? store.liveContext.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`}
              </p>
            </>
          ) : (
            <p className="sub-line">
              {ko
                ? '아직 정한 상황이 없어요. 필요할 때만 업데이트하세요.'
                : 'No update yet. Add one whenever it helps.'}
            </p>
          )}
        </div>
        <button type="button" className="btn btn-soft" onClick={() => setContextOpen(true)}>
          {format(locale, 'p3.day.context.update')}
        </button>
      </section>
      {visibleCurrent ? (
        <section className="card now-card planned-card">
          <div className="card-body">
            <span className="pill pill-soft">
              {current ? (ko ? '예정된 시간대' : 'Planned time') : ko ? '다음 일정' : 'Up next'}
            </span>
            <h2 className="now-title">{visibleCurrent.event.title}</h2>
            <p className="meta-line">{timeRangeLabel(visibleCurrent, locale)}</p>
            <p className="sub-line">
              {current
                ? ko
                  ? format(locale, 'p3.day.actual.unknown')
                  : format(locale, 'p3.day.actual.unknown')
                : ko
                  ? '일정이 비어 있어도 괜찮아요.'
                  : 'It’s okay to leave the rest open.'}
            </p>
            <div className="card-actions">
              {mapUrl && (
                <a className="btn btn-soft" href={mapUrl} target="_blank" rel="noopener noreferrer">
                  <MapIcon width={18} height={18} />
                  {ko ? '지도에서 열기' : 'Open map'}
                </a>
              )}
              {current && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void completeEvent(current.event.id)}
                >
                  <CheckIcon width={18} height={18} />
                  {ko ? '여기 완료' : 'Mark done here'}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="empty-inline">
          {ctx.overdueUnsettled.length > 0
            ? ko
              ? '예정 시간이 지난 일정의 실제 상황은 미확인으로 남아 있어요. 남은 계획을 직접 조정할 수 있어요.'
              : 'Earlier plans stay unconfirmed. You can adjust the rest yourself.'
            : ko
              ? '정해진 일정이 없어요. 빈 계획이나 반나절 계획으로 시작할 수 있어요.'
              : 'No activities yet. An empty or half-day plan is fine.'}
        </section>
      )}
      {ctx.overdueUnsettled.length > 0 && (
        <section className="unknown-past">
          <p className="eyebrow">{format(locale, 'p3.day.past.unknown')}</p>
          <p className="hint-text">
            {ko ? format(locale, 'p3.day.past.note') : format(locale, 'p3.day.past.note')}
          </p>
          <ul>
            {ctx.overdueUnsettled.map((item) => (
              <li key={item.event.id}>{item.event.title}</li>
            ))}
          </ul>
        </section>
      )}
      {store.personalJourney?.planId === plan.id && (
        <p className="device-note">
          {ko
            ? `내 이동 메모는 이 기기에만 저장돼요${store.personalJourney.origin ? ` · ${store.personalJourney.origin}` : ''}`
            : `My travel note stays on this device${store.personalJourney.origin ? ` · ${store.personalJourney.origin}` : ''}`}
        </p>
      )}
      <div className="day-actions">
        <button type="button" className="btn btn-primary" onClick={onOpenPlan}>
          {format(locale, 'p3.day.adjust')}
        </button>
        <button type="button" className="btn btn-soft" onClick={onOpenPlan}>
          {ko ? '전체 일정 보기' : 'View full plan'}
        </button>
      </div>
      {contextOpen && (
        <CurrentContextSheet
          plan={plan}
          context={store.liveContext}
          onClose={() => setContextOpen(false)}
        />
      )}
    </div>
  );
}
