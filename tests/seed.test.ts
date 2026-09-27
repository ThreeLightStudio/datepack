import { describe, expect, it } from 'vitest';
import { createSeoulSeed } from '../src/seed/seoul';
import { validateDatePack } from '@datepack/core';
import { buildAiPrompt, SITUATIONS } from '../src/features/ai/promptBuilder';
import { format } from '../src/i18n/core';
import { emptyRuntime } from '../src/features/day/dayRuntime';

describe('Seoul seed', () => {
  const SCHEDULE = [
    '09:30',
    '10:10',
    '12:00',
    '13:20',
    '14:50',
    '16:30',
    '17:30',
    '19:00',
    '22:00',
  ];

  it('is a valid pack in every locale with a locale-independent schedule', () => {
    for (const locale of ['ko', 'en'] as const) {
      const { pack } = createSeoulSeed(locale);
      const result = validateDatePack(pack);
      expect(result.errors).toEqual([]);
      expect(pack.plan.events.map((e) => e.start)).toEqual(SCHEDULE);
      expect(pack.plan.title).toBe(locale === 'ko' ? '서울 클래식 데이트' : 'Classic Seoul Day');
      // map queries stay Korean in both locales (map search keys, not copy)
      expect(pack.plan.places?.map((p) => p.mapQuery)).toContain('경복궁 서울');
    }
  });

  it('includes a Plan B, constraints, fixed events and seed images', () => {
    const { pack, blobs } = createSeoulSeed('ko');
    const planB = pack.plan.events.find((e) => e.planB);
    expect(planB?.planB?.title).toBeTruthy();
    expect(planB?.planB?.replacementEventIds).toContain('event-gwangjang-2');
    expect(pack.plan.constraints?.must?.length).toBeGreaterThan(0);
    expect(pack.plan.constraints?.avoid?.length).toBeGreaterThan(0);
    expect(pack.plan.events.filter((e) => e.fixed).map((e) => e.id)).toEqual(['event-departure']);
    expect(pack.plan.coverAssetId).toBeTruthy();
    expect(pack.assets).toHaveLength(2);
    expect(blobs).toHaveLength(2);
  });
});

describe('AI prompt builder', () => {
  it('contains the required sections from the spec', () => {
    const { pack } = createSeoulSeed('ko');
    const prompt = buildAiPrompt({
      plan: pack.plan,
      runtime: emptyRuntime(pack.plan.id),
      situationId: 'rain',
      locale: 'ko',
      now: new Date(2026, 8, 28, 14, 42),
    });

    expect(prompt).toContain('현재 시각: 14:42');
    expect(prompt).toContain('현재 변수');
    expect(prompt).toContain('비가 오기 시작');
    expect(prompt).toContain('Must');
    expect(prompt).toContain('경복궁 방문');
    expect(prompt).toContain('고정 일정');
    expect(prompt).toContain('22:00 서울역 출발');
    expect(prompt).toContain('datepack.patch');
    expect(prompt).toContain('insertAfter');
    expect(prompt).toContain('완료/건너뜀 처리된 일정은 변경하지 마세요');
    // new/relocated stops must be verified against the real world
    expect(prompt).toContain('지도에서 검색되는 장소명');
    expect(prompt).toContain('브레이크타임');
    // the patch can only target ids the prompt actually listed
    expect(prompt).toContain('id: event-');
  });

  it('uses custom input verbatim', () => {
    const { pack } = createSeoulSeed('ko');
    const prompt = buildAiPrompt({
      plan: pack.plan,
      runtime: null,
      situationId: 'custom',
      customInput: '기차가 30분 지연되고 있어요',
      locale: 'ko',
      now: new Date(2026, 8, 28, 14, 42),
    });
    expect(prompt).toContain('기차가 30분 지연되고 있어요');
  });

  it('regenerates a natural English prompt (not a translation)', () => {
    const { pack } = createSeoulSeed('en');
    const prompt = buildAiPrompt({
      plan: pack.plan,
      runtime: emptyRuntime(pack.plan.id),
      situationId: 'rain',
      locale: 'en',
      now: new Date(2026, 8, 28, 14, 42),
    });
    expect(prompt).toContain('Current time: 14:42');
    expect(prompt).toContain('it suddenly started raining');
    expect(prompt).toContain('Still ahead:');
    expect(prompt).toContain('Locked stops');
    expect(prompt).toContain('searchable on maps');
    expect(prompt).toContain('break time');
    expect(prompt).not.toContain('현재 시각');
    // situation labels are regenerated per language too
    const rain = SITUATIONS.find((s) => s.id === 'rain')!;
    expect(format('en', rain.labelKey)).toBe('It started raining');
    expect(format('ko', rain.labelKey)).toBe('비가 와요');
  });
});
