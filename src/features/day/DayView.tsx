import { useMemo, useState } from 'react';
import type { DateEvent, DatePackRuntimeState, DatePlan, Place } from '../../datepack/types';
import { computeDayContext, timeRangeLabel, type DayEventView } from './dayRuntime';
import { formatTime, parseTime } from '../../utils/time';
import { mapBridgeUrl } from '../../utils/mapBridge';
import {
  completeEvent,
  delayEvent,
  skipEvent,
  switchToPlanA,
  switchToPlanB,
} from '../../store/datepackStore';
import { AssetImage } from '../../components/AssetImage';
import { Sheet } from '../../components/Sheet';
import { CheckIcon, EVENT_TYPE_ICONS, MapIcon } from '../../components/icons';
import { departurePhrase, formatDate, remainingPhrase, useLocale } from '../../i18n';
import { useNow } from '../../hooks/useNow';

type Props = {
  plan: DatePlan;
  runtime: DatePackRuntimeState | null;
  onOpenAi: () => void;
  onOpenPlan: () => void;
};

export function DayView({ plan, runtime, onOpenAi, onOpenPlan }: Props) {
  const locale = useLocale();
  const now = useNow(30_000);
  const ctx = useMemo(() => computeDayContext(plan, runtime, now), [plan, runtime, now]);
  const [planBSheetFor, setPlanBSheetFor] = useState<string | null>(null);
  const planBEvent = planBSheetFor
    ? (plan.events.find((e) => e.id === planBSheetFor) ?? null)
    : null;

  const daysAway = daysUntil(plan.date, now);

  return (
    <div className="view day-view">
      <header className="view-head">
        <p className="eyebrow">{formatDate(locale, plan.date)}</p>
        <h1 className="plan-title">{plan.title}</h1>
        <span className={`date-chip ${ctx.isToday ? 'today' : ''}`}>
          {ctx.isToday
            ? locale === 'ko'
              ? '오늘의 데이트'
              : "Today's the day"
            : daysAway === null
              ? plan.date
              : daysAway > 0
                ? locale === 'ko'
                  ? `D-${daysAway} 데이트 예정`
                  : `Date in ${daysAway} days`
                : locale === 'ko'
                  ? `데이트 +${-daysAway}일째`
                  : `${-daysAway} days ago`}
        </span>
      </header>

      {ctx.isToday ? (
        <>
          {ctx.allSettled && <AllDone locale={locale} />}
          {ctx.nightCleared && (
            <NightCard plan={plan} ctx={ctx} locale={locale} onOpenPlan={onOpenPlan} />
          )}
          {!ctx.nightCleared && ctx.current && (
            <NowCard
              plan={plan}
              view={ctx.current}
              remaining={ctx.remainingInCurrent}
              locale={locale}
              onOpenPlanB={() => setPlanBSheetFor(ctx.current!.event.id)}
              onComplete={() => void completeEvent(ctx.current!.event.id)}
            />
          )}
          {!ctx.nightCleared && !ctx.current && ctx.next && ctx.overdueUnsettled.length === 0 && (
            <section className="card next-card preview-lead">
              <div className="card-body">
                <span className="pill pill-soft">
                  {locale === 'ko' ? '곧 시작' : 'Almost time'}
                </span>
                <p className="lead-line">
                  {locale === 'ko'
                    ? '아직 첫 일정 전이에요. 여유롭게 준비해요.'
                    : "Nothing's started yet — take your time getting ready."}
                </p>
              </div>
            </section>
          )}
          {!ctx.nightCleared && !ctx.current && ctx.next && ctx.overdueUnsettled.length > 0 && (
            <OverdueCard
              overdue={ctx.overdueUnsettled}
              locale={locale}
              onComplete={(id) => void completeEvent(id)}
              onSkip={(id) => void skipEvent(id)}
            />
          )}
          {ctx.next && (
            <NextCard
              plan={plan}
              view={ctx.next}
              departure={ctx.departure}
              locale={locale}
              onOpenPlanB={() => setPlanBSheetFor(ctx.next!.event.id)}
            />
          )}
          {ctx.completedCount + ctx.skippedCount > 0 && (
            <DoneStrip
              done={ctx.events.filter((v) => v.status === 'completed')}
              skipped={ctx.events.filter((v) => v.status === 'skipped')}
              locale={locale}
            />
          )}
        </>
      ) : (
        <PreviewCard plan={plan} locale={locale} />
      )}

      <Sheet
        open={planBEvent !== null}
        title={locale === 'ko' ? '계획 변경' : 'Change plans'}
        onClose={() => setPlanBSheetFor(null)}
      >
        {planBEvent && (
          <PlanBSheetContent
            event={planBEvent}
            activePlan={planBSheetFor ? (runtime?.events[planBEvent.id]?.activePlan ?? 'A') : 'A'}
            locale={locale}
            onApplyB={() => {
              void switchToPlanB(planBEvent.id);
              setPlanBSheetFor(null);
            }}
            onApplyA={() => {
              void switchToPlanA(planBEvent.id);
              setPlanBSheetFor(null);
            }}
            onComplete={() => {
              void completeEvent(planBEvent.id);
              setPlanBSheetFor(null);
            }}
            onSkip={() => {
              void skipEvent(planBEvent.id);
              setPlanBSheetFor(null);
            }}
            onDelay={() => void delayEvent(planBEvent.id, 15)}
            onOpenAi={onOpenAi}
          />
        )}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NowCard({
  plan,
  view,
  remaining,
  locale,
  onOpenPlanB,
  onComplete,
}: {
  plan: DatePlan;
  view: DayEventView;
  remaining: number | null;
  locale: 'ko' | 'en';
  onOpenPlanB: () => void;
  onComplete: () => void;
}) {
  const { event } = view;
  const activeB = view.activePlan === 'B' && event.planB;
  const place = findPlace(plan, event);
  const mapUrl = place ? mapBridgeUrl(place.mapQuery || place.name) : '';
  const phrase = remainingPhrase(locale, remaining);
  const overdue = remaining !== null && remaining < -2;
  const assetId = event.assetIds?.[0];

  return (
    <section className="card now-card">
      {assetId && (
        <AssetImage
          packId={plan.id}
          assetId={assetId}
          fallbackIcon={event.type}
          className="hero-img"
          alt={event.title}
        />
      )}
      <div className="card-body">
        <span className="pill pill-now">NOW</span>
        <h2 className="now-title">{activeB ? event.planB!.title : event.title}</h2>
        <p className="meta-line">
          {timeRangeLabel(view)}
          {activeB && (
            <span className="planb-chip">
              {locale === 'ko' ? 'Plan B 진행 중' : 'Running Plan B'}
            </span>
          )}
        </p>
        {phrase && <p className={`lead-line${overdue ? ' overdue' : ''}`}>{phrase}</p>}
        {activeB && event.planB?.note && <p className="sub-line">{event.planB.note}</p>}
        {!activeB && event.note && <p className="sub-line">{event.note}</p>}
        {/* Primary actions live inside the card so the core loop never needs a scroll */}
        <div className="card-actions">
          <button type="button" className="btn btn-primary" onClick={onComplete}>
            <CheckIcon width={18} height={18} /> {locale === 'ko' ? '완료했어요' : 'Done here'}
          </button>
          {mapUrl && (
            <a className="btn btn-soft" href={mapUrl} target="_blank" rel="noopener noreferrer">
              <MapIcon width={18} height={18} />{' '}
              {locale === 'ko' ? '지도에서 열기' : 'Open in Maps'}
            </a>
          )}
          {event.planB && (
            <button type="button" className="btn btn-ghost" onClick={onOpenPlanB}>
              {locale === 'ko' ? '계획 변경' : 'Change plans'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function NextCard({
  plan,
  view,
  departure,
  locale,
  onOpenPlanB,
}: {
  plan: DatePlan;
  view: DayEventView;
  departure: ReturnType<typeof computeDayContext>['departure'];
  locale: 'ko' | 'en';
  onOpenPlanB: () => void;
}) {
  const { event } = view;
  const thumbId = event.assetIds?.[0];
  return (
    <section className="card next-card">
      <div className="card-body next-body">
        {thumbId && (
          <AssetImage
            packId={plan.id}
            assetId={thumbId}
            fallbackIcon={event.type}
            className="thumb-img"
            alt=""
          />
        )}
        <div>
          <span className="pill pill-next">NEXT</span>
          <h2 className="next-title">{event.title}</h2>
          <p className="meta-line">
            {formatTime(view.startMinutes)}
            {view.endMinutes !== null ? ` – ${formatTime(view.endMinutes)}` : ''}
          </p>
          {departure && departure.eventId === event.id && (
            <>
              {departure.travelMinutes !== null && (
                <p className="sub-line">
                  {locale === 'ko'
                    ? `이동 ${departure.travelMinutes}분`
                    : `${departure.travelMinutes} min to get there`}
                </p>
              )}
              <p className="lead-line">
                {departurePhrase(
                  locale,
                  departure.departureMinutes,
                  departure.travelMinutes ?? undefined,
                )}
              </p>
            </>
          )}
          {event.planB && (
            <p className="sub-line planb-hint">
              {locale === 'ko'
                ? `Plan B 준비됨 · ${event.planB.title}`
                : `Plan B ready · ${event.planB.title}`}
              <button type="button" className="link-btn" onClick={onOpenPlanB}>
                {locale === 'ko' ? '보기' : 'View'}
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function OverdueCard({
  overdue,
  locale,
  onComplete,
  onSkip,
}: {
  overdue: DayEventView[];
  locale: 'ko' | 'en';
  onComplete: (eventId: string) => void;
  onSkip: (eventId: string) => void;
}) {
  const last = overdue[overdue.length - 1];
  return (
    <section className="card overdue-card">
      <div className="card-body">
        <span className="pill pill-soft">{locale === 'ko' ? '기록 전' : 'Not logged'}</span>
        <h2 className="now-title">
          {locale === 'ko'
            ? `'${last.event.title}' 다음으로 넘어갔어요`
            : `You've moved past '${last.event.title}'`}
        </h2>
        <p className="sub-line">
          {overdue.length > 1
            ? locale === 'ko'
              ? `${overdue.length}개 일정이 아직 기록되지 않았어요. `
              : `${overdue.length} stops still need logging. `
            : ''}
          {locale === 'ko'
            ? '기록해두면 오늘 흐름이 더 정확해져요.'
            : 'Log them and the rest of the day stays on track.'}
        </p>
        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onComplete(last.event.id)}
          >
            <CheckIcon width={18} height={18} /> {locale === 'ko' ? '완료했어요' : 'Done here'}
          </button>
          <button type="button" className="btn btn-soft" onClick={() => onSkip(last.event.id)}>
            {locale === 'ko' ? '건너뛰기' : 'Skip it'}
          </button>
        </div>
      </div>
    </section>
  );
}

function NightCard({
  plan,
  ctx,
  locale,
  onOpenPlan,
}: {
  plan: DatePlan;
  ctx: ReturnType<typeof computeDayContext>;
  locale: 'ko' | 'en';
  onOpenPlan: () => void;
}) {
  const last = ctx.events[ctx.events.length - 1];
  const lastTime = formatTime(last.startMinutes);
  return (
    <section className="card night-card">
      <div className="card-body">
        <span className="pill pill-soft">{locale === 'ko' ? '마무리' : 'Wrapping up'}</span>
        <h2 className="now-title">
          {locale === 'ko' ? '오늘은 여기까지예요' : 'Calling it a night'}
        </h2>
        <p className="lead-line">
          {locale === 'ko'
            ? '기록하지 못한 일정이 있어도 오늘은 충분했어요 ♡'
            : 'A few stops went unlogged — that changes nothing about today ♡'}
        </p>
        {last && (
          <p className="sub-line">
            {locale === 'ko'
              ? `마지막 일정 · ${last.event.title} ${lastTime}`
              : `Last stop · ${last.event.title}, ${lastTime}`}
          </p>
        )}
        <div className="card-actions">
          <button type="button" className="btn btn-soft" onClick={onOpenPlan}>
            {locale === 'ko' ? '기록 정리하기' : 'Tidy up the log'}
          </button>
        </div>
      </div>
    </section>
  );
}

function DoneStrip({
  done,
  skipped,
  locale,
}: {
  done: DayEventView[];
  skipped: DayEventView[];
  locale: 'ko' | 'en';
}) {
  const items = [...done, ...skipped];
  return (
    <section className="done-strip">
      <p className="eyebrow">{locale === 'ko' ? '지나온 일정' : 'Earlier today'}</p>
      <div className="chip-row wrap">
        {items.map((v) => (
          <span
            key={v.event.id}
            className={`chip ${v.status === 'skipped' ? 'chip-muted' : 'chip-done'}`}
          >
            {v.status === 'skipped' ? (locale === 'ko' ? '건너뜀 · ' : 'Skipped · ') : ''}
            {v.event.title}
          </span>
        ))}
      </div>
    </section>
  );
}

function AllDone({ locale }: { locale: 'ko' | 'en' }) {
  return (
    <section className="card alldone-card">
      <div className="card-body">
        <h2 className="now-title">{locale === 'ko' ? '오늘 데이트 완료!' : "That's the day!"}</h2>
        <p className="lead-line">
          {locale === 'ko' ? '좋은 하루였길 바라요 ♡' : 'Hope it was a good one ♡'}
        </p>
      </div>
    </section>
  );
}

function PreviewCard({ plan, locale }: { plan: DatePlan; locale: 'ko' | 'en' }) {
  const first = [...plan.events].sort(
    (a, b) => (parseTime(a.start) ?? 0) - (parseTime(b.start) ?? 0),
  )[0];
  const Icon = first ? EVENT_TYPE_ICONS[first.type] : EVENT_TYPE_ICONS.place;
  return (
    <section className="card now-card preview-hero">
      {plan.coverAssetId ? (
        <AssetImage packId={plan.id} assetId={plan.coverAssetId} className="hero-img" alt="cover" />
      ) : (
        <div className="hero-img asset-placeholder">
          <Icon width={30} height={30} />
        </div>
      )}
      <div className="card-body">
        <span className="pill pill-soft">{locale === 'ko' ? '예정' : 'Upcoming'}</span>
        <h2 className="now-title">
          {first ? first.title : locale === 'ko' ? '일정을 추가해보세요' : 'Add your first stop'}
        </h2>
        {first && (
          <p className="meta-line">
            {first.start}
            {first.end ? ` – ${first.end}` : ''}
          </p>
        )}
        <p className="sub-line">
          {locale === 'ko'
            ? '데이트 당일이 되면 NOW / NEXT가 표시돼요.'
            : 'NOW / NEXT appear on the day itself.'}
        </p>
      </div>
    </section>
  );
}

function PlanBSheetContent({
  event,
  activePlan,
  locale,
  onApplyB,
  onApplyA,
  onComplete,
  onSkip,
  onDelay,
  onOpenAi,
}: {
  event: DateEvent;
  activePlan: 'A' | 'B';
  locale: 'ko' | 'en';
  onApplyB: () => void;
  onApplyA: () => void;
  onComplete: () => void;
  onSkip: () => void;
  onDelay: () => void;
  onOpenAi: () => void;
}) {
  return (
    <div className="planb-sheet">
      <p className="eyebrow">{locale === 'ko' ? '이 일정' : 'This stop'}</p>
      <h3 className="sheet-event-title">{event.title}</h3>

      {event.planB ? (
        <div className="planb-card">
          <p className="eyebrow">
            {locale === 'ko' ? 'Plan B' : 'Plan B'}
            {event.planB.trigger ? ` · ${event.planB.trigger}` : ''}
          </p>
          <p className="planb-title">{event.planB.title}</p>
          {event.planB.note && <p className="sub-line">{event.planB.note}</p>}
          <div className="action-row">
            <button type="button" className="btn btn-primary" onClick={onApplyB}>
              {locale === 'ko' ? 'Plan B 적용' : 'Use Plan B'}
            </button>
            {/* Only a real escape hatch when Plan B is actually running */}
            {activePlan === 'B' && (
              <button type="button" className="btn btn-ghost" onClick={onApplyA}>
                {locale === 'ko' ? 'Plan A로 돌아가기' : 'Back to Plan A'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="sub-line">
          {locale === 'ko' ? '이 일정에는 Plan B가 없어요.' : 'No Plan B for this stop.'}
        </p>
      )}

      <div className="divider" />
      <p className="eyebrow">{locale === 'ko' ? '이 일정 기록' : 'Log this stop'}</p>
      <div className="chip-row wrap">
        <button type="button" className="record-btn" onClick={onComplete}>
          <CheckIcon width={14} height={14} /> {locale === 'ko' ? '완료' : 'Done'}
        </button>
        <button type="button" className="record-btn" onClick={onSkip}>
          {locale === 'ko' ? '건너뛰기' : 'Skip'}
        </button>
        <button type="button" className="record-btn" onClick={onDelay}>
          {locale === 'ko' ? '15분 딜레이' : '+15 min grace'}
        </button>
      </div>

      <div className="divider" />
      <button type="button" className="btn btn-soft ai-jump" onClick={onOpenAi}>
        {locale === 'ko' ? '상황을 알려주면 다시 계획해요 →' : 'Tell us what happened → replan'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function findPlace(plan: DatePlan, event: DateEvent): Place | null {
  return plan.places?.find((p) => p.id === event.placeId) ?? null;
}

function daysUntil(dateIso: string, now: Date): number | null {
  const [y, m, d] = dateIso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}
