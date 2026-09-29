import { describe, expect, it } from 'vitest';
import type { Experience } from '@datepack/core';
import { buildExperienceShareText } from '../src/features/memories/shareText';

const first: Experience = {
  id: 'visited-cafe',
  eventId: 'removed-from-plan',
  title: 'A quiet cafe',
  placeSnapshot: { name: 'River Cafe', mapQuery: 'River Cafe Seoul' },
  outcome: 'completed',
  occurredOn: '2026-09-25',
  timing: { kind: 'exact', at: { dayOffset: 0, time: '14:20' } },
  recordedAt: '2026-09-29T09:15:00.000Z',
  note: 'We stayed until sunset.',
  assetIds: ['private-photo'],
};

const second: Experience = {
  id: 'unplanned-stop',
  title: 'A bookstore we found',
  outcome: 'note',
  recordedAt: '2026-09-29T09:20:00.000Z',
  note: 'We took the side street.',
};

describe('memory text sharing', () => {
  it('includes only selected memories and only notes the user opted into', () => {
    const text = buildExperienceShareText(
      [first, second],
      new Set(['visited-cafe']),
      new Set(),
      'en',
    );

    expect(text).toContain('Visited: A quiet cafe · River Cafe');
    expect(text).toContain('Sep 25, 2026');
    expect(text).toContain('14:20');
    expect(text).not.toContain('We stayed until sunset');
    expect(text).not.toContain('A bookstore we found');
    expect(text).not.toContain('private-photo');
  });

  it('labels unknown visit time and includes opted-in notes in Korean', () => {
    const text = buildExperienceShareText(
      [second],
      new Set(['unplanned-stop']),
      new Set(['unplanned-stop']),
      'ko',
    );

    expect(text).toContain('방문 시각 미상');
    expect(text).toContain('날짜 미상');
    expect(text).toContain('We took the side street.');
  });
});
