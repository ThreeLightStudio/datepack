import { describe, expect, it } from 'vitest';
import { buildPlanFromDraft, parsePlanDraft } from '../src/datepack/planDraft';
import { validateDatePack } from '../src/datepack/validate';

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
  it('builds a valid DatePack: generated ids, linked places, sorted events', () => {
    const parsed = parsePlanDraft(JSON.stringify(validDraft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const pack = buildPlanFromDraft(parsed.draft);
    const { plan } = pack;

    expect(plan.id).toMatch(/^plan-/);
    expect(plan.title).toBe('성수 데이트');
    // events sorted by start: 09:30 카페 → 11:00 브런치 → 13:00 공원
    expect(plan.events.map((e) => [e.start, e.title])).toEqual([
      ['09:30', '카페'],
      ['11:00', '브런치'],
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
    expect(pack.manifest.version).toBe('2.0');
  });
});
