import { describe, expect, it } from 'vitest';
import type { DatePackRuntimeState, DatePlan } from '@datepack/core';
import { createEvent } from '@datepack/core';
import { buildAiPrompt } from '../src/features/ai/promptBuilder';

const plan: DatePlan = {
  id: 'p',
  title: 'Day out',
  date: '2026-09-28',
  events: [
    createEvent({
      id: 'late-lunch',
      title: 'Late lunch',
      timing: { kind: 'exact', start: { dayOffset: 0, time: '12:00' } },
      order: 0,
    }),
  ],
};

function runtime(includeInRemaining: boolean): DatePackRuntimeState {
  return {
    planId: plan.id,
    updatedAt: '2026-09-28T14:00:00.000Z',
    events: { 'late-lunch': { eventId: 'late-lunch', status: 'pending', includeInRemaining } },
  };
}

describe('explicit re-inclusion in AI planning', () => {
  it('adds a user-selected elapsed activity to the remaining plan section', () => {
    const prompt = buildAiPrompt({
      plan,
      runtime: runtime(true),
      situationId: 'rain',
      locale: 'en',
      now: new Date('2026-09-28T14:00:00+09:00'),
    });
    expect(prompt).toContain('Still ahead:');
    expect(prompt).toContain('id: late-lunch');
    expect(prompt).not.toContain('(done)');
  });

  it('continues to omit elapsed activities unless the user opts them back in', () => {
    const prompt = buildAiPrompt({
      plan,
      runtime: runtime(false),
      situationId: 'rain',
      locale: 'en',
      now: new Date('2026-09-28T14:00:00+09:00'),
    });
    expect(prompt).not.toContain('id: late-lunch');
  });
});
