import type { Locale } from '../../i18n/core';
import type { AiRequestIdentity } from './exchange';
import { conversationGuide, resultFooterGuide } from './conversation';

export type CreatePromptInput = {
  /** Where the date happens — city, neighborhood, venue… */
  region: string;
  date?: string; // YYYY-MM-DD; omit while undecided
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  /** Free-form requests: tastes, budget, transport, party size… */
  notes?: string;
  locale?: Locale;
  identity?: AiRequestIdentity;
};

const PLAN_SCHEMA_HINT: Record<Locale, string> = {
  ko: `result는 datepack.plan version 1입니다. title과 events 배열이 필요합니다. date는 YYYY-MM-DD이며 날짜 미정이면 생략하세요. memo와 constraints의 must/prefer/avoid 문자열 배열은 선택입니다.
- events는 사용자가 선택한 명시적 순서 그대로 적으세요. 시간순으로 재정렬하지 마세요. 한 곳이나 반나절도 괜찮고, 방향이 정해지지 않았다면 빈 events 배열도 가능합니다.
- 일정에는 title이 필요합니다. type은 place/meal/cafe/transport/reservation/activity/note 중 하나이며 기본값은 place입니다. place는 지도에서 검색되는 공개 장소명, note는 메모입니다. id는 앱이 만듭니다.
- start/end는 선택 HH:mm입니다. 시각 미정이면 생략하세요. timing은 {"kind":"unscheduled"}, {"kind":"exact","start":{"dayOffset":0,"time":"18:00"},"end":{"dayOffset":0,"time":"19:00"}}, 또는 {"kind":"window","earliestStart":{"dayOffset":0,"time":"23:40"},"latestStart":{"dayOffset":1,"time":"00:20"}}입니다. unscheduled에는 선택 label이 가능합니다.
- dayOffset은 0 또는 1입니다. exact의 end는 선택이며, end나 window 상한은 시작보다 빠를 수 없습니다. 다음 날은 dayOffset:1로 표시하세요. start/end와 timing을 함께 쓰면 exact 시각이 일치해야 합니다. 날짜·시각을 추측하거나 오늘로 바꾸지 마세요.
- estimatedDurationMinutes는 선택 체류 시간입니다. travelMinutes는 선택 이동 추정치이며 경로 검증 근거가 아닙니다. 모르면 생략하고 0으로 채우지 마세요.
- 사용자가 확정한 새 일정의 고정 조건은 protectedFields 배열(time/place/content/delete/order)로 지정하세요. 일반적인 추천 승인은 예약 사실이나 고정 조건을 새로 만들지 않습니다. fixed 등 안내에 없는 필드는 쓰지 마세요.`,
  en: `result is datepack.plan version 1. title and an events array are required. date is optional YYYY-MM-DD; omit it when undecided. memo and constraints with must/prefer/avoid string arrays are optional.
- Keep events in the user's explicit chosen order, without sorting by time. One stop or a half-day is fine; an empty events array is also allowed while the direction is undecided.
- Each event needs title. type is place/meal/cafe/transport/reservation/activity/note (default place). place is a public, map-searchable venue name; note is optional text. The app assigns ids.
- start/end are optional HH:mm. Omit them when time is unset. timing supports {"kind":"unscheduled"}, {"kind":"exact","start":{"dayOffset":0,"time":"18:00"},"end":{"dayOffset":0,"time":"19:00"}}, or {"kind":"window","earliestStart":{"dayOffset":0,"time":"23:40"},"latestStart":{"dayOffset":1,"time":"00:20"}}. unscheduled may include a label.
- dayOffset is 0 or 1. exact end is optional; end and the window's upper bound cannot precede the start. Use dayOffset:1 for the next day. If start/end and timing coexist, their exact times must agree. Do not invent dates or times or substitute today.
- estimatedDurationMinutes is an optional stay duration. travelMinutes is an optional estimate, never route evidence. Omit unknown durations instead of inserting zero.
- Use protectedFields (time/place/content/delete/order) for new stops with conditions explicitly confirmed by the user. Ordinary approval does not invent bookings or locks. Do not use fields outside this guide, including fixed.`,
};

function weekdayLabel(date: string, locale: Locale): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { weekday: 'long' }).format(
    parsed,
  );
}

export function buildCreatePrompt(input: CreatePromptInput): string {
  const locale = input.locale ?? 'ko';
  const lines: string[] = [];

  lines.push(
    locale === 'ko'
      ? '아래 조건으로 데이트 계획을 저와 함께 논의하며 만들어주는 데이트 플래너가 되어주세요.'
      : "You're my date planner — help me shape an outing by discussing it together.",
  );
  lines.push('');

  lines.push(locale === 'ko' ? '조건:' : 'The brief:');
  lines.push(
    input.date
      ? `- ${locale === 'ko' ? '날짜' : 'Date'}: ${input.date} (${weekdayLabel(input.date, locale)})`
      : `- ${locale === 'ko' ? '날짜' : 'Date'}: ${locale === 'ko' ? '미정' : 'Undecided'}`,
  );
  lines.push(`- ${locale === 'ko' ? '지역' : 'Area'}: ${input.region}`);
  const timeRange =
    input.startTime && input.endTime
      ? `${input.startTime} ~ ${input.endTime}`
      : input.startTime
        ? `${input.startTime}${locale === 'ko' ? '부터' : ' onward'}`
        : input.endTime
          ? `${locale === 'ko' ? '' : 'until '}${input.endTime}${locale === 'ko' ? '까지' : ''}`
          : null;
  if (timeRange) {
    lines.push(`- ${locale === 'ko' ? '시간대' : 'Time window'}: ${timeRange}`);
  }
  if (input.notes?.trim()) {
    lines.push(`- ${locale === 'ko' ? '추가 요청' : 'Requests'}: ${input.notes.trim()}`);
  }
  lines.push('');

  lines.push(conversationGuide(locale));
  lines.push('');
  lines.push(
    locale === 'ko'
      ? '제안 근거: 네이버 지도·카카오맵·구글 지도에서 실제로 검색되는 장소명과 해당 날짜·시간의 영업·브레이크타임·라스트오더를 확인할 수 있을 때만 확인했다고 표현하세요. 조회할 수 없으면 미확인이라고 설명하세요. 날짜 미정이면 영업 여부를 단정하지 마세요. 이동 시간은 도보와 대중교통의 시간·걷는 부담·환승을 비교하고, 차량·택시는 사용자가 요청할 때만 포함하세요. AI 추정이나 직선거리로 예약 도착을 검증했다고 말하지 마세요. 검증 가능한 다른 후보를 우선 제안하고, 없으면 기존 선택을 유지하세요.'
      : 'Proposal evidence: only claim verified map-searchable venues, opening hours, break time, and last order when you can actually check them on Naver Map, Kakao Map, or Google Maps for the planned date and time. Otherwise explain they are unverified. An undecided date cannot establish opening hours. Compare walking and transit by time, walking burden, and transfers; include car or taxi only on request. AI estimates or straight-line distance cannot verify arrival for a booking. Prefer another verifiable candidate; if none exists, keep the current choice.',
  );
  lines.push('');
  lines.push(PLAN_SCHEMA_HINT[locale]);
  lines.push('');
  lines.push(
    resultFooterGuide(
      locale,
      {
        type: 'datepack.plan',
        version: 1,
        title: '...',
        ...(input.date ? { date: input.date } : {}),
        events: [],
      },
      input.identity,
    ),
  );
  return lines.join('\n');
}
