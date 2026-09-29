import { describe, expect, it } from 'vitest';
import type { DatePlan } from '@datepack/core';
import { createEvent } from '@datepack/core';
import {
  addNextActivity,
  promoteCandidateToNextActivity,
} from '../src/features/day/nextDestination';

function plan(): DatePlan {
  return {
    id: 'p',
    title: 'Day out',
    date: '2026-09-28',
    events: [createEvent({ id: 'existing', title: 'Dinner', order: 0 })],
    candidates: [
      { id: 'idea', title: 'Bookstore', type: 'place', note: 'Browse together' },
      { id: 'excluded', title: 'Closed gallery', excluded: true },
    ],
  };
}

describe('next destination', () => {
  it('promotes a chosen candidate as an unscheduled plan activity', () => {
    const p = plan();
    const event = promoteCandidateToNextActivity(p, 'idea');
    expect(event).toMatchObject({
      title: 'Bookstore',
      type: 'place',
      note: 'Browse together',
      timing: { kind: 'unscheduled' },
      order: 1,
    });
    expect(p.events).toContain(event);
    expect(p.candidates?.map((candidate) => candidate.id)).toEqual(['excluded']);
  });

  it('adds a directly entered activity to the plan without inventing a time', () => {
    const p = plan();
    const event = addNextActivity(p, '  Stop by a bookstore  ', 'place');
    expect(event).toMatchObject({
      title: 'Stop by a bookstore',
      type: 'place',
      timing: { kind: 'unscheduled' },
      order: 1,
    });
    expect(p.events).toContain(event);
  });

  it('does not promote excluded or missing ideas', () => {
    const p = plan();
    expect(promoteCandidateToNextActivity(p, 'excluded')).toBeNull();
    expect(promoteCandidateToNextActivity(p, 'missing')).toBeNull();
    expect(p.events).toHaveLength(1);
  });
});
