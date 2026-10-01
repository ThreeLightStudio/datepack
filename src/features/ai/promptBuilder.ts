import { conditionsText } from '../outing/conditions';
import type { DatePackRuntimeState, DatePlan, EventTiming } from '@datepack/core';
import type { LiveContext } from '../../storage/indexedDb';
import { getRemainingPlanEvents } from '../day/dayRuntime';
import { formatTime } from '@datepack/core';
import { PLAN_TIME_ZONE, seoulMinuteOfDay, seoulPlanDate } from '../day/planTime';
import { computeDayContext, type DayEventView } from '../day/dayRuntime';
import type { Locale } from '../../i18n/core';
import type { MessageKey } from '../../i18n/ko';
import type { AiRequestIdentity } from './exchange';
import { conversationGuide, resultFooterGuide } from './conversation';

export type Situation = { id: string; labelKey: MessageKey };

/** Situation buttons — labels come from the catalogs (regenerated per language). */
export const SITUATIONS: Situation[] = [
  { id: 'crowded', labelKey: 'situation.crowded' },
  { id: 'rain', labelKey: 'situation.rain' },
  { id: 'late', labelKey: 'situation.late' },
  { id: 'closed', labelKey: 'situation.closed' },
  { id: 'tired', labelKey: 'situation.tired' },
  { id: 'elsewhere', labelKey: 'situation.elsewhere' },
  { id: 'custom', labelKey: 'situation.custom' },
];

/** How each situation reads inside the prompt, authored per language. */
const VARIABLES: Record<string, { ko: string; en: string } | null> = {
  crowded: {
    ko: '가려던 곳에 줄이 너무 길어서 들어가기 어려움',
    en: 'the line where we were headed is far too long to get in',
  },
  rain: {
    ko: '갑자기 비가 오기 시작함 (야외 이동/활동 어려움)',
    en: 'it suddenly started raining (outdoor moves and activities are hard)',
  },
  late: { ko: '일정이 예상보다 늦어지고 있음', en: "we're running behind the planned schedule" },
  closed: {
    ko: '가려던 곳이 문을 닫았거나 영업을 종료함',
    en: 'the place we wanted is closed for the day',
  },
  tired: {
    ko: '한쪽 컨디션이 좋지 않아 무리한 일정은 어려움',
    en: 'one of us is low on energy — nothing too demanding',
  },
  elsewhere: {
    ko: '계획보다 다른 곳이 가고 싶어짐',
    en: 'we would rather go somewhere else than what was planned',
  },
  custom: null,
};

const PATCH_SCHEMA_HINT: Record<Locale, string> = {
  ko: `Patch JSON 형식:
{
  "type": "datepack.patch",
  "version": 1,
  "operations": [
    { "op": "replace", "target": "event:<id>", "value": { "start": "16:10", "note": "..." } },
    { "op": "move", "target": "event:<id>", "value": { "start": "16:10", "end": "17:00" } },
    { "op": "remove", "target": "event:<id>" },
    { "op": "insertBefore", "target": "event:<id>", "value": { "title": "새 일정", "start": "16:40", "type": "cafe" } },
    { "op": "insertAfter", "target": "event:<id>", "value": { "title": "새 일정", "start": "16:40" } },
    { "op": "insertFirst", "value": { "title": "첫 일정", "start": "10:00" } }
  ]
}
- op는 replace / move / remove / insertBefore / insertAfter / insertFirst 중 하나입니다.
- target은 위에 적힌 event id 앞에 "event:"를 붙인 문자열입니다. (예: "event:abc123") 위 목록에 없는 id는 절대 사용할 수 없습니다.
- insertFirst는 일정이 하나도 없는 빈 계획에서만 사용하며 target을 넣지 않습니다. 첫 활동의 시각을 모르면 start를 생략할 수 있습니다.
- replace의 value로 쓸 수 있는 필드: title, start, end, timing, type(place|meal|cafe|transport|reservation|activity|note), note, travelMinutes, placeId, place, estimatedDurationMinutes. 기존 보호 설정은 변경할 수 없습니다.
- start와 end는 24시간 HH:mm 형식입니다. (예: "09:30")
- travelMinutes는 그 일정 장소까지 가는 이동 시간(분)입니다.
- 모든 삽입에는 title이 필요하고, 시각이 미정이면 start를 생략하세요. 장소가 새로 생기거나 바뀌면 place에 검색 가능한 이름을 적으세요. place와 placeId를 동시에 쓰지 마세요.
- timing은 {"kind":"unscheduled"}, {"kind":"exact","start":{"dayOffset":0,"time":"16:40"}}, 또는 {"kind":"window","earliestStart":{"dayOffset":0,"time":"16:40"},"latestStart":{"dayOffset":1,"time":"00:20"}} 형식입니다. dayOffset은 0 또는 1이며, start/end도 함께 적으면 exact timing과 일치해야 합니다. 날짜·시각을 추측해서 만들지 마세요.
- estimatedDurationMinutes는 음수가 아닌 체류 시간입니다. 신규 활동에만 protectedFields 배열(time/place/content/delete/order)을 지정할 수 있습니다.`,
  en: `Patch JSON shape:
{
  "type": "datepack.patch",
  "version": 1,
  "operations": [
    { "op": "replace", "target": "event:<id>", "value": { "start": "16:10", "note": "..." } },
    { "op": "move", "target": "event:<id>", "value": { "start": "16:10", "end": "17:00" } },
    { "op": "remove", "target": "event:<id>" },
    { "op": "insertBefore", "target": "event:<id>", "value": { "title": "New stop", "start": "16:40", "type": "cafe" } },
    { "op": "insertAfter", "target": "event:<id>", "value": { "title": "New stop", "start": "16:40" } },
    { "op": "insertFirst", "value": { "title": "First stop", "start": "10:00" } }
  ]
}
- op is one of replace / move / remove / insertBefore / insertAfter / insertFirst.
- target is "event:" followed by one of the event ids listed above (e.g. "event:abc123"). Never use an id that is not in the list above.
- Use insertFirst only when the plan has no stops, and omit target. The first stop's start may be omitted when its time is undecided.
- Allowed replace value fields: title, start, end, timing, type (place|meal|cafe|transport|reservation|activity|note), note, travelMinutes, placeId, place, estimatedDurationMinutes. Never change existing protection settings.
- start and end use 24-hour HH:mm (e.g. "09:30").
- travelMinutes is the travel time, in minutes, to reach that stop's place.
- All inserts require title; omit start when time is unset. Use place with a searchable venue name for new or changed venues. Do not supply both place and placeId.
- timing supports {"kind":"unscheduled"}, {"kind":"exact","start":{"dayOffset":0,"time":"16:40"}}, or {"kind":"window","earliestStart":{"dayOffset":0,"time":"16:40"},"latestStart":{"dayOffset":1,"time":"00:20"}}. dayOffset is 0 or 1. Legacy start/end must agree with exact timing if supplied together. Do not invent dates or times.
- estimatedDurationMinutes is a nonnegative stay duration. Only new activities can specify protectedFields (time/place/content/delete/order).`,
};

export function buildAiPrompt(input: {
  plan: DatePlan;
  runtime: DatePackRuntimeState | null;
  situationId: string;
  customInput?: string;
  locale?: Locale;
  now?: Date;
  identity?: AiRequestIdentity;
  scopeEventIds?: string[];
  liveContext?: LiveContext | null;
}): string {
  const locale = input.locale ?? 'ko';
  const now = input.now ?? new Date();
  const ctx = computeDayContext(input.plan, input.runtime, now);
  const isToday = input.plan.date === seoulPlanDate(now.getTime());
  const L = locale === 'ko' ? koText : enText;

  const lines: string[] = [];
  lines.push(conversationGuide(locale));
  lines.push('');
  lines.push(
    locale === 'ko'
      ? '도보와 대중교통을 균형 있게 비교하되 확인되지 않은 대중교통을 도보보다 낫다고 단정하지 마세요. 자동차·택시는 사용자가 명시한 경우에만 제안하세요. AI가 적은 이동 시간이나 verified 표시는 경로 근거가 아닙니다.'
      : 'Compare walking and transit in balance; do not favor unverified transit. Suggest car or taxi only when explicitly requested. AI travel estimates or a verified label are not route evidence.',
  );
  lines.push(`${L.currentTime(formatTime(seoulMinuteOfDay(now.getTime())))} (${PLAN_TIME_ZONE})`);
  if (!isToday)
    lines.push(
      input.plan.date
        ? L.notToday(input.plan.date)
        : locale === 'ko'
          ? '계획 날짜 미정'
          : 'Plan date undecided',
    );
  lines.push(
    locale === 'ko'
      ? `계획: ${input.plan.title} · ${input.plan.date ?? '날짜 미정'}`
      : `Plan: ${input.plan.title} · ${input.plan.date ?? 'date undecided'}`,
  );
  lines.push(
    locale === 'ko'
      ? '계획·GPS·시각만으로 방문·완료·감정이나 새 경험을 추정하지 마세요. 현재 시각은 예정 날짜·시간을 대신하지 않습니다.'
      : 'Do not infer visits, completion, feelings, or new experiences from the plan, GPS, or clock. Current time does not replace the planned date or timing.',
  );
  lines.push('');
  if (input.liveContext) {
    const live = input.liveContext;
    const label = locale === 'ko' ? '직접 확인한 상황' : 'User-confirmed context';
    if (live.place || live.activity)
      lines.push(
        `${label}: ${[live.place, live.activity].filter(Boolean).join(' · ')} (${live.confirmedAt ?? live.updatedAt})`,
      );
    const attempt = live.locationAttempt;
    if (attempt) {
      lines.push(
        `${locale === 'ko' ? '위치 조회' : 'Location attempt'}: ${attempt.status} (${attempt.attemptedAt})`,
      );
      const known = attempt.observation?.coarseLabel ? attempt.observation : attempt.lastKnown;
      if (known?.coarseLabel)
        lines.push(
          `${locale === 'ko' ? '마지막 확인 지역' : 'Last observed area'}: ${known.coarseLabel} (${known.observedAt})`,
        );
      lines.push(
        locale === 'ko'
          ? '이 위치로 방문·완료나 경로 검증을 추정하지 마세요. 실패 뒤 마지막 확인 지역은 현재 위치가 아니며 관찰 시각을 그대로 유지하세요.'
          : 'Do not infer visits, completion or verified routes from this location. After a failed attempt, the last observed area is not the current location; keep its observation time unchanged.',
      );
    }
    lines.push('');
  }

  const settled = ctx.events.filter((v) => v.status === 'completed' || v.status === 'skipped');
  // Unknown elapsed items stay out of default replans until the user confirms them.
  const allowed = input.scopeEventIds ? new Set(input.scopeEventIds) : undefined;
  const remaining = ctx.events
    .filter(
      (v) =>
        (allowed?.has(v.event.id) && v.status !== 'completed' && v.status !== 'skipped') ||
        v.status === 'upcoming' ||
        v.status === 'current' ||
        (v.status === 'unknown-past' && v.includeInRemaining),
    )
    .filter((v) => !allowed || allowed.has(v.event.id));

  lines.push(
    `${locale === 'ko' ? '수정 가능한 target id (이 목록만 사용)' : 'Editable target ids (use only this list)'}: ${remaining.map((v) => v.event.id).join(', ') || (locale === 'ko' ? '없음' : 'none')}`,
  );
  lines.push('');
  if (settled.length > 0) {
    lines.push(L.settledHeader);
    for (const view of settled) {
      const mark = view.status === 'skipped' ? L.skippedMark : L.doneMark;
      lines.push(`- ${promptTiming(view, locale)} ${view.event.title} (${mark})`);
    }
    lines.push('');
  }

  if (ctx.current) {
    lines.push(L.nowHeader);
    lines.push(stopLine(ctx.current, locale, input.plan));
    lines.push('');
  }

  if (remaining.length > 0) {
    lines.push(L.remainingHeader);
    for (const view of remaining) {
      if (ctx.current && view.event.id === ctx.current.event.id) continue;
      lines.push(stopLine(view, locale, input.plan));
    }
    lines.push('');
  }
  if (allowed) {
    const readOnly = getRemainingPlanEvents(ctx, input.liveContext?.nextPlaceId).filter(
      (view) => !allowed.has(view.event.id),
    );
    if (readOnly.length) {
      lines.push(
        locale === 'ko'
          ? '변경 범위 밖 동선 맥락 (읽기 전용 · 수정 금지)'
          : 'Journey context outside the edit scope (read-only; do not change)',
      );
      for (const view of readOnly) lines.push(stopLine(view, locale, input.plan));
      lines.push('');
    }
  }

  const brief = conditionsText(input.plan, locale === 'ko');
  if (brief) lines.push(brief);
  if (input.plan.outingConditions?.party === 'solo')
    lines.push(
      locale === 'ko'
        ? '혼자 하는 외출입니다. 동행자나 합류 정보를 묻지 마세요.'
        : 'Solo outing: do not ask about companions or meeting up.',
    );
  if (input.plan.outingConditions?.singleStop)
    lines.push(
      locale === 'ko' ? '방문 장소는 한 곳만 유지하세요.' : 'Keep just one visited venue.',
    );
  if (input.plan.outingConditions?.nearby)
    lines.push(
      locale === 'ko'
        ? '짧고 가까운 이동을 우선하세요. 확인되지 않은 이동 시간은 추정으로 표시하세요.'
        : 'Prefer short nearby travel. Label unverified travel time as an estimate.',
    );
  const constraint = input.plan.constraints;
  if (constraint?.must?.length) {
    lines.push(L.mustHeader);
    for (const item of constraint.must) lines.push(`- ${item}`);
    lines.push('');
  }
  if (constraint?.prefer?.length) {
    lines.push(L.preferHeader);
    for (const item of constraint.prefer) lines.push(`- ${item}`);
    lines.push('');
  }
  if (constraint?.avoid?.length) {
    lines.push(L.avoidHeader);
    for (const item of constraint.avoid) lines.push(`- ${item}`);
    lines.push('');
  }

  const fixedEvents = input.plan.events.filter((e) => e.fixed || e.protectedFields?.length);
  if (fixedEvents.length > 0) {
    lines.push(L.fixedHeader);
    for (const event of fixedEvents) {
      const view = ctx.events.find((v) => v.event.id === event.id)!;
      const place = input.plan.places?.find((p) => p.id === event.placeId);
      lines.push(
        `${stopLine(view, locale)}${place ? ` · ${place.name}` : ''} · ${event.fixed ? 'time/place/content/delete/order' : event.protectedFields?.join('/')}`,
      );
    }
    lines.push('');
  }

  const planBList = input.plan.events.filter((e) => e.planB);
  if (planBList.length > 0) {
    lines.push(L.planBHeader);
    for (const event of planBList) {
      const trigger = event.planB?.trigger ? ` (${event.planB.trigger})` : '';
      lines.push(`- ${event.title}: ${event.planB?.title}${trigger}`);
    }
    lines.push('');
  }

  lines.push(L.variableHeader);
  const variable = VARIABLES[input.situationId];
  if (input.situationId === 'custom') {
    if (input.customInput?.trim()) lines.push(`- ${input.customInput.trim()}`);
  } else if (variable) {
    lines.push(`- ${variable[locale]}`);
  }
  lines.push('');

  lines.push(...L.instructions);
  if (input.plan.events.length === 0) {
    lines.push(
      locale === 'ko'
        ? '현재 계획에는 일정이 없습니다. 첫 활동을 추가할 때 insertFirst 하나만 사용하고 target은 넣지 마세요.'
        : 'The plan has no stops yet. To add its first stop, use one insertFirst operation with no target.',
    );
  }
  lines.push('');
  lines.push(PATCH_SCHEMA_HINT[locale]);
  lines.push('');
  lines.push(
    resultFooterGuide(
      locale,
      { type: 'datepack.patch', version: 1, operations: [] },
      input.identity,
    ),
  );
  return lines.join('\n');
}

/** Select editable events in the plan's explicit order, including unscheduled stops. */
export function getAiScopeEventIds(
  plan: DatePlan,
  runtime: DatePackRuntimeState | null,
  kind: 'next-change' | 'remaining-change',
  now: Date = new Date(),
  liveContext?: Pick<LiveContext, 'nextPlaceId'> | null,
): string[] {
  const context = computeDayContext(plan, runtime, now);
  const eligible = getRemainingPlanEvents(context, liveContext?.nextPlaceId);
  const next =
    liveContext?.nextPlaceId && eligible[0]?.event.id === liveContext.nextPlaceId
      ? eligible[0]
      : (context.current ?? eligible[0]);
  return (kind === 'next-change' ? (next ? [next] : []) : eligible).map((item) => item.event.id);
}

/**
 * One stop the AI may target. The id is mandatory here — without it the AI
 * invents targets and every patch fails to apply. Times are the effective
 * ones (runtime delay included) so the replan starts from reality.
 */
function stopLine(view: DayEventView, locale: Locale, plan?: DatePlan): string {
  const delay = view.delayedByMinutes;
  const start = promptTiming(view, locale, delay);
  const end =
    view.endMinutes !== null
      ? `–${formatTime(view.endMinutes + delay)}${view.event.timing.kind === 'exact' && view.event.timing.end?.dayOffset ? (locale === 'ko' ? ' (다음 날)' : ' (next day)') : ''}`
      : '';
  const tags = [`id: ${view.event.id}`, view.event.type];
  if (view.event.fixed || view.event.protectedFields?.length)
    tags.push(locale === 'ko' ? '보호됨' : 'protected');
  if (delay > 0) tags.push(locale === 'ko' ? `지연 ${delay}분` : `delayed ${delay} min`);
  const place = plan?.places?.find((p) => p.id === view.event.placeId);
  const duration = view.event.estimatedDurationMinutes;
  return `- ${start}${end} ${view.event.title} (${tags.join(', ')})${planBNote(view)}${place ? ` · ${place.name} (placeId: ${place.id})` : ''}${duration !== undefined ? ` · ${locale === 'ko' ? '체류' : 'stay'} ${duration} min` : ''} · ${locale === 'ko' ? '저장된 예정 시각 (지연과 별도)' : 'Stored planned timing (separate from delay)'}: ${JSON.stringify(promptTimingData(view.event.timing))}`;
}

/** Never serialize an event/provider object; select only the supported timing fields. */
function promptTimingData(timing: EventTiming): EventTiming {
  if (timing.kind === 'unscheduled')
    return { kind: 'unscheduled', ...(timing.label !== undefined ? { label: timing.label } : {}) };
  const point = (value: { dayOffset: 0 | 1; time: string }) => ({
    dayOffset: value.dayOffset,
    time: value.time,
  });
  if (timing.kind === 'exact')
    return {
      kind: 'exact',
      start: point(timing.start),
      ...(timing.end ? { end: point(timing.end) } : {}),
    };
  return {
    kind: 'window',
    earliestStart: point(timing.earliestStart),
    latestStart: point(timing.latestStart),
  };
}

function promptTiming(view: DayEventView, locale: Locale, delay = 0): string {
  if (view.event.timing.kind === 'exact' && view.startMinutes !== null)
    return `${formatTime(view.startMinutes + delay)}${view.event.timing.kind === 'exact' && view.event.timing.start.dayOffset ? (locale === 'ko' ? ' (다음 날)' : ' (next day)') : ''}`;
  if (view.event.timing.kind === 'window') {
    const from = view.event.timing.earliestStart;
    const to = view.event.timing.latestStart;
    const nextDay = locale === 'ko' ? ' (다음 날)' : ' (next day)';
    return `${locale === 'ko' ? '시작 시간대' : 'start window'} ${from.time}${from.dayOffset ? nextDay : ''}–${to.time}${to.dayOffset ? nextDay : ''}`;
  }
  if (view.event.timing.kind === 'unscheduled')
    return view.event.timing.label || (locale === 'ko' ? '시간 미정' : 'time unset');
  return locale === 'ko' ? '시간 미정' : 'time unset';
}

function planBNote(view: { event: { planB?: { title: string } | null } }): string {
  return view.event.planB ? ` (${view.event.planB.title})` : '';
}

type PromptText = {
  currentTime: (now: string) => string;
  notToday: (date: string) => string;
  settledHeader: string;
  doneMark: string;
  skippedMark: string;
  nowHeader: string;
  remainingHeader: string;
  mustHeader: string;
  preferHeader: string;
  avoidHeader: string;
  fixedHeader: string;
  planBHeader: string;
  variableHeader: string;
  instructions: string[];
};

const koText: PromptText = {
  currentTime: (now) => `현재 시각: ${now}`,
  notToday: (date) => `(참고: 이 데이트는 오늘(${date})이 아니라 미리보기 상태입니다.)`,
  settledHeader: '완료/건너뜀:',
  doneMark: '완료',
  skippedMark: '건너뜀',
  nowHeader: '현재:',
  remainingHeader: '남은 일정:',
  mustHeader: 'Must (절대 지켜야 함):',
  preferHeader: 'Prefer (가능하면):',
  avoidHeader: 'Avoid (피하기):',
  fixedHeader: '고정 일정의 보호 조건 (AI 변경·해제 금지; 사용자 직접 편집 필요):',
  planBHeader: '현재 Plan B:',
  variableHeader: '현재 변수:',
  instructions: [
    '위 변수를 반영해 남은 일정만 수정해주세요. 완료/건너뜀 처리된 일정은 변경하지 마세요.',
    '목록의 순서는 계획의 명시적 순서입니다. 시간이 미정인 일정도 포함되며, 다음 일정 범위는 목록의 첫 항목입니다.',
    'target으로는 위에 적힌 id만 사용하세요. id를 절대 지어내지 마세요.',
    '고정 조건과 Must는 유지하세요. 보호된 time/place/content/delete/order 필드와 고정 예약은 변경·삭제·해제하거나 삭제 후 재생성하지 마세요. 일반 승인이나 AI 대화에서 변경 요청은 고정 해제 승인이 아닙니다. 해제가 필요하면 사용자가 앱에서 해당 일정을 직접 편집하도록 안내하세요.',
    '한 활동만 바꿔도 현재 위치→새 후보→다음 활동→고정 예약 전체 영향 동선을 고려하세요. 수정 가능한 target 범위 안에서만 변경하세요. 범위 밖 후속 일정과 고정 예약은 읽기 전용이며 move를 만들지 마세요. 범위 안에서 안전한 후보가 없으면 기존 일정을 유지하세요.',
    '겹침·체류·대기·걷는 부담·환승과 예약 도착 10분 여유를 고려하세요. AI travelMinutes·직선거리·route/status/verified 표시는 검증 근거가 아닙니다. 경로를 확인하지 못하면 검증 가능한 다른 후보를 우선 제안하고 없으면 기존 일정 유지. 예약 도착 불가가 확인된 후보는 승인받아도 적용하지 마세요.',
    '미정 날짜·시각, window, dayOffset, 체류 시간과 명시적 순서를 유지하세요. 모르는 시간을 가짜 HH:mm이나 0분으로 채우지 마세요. 기존 보호 설정을 수정하지 마세요. 사용자가 앱에서 직접 고정을 바꾼 경우 새 요청이 필요합니다.',
    '새 장소는 지도에서 검색되는 공개 이름을 place에 쓰세요. 영업·브레이크타임·라스트오더를 실제로 확인한 경우에만 확인됐다고 설명하고, 확인 못한 부분은 미확인이라고 표시하세요.',
    '',
    '최종 답안의 형식은 아래 DatePack Response 안내를 따르세요. 중간 대화에서는 JSON을 만들지 않아도 됩니다.',
  ],
};

const enText: PromptText = {
  currentTime: (now) => `Current time: ${now}`,
  notToday: (date) => `(Note: this date is on ${date}, so today is a preview, not the day itself.)`,
  settledHeader: 'Done / skipped:',
  doneMark: 'done',
  skippedMark: 'skipped',
  nowHeader: 'Happening now:',
  remainingHeader: 'Still ahead:',
  mustHeader: 'Must (non-negotiable):',
  preferHeader: 'Nice to have:',
  avoidHeader: 'Avoid:',
  fixedHeader:
    'Locked stops and protected conditions (AI cannot change or unlock; require direct user editing):',
  planBHeader: 'Plan B already on file:',
  variableHeader: 'What changed:',
  instructions: [
    'Replan only the stops that are still ahead. Leave completed and skipped stops untouched.',
    'The list follows the plan’s explicit order, including stops with no time set. The first listed stop is the Next stop scope.',
    'Use only the ids listed above as targets — never invent one.',
    'Keep protected conditions and Must rules. Never change, remove, unlock, or delete and recreate protected time/place/content/delete/order fields or fixed bookings. Ordinary approval or an AI chat request does not unlock them. If unlocking is needed, ask the user to edit that stop directly in the app.',
    'Even for one changed stop, consider the full affected journey: current location → candidate → next stop → fixed booking. Change only editable target ids. Downstream stops outside the scope and fixed bookings are read-only; do not emit moves for them. Keep the existing plan when no safe candidate fits the scope.',
    'Consider overlap, stay and wait durations, walking burden, transfers, and a 10-minute booking arrival buffer. AI travelMinutes, straight-line distance, or route/status/verified labels are not route evidence. Prefer another verifiable candidate when a route cannot be checked; otherwise keep the existing plan. Never apply a candidate confirmed unable to reach the booking, even after approval.',
    'Preserve undecided dates and times, windows, dayOffset, stay duration, and explicit order. Never fill unknown times with fake HH:mm or zero minutes. Never edit existing protection. Direct user changes to protection in the app require a new request.',
    'Use a public venue name searchable on maps in place for new venues. Claim checked opening hours, break time, and last order only when actually checked; explain everything else as unverified.',
    '',
    'Follow the DatePack Response envelope below for the final answer. You do not need to emit JSON during discussion.',
  ],
};
