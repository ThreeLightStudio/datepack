import type { Locale } from '../../i18n/core';
import type { AiRequestIdentity } from './exchange';
import { responseContract } from './exchange';

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
  ko: `Plan JSON 형식:
{
  "type": "datepack.plan",
  "version": 1,
  "title": "데이트 이름",
  "date": "YYYY-MM-DD (optional; omit when undecided)",
  "memo": "한 줄 메모 (선택)",
  "constraints": { "must": ["..."], "prefer": ["..."], "avoid": ["..."] },
  "events": [
    { "title": "카페 가기", "start": "10:00", "end": "11:20", "type": "cafe",
      "place": "지도에서 검색되는 정확한 상호", "note": "메모 (선택)", "travelMinutes": 10 }
  ]
}
- type은 place / meal / cafe / transport / reservation / activity / note 중 하나입니다. (생략 시 place)
- start와 end는 HH:mm 형식이며, end는 생략할 수 있습니다.
- place는 지도에서 실제로 검색되는 정확한 장소명입니다. (생략 가능)
- 날짜가 미정이면 date를 생략해도 됩니다. id는 작성하지 마세요. 일정은 시간순으로 정렬해주세요.`,
  en: `Plan JSON shape:
{
  "type": "datepack.plan",
  "version": 1,
  "title": "A name for the date",
  "date": "YYYY-MM-DD (optional; omit when undecided)",
  "memo": "one-line note (optional)",
  "constraints": { "must": ["..."], "prefer": ["..."], "avoid": ["..."] },
  "events": [
    { "title": "Coffee", "start": "10:00", "end": "11:20", "type": "cafe",
      "place": "exact searchable venue name", "note": "note (optional)", "travelMinutes": 10 }
  ]
}
- type is one of place / meal / cafe / transport / reservation / activity / note (defaults to place).
- start and end are HH:mm; end may be omitted.
- place is the exact name that actually shows up on map searches. (optional)
- Omit date when undecided. Do not include ids. Order the events by time.`,
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
        ? `${input.startTime}부터`
        : input.endTime
          ? `${input.endTime}까지`
          : null;
  if (timeRange) {
    lines.push(`- ${locale === 'ko' ? '시간대' : 'Time window'}: ${timeRange}`);
  }
  if (input.notes?.trim()) {
    lines.push(`- ${locale === 'ko' ? '추가 요청' : 'Requests'}: ${input.notes.trim()}`);
  }
  lines.push('');

  lines.push(locale === 'ko' ? '진행 방식:' : 'How to proceed:');
  lines.push(
    locale === 'ko'
      ? '1. 먼저 취향, 예산, 이동 수단 등을 자연스럽게 질문하며 방향을 함께 정해주세요.'
      : '1. Start by asking about our tastes, budget, and transport — settle the direction together.',
  );
  lines.push(
    locale === 'ko'
      ? '2. 한 곳만 가는 계획이나 반나절 일정도 괜찮아요. 하루를 채우려고 일정을 늘리지 마세요. 방향이 아직 정해지지 않았다면 빈 events 배열의 초안도 만들 수 있어요.'
      : "2. One stop or a half-day outing is fine; don't pad the plan to fill a full day. If the direction is still undecided, an empty starter plan with events: [] is okay.",
  );
  lines.push(
    locale === 'ko'
      ? '3. 계획이 확정되면 아래 DatePack Response 봉투에 DatePack Plan JSON을 넣어 답해주세요. 대화 중간에는 JSON이 필요하지 않아요.'
      : '3. Once we have a plan, return the DatePack Plan JSON inside the DatePack Response envelope below. No JSON is needed during discussion.',
  );
  lines.push('');

  lines.push(
    locale === 'ko' ? '확정된 일정을 만들 때 반드시 확인해주세요:' : 'Before finalizing, verify:',
  );
  lines.push(
    locale === 'ko'
      ? '- 모든 장소는 네이버 지도·카카오맵·구글 지도에서 실제로 검색되는 정확한 상호로 적어주세요.'
      : '- Every place must be an exact, real venue name that is actually searchable on Naver Map, Kakao Map, or Google Maps.',
  );
  lines.push(
    locale === 'ko'
      ? '- 데이트 날짜(요일)의 계획 시간대에 실제로 영업하는지, 휴무일이 아닌지 확인해주세요.'
      : '- Check that each place is actually open during its planned time on that date (weekday) and not closed that day.',
  );
  lines.push(
    locale === 'ko'
      ? '- 카페·식당은 계획 시간이 브레이크타임이나 라스트오더에 걸리지 않는지 확인해주세요.'
      : "- For cafés and restaurants, make sure the planned time doesn't fall into break time or past last order.",
  );
  lines.push(
    locale === 'ko'
      ? '- 이동 시간은 대중교통/도보 기준으로 현실적으로 잡아주세요.'
      : '- Keep travel times realistic, based on public transit or walking.',
  );
  lines.push('');

  lines.push(PLAN_SCHEMA_HINT[locale]);
  if (input.identity) {
    lines.push('');
    lines.push(
      locale === 'ko'
        ? '최종 답안은 설명이나 마크다운 없이 아래 DatePack Response 봉투 하나로 반환하세요. result 안에는 위 Plan JSON을 넣으세요. 일정이 아직 정해지지 않았다면 events를 빈 배열로 둘 수 있습니다.'
        : 'Return one DatePack Response envelope with no commentary or markdown. Put the Plan JSON inside result. If no stops are settled yet, result.events may be an empty array.',
    );
    lines.push(
      responseContract(input.identity, {
        type: 'datepack.plan',
        version: 1,
        title: '...',
        ...(input.date ? { date: input.date } : {}),
        events: [],
      }),
    );
  }
  return lines.join('\n');
}
