import type { DatePackRuntimeState, DatePlan } from '@datepack/core';
import type { LiveContext } from '../../storage/indexedDb';
import { getRemainingPlanEvents } from '../day/dayRuntime';
import { formatTime, nowLabel, todayISO } from '@datepack/core';
import { computeDayContext, type DayEventView } from '../day/dayRuntime';
import type { Locale } from '../../i18n/core';
import type { MessageKey } from '../../i18n/ko';
import type { AiRequestIdentity } from './exchange';
import { responseContract } from './exchange';

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
- replace의 value로 쓸 수 있는 필드: title, start, end, type(place|meal|cafe|transport|reservation|activity|note), note, travelMinutes, placeId, fixed(true|false).
- start와 end는 24시간 HH:mm 형식입니다. (예: "09:30")
- travelMinutes는 그 일정 장소까지 가는 이동 시간(분)입니다.
- insertBefore/insertAfter에는 title과 start(HH:mm)가 필요합니다. insertFirst는 title만으로 추가할 수 있습니다. 장소가 새로 생기면 place에 장소 이름도 적으세요.`,
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
- Allowed replace value fields: title, start, end, type (place|meal|cafe|transport|reservation|activity|note), note, travelMinutes, placeId, fixed (true|false).
- start and end use 24-hour HH:mm (e.g. "09:30").
- travelMinutes is the travel time, in minutes, to reach that stop's place.
- insertBefore/insertAfter need a title and start (HH:mm). insertFirst needs a title; its start may be omitted. Include place with a searchable venue name when adding a place.`,
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
  const isToday = input.plan.date === todayISO(now);
  const L = locale === 'ko' ? koText : enText;

  const lines: string[] = [];
  lines.push(
    locale === 'ko'
      ? '도보와 대중교통을 균형 있게 비교하되 확인되지 않은 대중교통을 도보보다 낫다고 단정하지 마세요. 자동차·택시는 사용자가 명시한 경우에만 제안하세요. AI가 적은 이동 시간이나 verified 표시는 경로 근거가 아닙니다.'
      : 'Compare walking and transit in balance; do not favor unverified transit. Suggest car or taxi only when explicitly requested. AI travel estimates or a verified label are not route evidence.',
  );
  lines.push(L.currentTime(nowLabel(now)));
  if (!isToday)
    lines.push(
      input.plan.date
        ? L.notToday(input.plan.date)
        : locale === 'ko'
          ? '계획 날짜 미정'
          : 'Plan date undecided',
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
          ? '이 위치로 방문·완료나 경로 검증을 추정하지 마세요.'
          : 'Do not infer visits, completion or verified routes from this location.',
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
    lines.push(stopLine(ctx.current, locale));
    lines.push('');
  }

  if (remaining.length > 0) {
    lines.push(L.remainingHeader);
    for (const view of remaining) {
      if (ctx.current && view.event.id === ctx.current.event.id) continue;
      lines.push(stopLine(view, locale));
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
      for (const view of readOnly) lines.push(stopLine(view, locale));
      lines.push('');
    }
  }

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
  if (input.identity) {
    lines.push(
      locale === 'ko'
        ? '최종 답안은 설명이나 마크다운 없이 DatePack Response 봉투 하나로 반환하세요. result에는 아래 Patch JSON을 넣으세요. 새 장소를 제안할 때 place에 지도 검색 이름을 적고, 실제 영업 여부를 확인하지 못하면 미확인이라고 표시하세요.'
        : 'Return one DatePack Response envelope with no commentary or markdown. Put the Patch JSON below inside result. For a new stop, include place as a searchable venue name; mark opening hours unverified when you could not confirm them.',
    );
    lines.push(
      responseContract(input.identity, { type: 'datepack.patch', version: 1, operations: [] }),
    );
    lines.push('');
  }
  lines.push(PATCH_SCHEMA_HINT[locale]);
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
function stopLine(view: DayEventView, locale: Locale): string {
  const delay = view.delayedByMinutes;
  const start = promptTiming(view, locale, delay);
  const end =
    view.endMinutes !== null
      ? `–${formatTime(view.endMinutes + delay)}${view.event.timing.kind === 'exact' && view.event.timing.end?.dayOffset ? (locale === 'ko' ? ' (다음 날)' : ' (next day)') : ''}`
      : '';
  const tags = [`id: ${view.event.id}`, view.event.type];
  if (view.event.protectedFields?.length) tags.push(locale === 'ko' ? '보호됨' : 'protected');
  if (delay > 0) tags.push(locale === 'ko' ? `지연 ${delay}분` : `delayed ${delay} min`);
  return `- ${start}${end} ${view.event.title} (${tags.join(', ')})${planBNote(view)}`;
}

function promptTiming(view: DayEventView, locale: Locale, delay = 0): string {
  if (view.startMinutes !== null)
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
  fixedHeader: '고정 일정 (사용자가 확정 — 사용자가 명시적으로 요청할 때만 변경):',
  planBHeader: '현재 Plan B:',
  variableHeader: '현재 변수:',
  instructions: [
    '위 변수를 반영해 남은 일정만 수정해주세요. 완료/건너뜀 처리된 일정은 변경하지 마세요.',
    '목록의 순서는 계획의 명시적 순서입니다. 시간이 미정인 일정도 포함되며, 다음 일정 범위는 목록의 첫 항목입니다.',
    'target으로는 위에 적힌 id만 사용하세요. id를 절대 지어내지 마세요.',
    '고정 일정과 Must 조건은 유지해주세요. 다만 사용자가 고정 일정 자체의 변경(재예매 등)을 요청하면 그대로 반영하고, 고정 일정이 당겨지거나 늦어지면 나머지 일정도 그에 맞게 재배치하세요.',
    '한 일정의 시간 변경이 다른 일정에 영향을 준다면, 영향받는 모든 후속 일정의 move도 빠짐없이 포함하세요. 일부만 고치고 끝내지 마세요.',
    '수정 후 일정끼리 겹치면 안 되고, 각 일정은 직전 일정 종료 + 이동 시간(travelMinutes) 이후에 시작해야 합니다.',
    '사용자가 특정 장소나 시간을 확정했다고 하면 해당 일정을 fixed: true로 지정하고, 그 일정을 중심으로 나머지 일정을 배치하세요.',
    '새로 추가하거나 시간을 옮긴 일정은 실제로 지도에서 검색되는 장소명으로, 해당 시간에 영업 중이고 브레이크타임이나 라스트오더에 걸리지 않는지 확인해주세요.',
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
  fixedHeader: 'Locked stops (user-confirmed — change only if the user explicitly asks):',
  planBHeader: 'Plan B already on file:',
  variableHeader: 'What changed:',
  instructions: [
    'Replan only the stops that are still ahead. Leave completed and skipped stops untouched.',
    'The list follows the plan’s explicit order, including stops with no time set. The first listed stop is the Next stop scope.',
    'Use only the ids listed above as targets — never invent one.',
    'Keep the locked stops and the Must rules. If the user explicitly asks to change a locked stop itself (e.g. a rebooked train), apply that — and when a locked stop moves earlier or later, reschedule the stops around it to match.',
    'When one stop shifts and others are affected, include a move for every affected later stop — never leave any out.',
    'After replanning, no stops may overlap, and each stop must start after the previous stop ends plus its travel time (travelMinutes).',
    'When the user says a place or time is confirmed, mark that stop fixed: true and lay out the rest of the day around it.',
    'Any stop you add or reschedule must use a real venue name searchable on maps, actually be open at its new time, and steer clear of break time and last order.',
    '',
    'Follow the DatePack Response envelope below for the final answer. You do not need to emit JSON during discussion.',
  ],
};
