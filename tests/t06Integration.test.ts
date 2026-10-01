import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readDatePack as readAnyDatePack, sortEventsByOrder, writeDatePack } from '@datepack/core';
import { getAiScopeEventIds } from '../src/features/ai/promptBuilder';
import { hasRouteImpact, protectionReasons } from '../src/features/day/routeImpact';
import { reorderPlan } from '../src/features/plan/reorder';

describe('T06 portable acceptance checkpoint', () => {
  it('reopens loose plans, candidates, protected bookings and verbatim memories through the public file API', async () => {
    const source = await readFile(
      new URL('../examples/t06-integration.datepack.json', import.meta.url),
      'utf8',
    );
    const opened = await readDatePack(new Blob([source], { type: 'application/json' }));
    expect(opened.warnings).toEqual([]);
    const { pack } = opened;
    expect(pack.plan.events).toHaveLength(13);
    expect(
      pack.plan.events.slice(0, 12).every((event) => event.timing.kind === 'unscheduled'),
    ).toBe(true);
    expect(pack.plan.events.some((event) => event.id === 'candidate-t06')).toBe(false);
    expect(pack.plan.candidates?.[0].id).toBe('candidate-t06');
    expect(pack.experiences).toEqual([
      {
        id: 'experience-t06-note',
        title: 'T06 비를 피해 쉬었던 순간',
        outcome: 'note',
        recordedAt: '2026-09-30T23:42:00.000Z',
        note: '  비를 피했다.\n커피를 마셨다.  ',
        editedNote: '비를 피하며 커피를 마셨다.',
      },
    ]);
    const reordered = reorderPlan(pack.plan, 'step-1', 'step-0')!;
    expect(
      sortEventsByOrder(reordered.events)
        .slice(0, 2)
        .map((event) => event.id),
    ).toEqual(['step-1', 'step-0']);
    expect(hasRouteImpact(pack.plan, reordered)).toBe(false);
    expect(protectionReasons(pack.plan, reorderPlan(pack.plan, 'step-0', null)!)).toContain(
      'protected-order',
    );
    expect(
      getAiScopeEventIds(reordered, null, 'next-change', new Date('2026-10-01T16:40:00+09:00'), {
        nextPlaceId: 'step-4',
      }),
    ).toEqual(['step-4']);
    const portable = await writeDatePack({ ...pack, plan: reordered }, () => null);
    const reopened = await readDatePack(portable.blob);
    expect(reopened.pack.plan).toEqual(reordered);
    expect(reopened.pack.experiences).toEqual(pack.experiences);
    expect(reopened.pack.plan.events.at(-1)?.protectedFields).toEqual([
      'time',
      'place',
      'content',
      'delete',
      'order',
    ]);
    expect(await portable.blob.text()).not.toMatch(
      /"(?:gps|lat|lon|geometry|pendingRequest|personalJourney)"/,
    );
  });
});

async function readDatePack(file: Blob) {
  const result = await readAnyDatePack(file);
  if (result.pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return { ...result, pack: result.pack };
}
