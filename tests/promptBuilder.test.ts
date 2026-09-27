import { describe, expect, it } from 'vitest';
import type { DatePackRuntimeState, DatePlan } from '@datepack/core';
import { createEvent } from '@datepack/core';
import { buildAiPrompt } from '../src/features/ai/promptBuilder';

function makePlan(): DatePlan {
  return {
    id: 'p1',
    title: '대전 데이트',
    date: '2026-09-28',
    events: [
      createEvent({ id: 'event-station', title: '대전역 도착', start: '09:34', type: 'transport' }),
      createEvent({ id: 'event-cafe', title: '카페', start: '15:00', end: '16:00', type: 'cafe' }),
      createEvent({
        id: 'event-train',
        title: '기차 타기',
        start: '22:00',
        type: 'transport',
        fixed: true,
      }),
    ],
    places: [],
  };
}

function runtimeWith(
  events: Record<string, { status?: 'pending' | 'completed' | 'skipped'; delay?: number }>,
): DatePackRuntimeState {
  return {
    planId: 'p1',
    updatedAt: '2026-09-28T14:00:00.000Z',
    events: Object.fromEntries(
      Object.entries(events).map(([eventId, state]) => [
        eventId,
        {
          eventId,
          status: state.status ?? 'pending',
          delayedByMinutes: state.delay ?? 0,
          activePlan: 'A' as const,
        },
      ]),
    ),
  };
}

// 2026-09-28 14:00 — the plan's own date, so the day view is live.
const NOW = new Date(2026, 8, 28, 14, 0);

describe('buildAiPrompt', () => {
  it('lists remaining stops with their ids so the AI can target them', () => {
    const prompt = buildAiPrompt({
      plan: makePlan(),
      runtime: null,
      situationId: 'rain',
      locale: 'ko',
      now: NOW,
    });
    expect(prompt).toContain('- 15:00–16:00 카페 (id: event-cafe, cafe)');
    expect(prompt).toContain('- 22:00 기차 타기 (id: event-train, transport, 고정)');
  });

  it('never exposes ids for settled stops — they are not targets', () => {
    const prompt = buildAiPrompt({
      plan: makePlan(),
      runtime: runtimeWith({ 'event-station': { status: 'completed' } }),
      situationId: 'rain',
      locale: 'ko',
      now: NOW,
    });
    const settledLine = prompt.split('\n').find((l) => l.includes('대전역 도착'));
    expect(settledLine).toBeDefined();
    expect(settledLine).not.toContain('id:');
  });

  it('shows effective times for stops that slipped, with the delay tagged', () => {
    const prompt = buildAiPrompt({
      plan: makePlan(),
      runtime: runtimeWith({ 'event-cafe': { delay: 15 } }),
      situationId: 'rain',
      locale: 'ko',
      now: NOW,
    });
    expect(prompt).toContain('- 15:15–16:15 카페 (id: event-cafe, cafe, 지연 15분)');
  });

  it('documents the fixed field and the id rule in the schema hint', () => {
    const prompt = buildAiPrompt({
      plan: makePlan(),
      runtime: null,
      situationId: 'rain',
      locale: 'ko',
      now: NOW,
    });
    expect(prompt).toContain('fixed(true|false)');
    expect(prompt).toContain('위 목록에 없는 id는 절대 사용할 수 없습니다');
  });

  it('keeps the cascade and anchoring rules in the instructions', () => {
    const prompt = buildAiPrompt({
      plan: makePlan(),
      runtime: null,
      situationId: 'rain',
      locale: 'ko',
      now: NOW,
    });
    expect(prompt).toContain('영향받는 모든 후속 일정의 move도 빠짐없이 포함하세요');
    expect(prompt).toContain('fixed: true');
    const en = buildAiPrompt({
      plan: makePlan(),
      runtime: null,
      situationId: 'rain',
      locale: 'en',
      now: NOW,
    });
    expect(en).toContain('fixed (true|false)');
    expect(en).toContain('Never use an id that is not in the list above');
  });
});
