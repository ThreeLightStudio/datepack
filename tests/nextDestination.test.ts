import { describe, expect, it } from 'vitest';
import type { DatePackRuntimeState, DatePlan } from '@datepack/core';
import { createEvent } from '@datepack/core';
import { computeDayContext } from '../src/features/day/dayRuntime';
import {
  addNextActivity,
  promoteCandidateToNextActivity,
  selectableNextEvents,
  resolveDayDestination,
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

  it('reuses an activity after a retry when the plan write already succeeded', () => {
    const p = plan();
    const first = addNextActivity(p, 'Bookstore', 'place', 'next-retry');
    const retry = addNextActivity(p, 'Bookstore', 'place', 'next-retry');
    expect(retry).toBe(first);
    expect(p.events.filter((event) => event.id === 'next-retry')).toHaveLength(1);
  });

  it('filters completed and skipped events from destination choices', () => {
    const p = plan();
    p.events.push(createEvent({ id: 'skipped', title: 'Gallery', order: 1 }));
    const runtime: DatePackRuntimeState = {
      planId: p.id,
      updatedAt: new Date().toISOString(),
      events: {
        existing: { eventId: 'existing', status: 'completed' },
        skipped: { eventId: 'skipped', status: 'skipped' },
      },
    };
    expect(selectableNextEvents(p.events, runtime).map((event) => event.id)).toEqual([]);
  });

  it('does not promote excluded or missing ideas', () => {
    const p = plan();
    expect(promoteCandidateToNextActivity(p, 'excluded')).toBeNull();
    expect(promoteCandidateToNextActivity(p, 'missing')).toBeNull();
    expect(p.events).toHaveLength(1);
  });
  it('uses the explicit chosen destination for both return actions and Today', () => {
    const p = plan();
    p.date = undefined;
    p.events.push(createEvent({ id: 'chosen', title: 'Chosen later stop', order: 1 }));
    const context = computeDayContext(p, null, new Date('2026-10-01T07:40:00Z'));
    const resolved = resolveDayDestination(context, 'chosen');
    expect(resolved.destination?.event.id).toBe('chosen');
    expect(resolved.remaining[0].event.id).toBe('chosen');
    expect(resolved.destination?.startMinutes).toBeNull();
  });

  it('offers no destination when the chosen stop and all remaining stops are settled', () => {
    const p = plan();
    const context = computeDayContext(
      p,
      {
        planId: p.id,
        updatedAt: '2026-10-01T07:40:00Z',
        events: { existing: { eventId: 'existing', status: 'completed' } },
      },
      new Date('2026-10-01T07:40:00Z'),
    );
    expect(resolveDayDestination(context, 'existing').destination).toBeNull();
  });
});
