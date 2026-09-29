import { describe, expect, it } from 'vitest';
import { createEvent } from '@datepack/core';
import type { DatePlan } from '@datepack/core';
import { getAiScopeEventIds, buildAiPrompt } from '../src/features/ai/promptBuilder';

function makeUndatedPlan(): DatePlan {
  return {
    id: 'undated-plan',
    title: 'A date without a day yet',
    events: [
      createEvent({ id: 'unscheduled-first', order: 0, title: 'Walk around the market' }),
      createEvent({ id: 'timed-second', order: 1, title: 'Coffee', start: '11:30' }),
    ],
  };
}

describe('AI replan scope', () => {
  it('includes unscheduled activities in explicit plan order for next and remaining scope', () => {
    const plan = makeUndatedPlan();
    const now = new Date('2026-09-29T08:00:00');
    expect(getAiScopeEventIds(plan, null, 'next-change', now)).toEqual(['unscheduled-first']);
    expect(getAiScopeEventIds(plan, null, 'remaining-change', now)).toEqual([
      'unscheduled-first',
      'timed-second',
    ]);
  });

  it('includes an unscheduled stop and its ID in the generated scoped prompt', () => {
    const plan = makeUndatedPlan();
    const scopeEventIds = getAiScopeEventIds(
      plan,
      null,
      'next-change',
      new Date('2026-09-29T08:00:00'),
    );
    const prompt = buildAiPrompt({
      plan,
      runtime: null,
      situationId: 'rain',
      locale: 'en',
      now: new Date('2026-09-29T08:00:00'),
      scopeEventIds,
    });

    expect(prompt).toContain('time unset');
    expect(prompt).toContain('id: unscheduled-first');
    expect(prompt).not.toContain('id: timed-second');
  });

  it('tells the AI to use the explicit no-target first-stop operation for an empty plan', () => {
    const prompt = buildAiPrompt({
      plan: { id: 'empty-plan', title: 'New date', events: [] },
      runtime: null,
      situationId: 'rain',
      locale: 'en',
      scopeEventIds: [],
    });
    expect(prompt).toContain('use one insertFirst operation with no target');
    expect(prompt).toContain('Use insertFirst only when the plan has no stops');
  });
});
