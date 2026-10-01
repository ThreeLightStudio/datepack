import { describe, expect, it } from 'vitest';
import { buildPlanFromDraft, parsePlanDraft } from '../src/planDraft';
import { validateDatePack } from '../src/validate';
import { readDatePack as readAnyDatePack } from '../src/read';
import { writeDatePack } from '../src/write';
import { localizeIssues } from '../src/i18n/core';

const validDraft = {
  type: 'datepack.plan',
  version: 1,
  title: '성수 데이트',
  date: '2026-10-03',
  memo: '걷기 좋은 날',
  constraints: { must: ['20:00 예약'], prefer: ['커피'], avoid: ['매운 음식'] },
  events: [
    {
      title: '브런치',
      start: '11:00',
      end: '12:30',
      type: 'meal',
      place: '브런치 카페',
      note: '웨이팅 있음',
      travelMinutes: 10,
    },
    { title: '카페', start: '9:30', type: 'cafe', place: '브런치 카페' },
    { title: '공원 산책', start: '13:00' },
  ],
};

describe('parsePlanDraft', () => {
  it('accepts an empty plan only for the v2 review flow', () => {
    const empty = { ...validDraft, date: undefined, events: [] };
    expect(parsePlanDraft(JSON.stringify(empty)).ok).toBe(false);
    const parsed = parsePlanDraft(JSON.stringify(empty), { allowEmpty: true, allowUndated: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(buildPlanFromDraft(parsed.draft).plan.events).toEqual([]);
    expect(buildPlanFromDraft(parsed.draft).plan.date).toBeUndefined();
  });

  it('parses a valid draft, normalizing times', () => {
    const parsed = parsePlanDraft(JSON.stringify(validDraft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.title).toBe('성수 데이트');
    expect(parsed.draft.date).toBe('2026-10-03');
    expect(parsed.draft.memo).toBe('걷기 좋은 날');
    expect(parsed.draft.constraints?.must).toEqual(['20:00 예약']);
    expect(parsed.draft.events).toHaveLength(3);
    // "9:30" is normalized to canonical HH:mm
    expect(parsed.draft.events[1].start).toBe('09:30');
    expect(parsed.draft.events[0].end).toBe('12:30');
  });

  it('tolerates code fences and commentary around the JSON', () => {
    const wrapped = [
      '계획이 확정되었어요! 아래는 요청하신 JSON입니다.',
      '```json',
      JSON.stringify(validDraft),
      '```',
      '즐거운 데이트 되세요!',
    ].join('\n');
    const parsed = parsePlanDraft(wrapped);
    expect(parsed.ok).toBe(true);
  });

  it('rejects wrong type/version and malformed JSON with keyed errors', () => {
    const wrongType = parsePlanDraft(JSON.stringify({ ...validDraft, type: 'plan' }));
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok)
      expect(wrongType.errors.map((e) => e.key)).toContain('err.planDraft.wrongType');

    const badVersion = parsePlanDraft(JSON.stringify({ ...validDraft, version: 2 }));
    expect(badVersion.ok).toBe(false);
    if (!badVersion.ok)
      expect(badVersion.errors.map((e) => e.key)).toContain('err.planDraft.badVersion');

    const notJson = parsePlanDraft('안녕하세요! 계획을 말씀드릴게요.');
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.errors.map((e) => e.key)).toContain('err.planDraft.notJson');
  });

  it('rejects invalid plans, dates and events', () => {
    const cases: Array<[unknown, string]> = [
      [{ ...validDraft, title: '' }, 'err.planDraft.noTitle'],
      [{ ...validDraft, title: '   ' }, 'err.planDraft.noTitle'],
      [{ ...validDraft, date: '2026-13-40' }, 'err.planDraft.badDate'],
      [{ ...validDraft, events: 'x' }, 'err.planDraft.eventsArray'],
      [{ ...validDraft, events: [] }, 'err.planDraft.noEvents'],
      [
        { ...validDraft, events: [{ title: '브런치', start: '25:00' }] },
        'err.planDraft.startInvalid',
      ],
      [
        { ...validDraft, events: [{ title: '브런치', start: '11:00', end: '불명' }] },
        'err.planDraft.endInvalid',
      ],
      [
        { ...validDraft, events: [{ title: '브런치', start: '11:00', type: 'museum' }] },
        'err.planDraft.typeInvalid',
      ],
      [{ ...validDraft, events: [{ start: '11:00' }] }, 'err.planDraft.eventTitle'],
      [
        { ...validDraft, events: [{ title: '이동', start: '11:00', travelMinutes: -5 }] },
        'err.planDraft.travelInvalid',
      ],
      [
        { ...validDraft, events: [{ title: '이동', start: '11:00', place: 42 }] },
        'err.planDraft.placeString',
      ],
      [{ ...validDraft, constraints: { must: '예약' } }, 'err.planDraft.constraints'],
    ];
    for (const [raw, key] of cases) {
      const parsed = parsePlanDraft(JSON.stringify(raw));
      expect(parsed.ok, key).toBe(false);
      if (!parsed.ok)
        expect(
          parsed.errors.map((e) => e.key),
          key,
        ).toContain(key);
    }
  });
});

describe('buildPlanFromDraft', () => {
  it('preserves modern timing, duration, protection and array order through a portable roundtrip', async () => {
    const events = [
      { title: '미정', protectedFields: ['content', 'order'] },
      {
        title: '다음 날',
        timing: {
          kind: 'exact',
          start: { dayOffset: 1, time: '0:20' },
          end: { dayOffset: 1, time: '01:00' },
        },
        estimatedDurationMinutes: 40,
        protectedFields: ['time', 'place', 'content', 'delete', 'order'],
        place: '공개 식당',
      },
      {
        title: '시간대',
        timing: {
          kind: 'window',
          earliestStart: { dayOffset: 0, time: '23:40' },
          latestStart: { dayOffset: 1, time: '00:10' },
        },
        estimatedDurationMinutes: 20,
      },
      { title: '호환 시각', start: '9:30', end: '10:00' },
      { title: '시각 없음', timing: { kind: 'unscheduled', label: '만나서 정하기' } },
    ];
    const parsed = parsePlanDraft(
      JSON.stringify({ type: 'datepack.plan', version: 1, title: '미정 날짜', events }),
      { allowUndated: true },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const pack = buildPlanFromDraft(parsed.draft);
    expect(validateDatePack(pack).ok).toBe(true);
    expect(pack.plan.date).toBeUndefined();
    expect(pack.plan.events.map((e) => [e.title, e.order])).toEqual(
      events.map((e, i) => [e.title, i]),
    );
    expect(pack.plan.events[0].timing).toEqual({ kind: 'unscheduled' });
    expect(pack.plan.events[1]).toMatchObject({
      timing: { kind: 'exact', start: { dayOffset: 1, time: '00:20' } },
      estimatedDurationMinutes: 40,
      protectedFields: events[1].protectedFields,
    });
    expect(pack.plan.events[2].timing).toEqual(events[2].timing);
    const portable = await writeDatePack(pack, () => null);
    const read = await readDatePack(portable.blob);
    expect(read.pack.plan.date).toBeUndefined();
    expect(
      read.pack.plan.events.map((e) => [
        e.title,
        e.timing,
        e.protectedFields,
        e.estimatedDurationMinutes,
        e.order,
      ]),
    ).toEqual(
      pack.plan.events.map((e) => [
        e.title,
        e.timing,
        e.protectedFields,
        e.estimatedDurationMinutes,
        e.order,
      ]),
    );
    expect(read.pack.originalPlan.events).toEqual(read.pack.plan.events);
  });

  it('rejects contradictory, malformed and unsupported event data with localizable correction errors', () => {
    const invalidEvents = [
      { title: 'A', end: '11:00' },
      { title: 'A', start: '23:40', end: '00:10' },
      { title: 'A', start: '11:00', timing: { kind: 'unscheduled' } },
      {
        title: 'A',
        start: '11:00',
        timing: { kind: 'exact', start: { dayOffset: 0, time: '12:00' } },
      },
      {
        title: 'A',
        timing: {
          kind: 'window',
          earliestStart: { dayOffset: 1, time: '01:00' },
          latestStart: { dayOffset: 0, time: '23:00' },
        },
      },
      { title: 'A', timing: { kind: 'exact', start: { dayOffset: 2, time: '01:00' } } },
      { title: 'A', timing: { kind: 'unscheduled', latitude: 37.5 } },
      {
        title: 'A',
        timing: { kind: 'exact', start: { dayOffset: 0, time: '01:00', longitude: 127 } },
      },
      { title: 'A', estimatedDurationMinutes: -1 },
      { title: 'A', estimatedDurationMinutes: '20' },
      { title: 'A', protectedFields: ['fixed'] },
      { title: 'A', fixed: true },
      { title: 'A', route: { status: 'verified' } },
      { title: 'A', note: { text: 'ignored' } },
    ];
    for (const event of invalidEvents) {
      const parsed = parsePlanDraft(JSON.stringify({ ...validDraft, events: [event] }));
      expect(parsed.ok, JSON.stringify(event)).toBe(false);
      if (parsed.ok) continue;
      for (const locale of ['ko', 'en'] as const)
        expect(
          localizeIssues(locale, parsed.errors).every((message) => !message.startsWith('err.')),
        ).toBe(true);
    }
    expect(parsePlanDraft(JSON.stringify({ ...validDraft, routeStatus: 'verified' })).ok).toBe(
      false,
    );
    expect(
      parsePlanDraft(JSON.stringify({ ...validDraft, constraints: { must: [], hidden: true } })).ok,
    ).toBe(false);
  });

  it('accepts agreeing legacy aliases with explicit next-day timing without losing dayOffset', () => {
    const parsed = parsePlanDraft(
      JSON.stringify({
        ...validDraft,
        events: [
          {
            title: 'Late',
            start: '23:40',
            end: '0:10',
            timing: {
              kind: 'exact',
              start: { dayOffset: 0, time: '23:40' },
              end: { dayOffset: 1, time: '00:10' },
            },
          },
        ],
      }),
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(validateDatePack(buildPlanFromDraft(parsed.draft)).ok).toBe(true);
    expect(buildPlanFromDraft(parsed.draft).plan.events[0].timing).toMatchObject({
      end: { dayOffset: 1, time: '00:10' },
    });
  });

  it('builds a valid DatePack: generated ids, linked places, preserved event order', () => {
    const parsed = parsePlanDraft(JSON.stringify(validDraft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const pack = buildPlanFromDraft(parsed.draft);
    const { plan } = pack;

    expect(plan.id).toMatch(/^plan-/);
    expect(plan.title).toBe('성수 데이트');
    // Preserve the draft's explicit array order even when times are inverted.
    expect(
      plan.events.map((e) => [e.timing.kind === 'exact' ? e.timing.start.time : '', e.title]),
    ).toEqual([
      ['11:00', '브런치'],
      ['09:30', '카페'],
      ['13:00', '공원 산책'],
    ]);
    expect(plan.events.every((e) => e.id.startsWith('event-'))).toBe(true);

    // shared place string dedupes into one Place with a mapQuery
    expect(plan.places).toHaveLength(1);
    const place = plan.places![0];
    expect(place.name).toBe('브런치 카페');
    expect(place.mapQuery).toBe('브런치 카페');
    expect(plan.events[0].placeId).toBe(place.id);
    expect(plan.events[1].placeId).toBe(place.id);
    expect(plan.events[2].placeId).toBeUndefined();

    // the result passes full pack validation (manifest included)
    const result = validateDatePack(pack);
    expect(result.errors).toEqual([]);
    expect(pack.manifest.version).toBe('4.0');
  });
});

async function readDatePack(file: Blob) {
  const result = await readAnyDatePack(file);
  if (result.pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return { ...result, pack: result.pack };
}
