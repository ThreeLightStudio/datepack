import { describe, expect, it } from 'vitest';
import { buildCreatePrompt } from '../src/features/ai/createPromptBuilder';

describe('create prompt builder', () => {
  it('embeds region, date, weekday, time window and free-form notes', () => {
    const prompt = buildCreatePrompt({
      region: '서울 성수동',
      date: '2026-10-03',
      startTime: '10:00',
      endTime: '19:00',
      notes: '걷기 좋은 코스로 부탁해요',
      locale: 'ko',
    });
    expect(prompt).toContain('서울 성수동');
    expect(prompt).toContain('2026-10-03');
    expect(prompt).toContain('토요일');
    expect(prompt).toContain('10:00 ~ 19:00');
    expect(prompt).toContain('걷기 좋은 코스로 부탁해요');
  });

  it('requires the AI to verify map-searchable venues, opening hours and break time', () => {
    const prompt = buildCreatePrompt({ region: '서울 성수동', date: '2026-10-03', locale: 'ko' });
    expect(prompt).toContain('네이버 지도');
    expect(prompt).toContain('실제로 검색되는');
    expect(prompt).toContain('영업');
    expect(prompt).toContain('브레이크타임');
    expect(prompt).toContain('라스트오더');
    expect(prompt).toContain('이동 시간');
  });

  it('asks the AI to discuss first, then answer with a datepack.plan JSON only', () => {
    const prompt = buildCreatePrompt({ region: '서울 성수동', date: '2026-10-03', locale: 'ko' });
    expect(prompt).toContain('datepack.plan');
    expect(prompt).toContain('"type"');
    expect(prompt).toContain('"version": 1');
    expect(prompt).toContain('events');
    expect(prompt).toContain('질문');
  });

  it('regenerates a natural English prompt (not a translation)', () => {
    const prompt = buildCreatePrompt({
      region: 'Seongsu-dong, Seoul',
      date: '2026-10-03',
      startTime: '10:00',
      endTime: '19:00',
      locale: 'en',
    });
    expect(prompt).toContain('Seongsu-dong, Seoul');
    expect(prompt).toContain('Saturday');
    expect(prompt).toContain('Kakao Map');
    expect(prompt).toContain('break time');
    expect(prompt).toContain('datepack.plan');
    expect(prompt).not.toContain('토요일');
    expect(prompt).not.toContain('브레이크타임');
  });

  it('allows a one-stop, half-day, or empty starter plan in English', () => {
    const prompt = buildCreatePrompt({ region: 'Seoul', locale: 'en' });
    expect(prompt).toContain('One stop or a half-day outing is fine');
    expect(prompt).toContain('empty starter plan with events: [] is okay');
    expect(prompt).not.toContain('build a full-day date plan');
    expect(prompt).toContain('Date: Undecided');
  });
});
