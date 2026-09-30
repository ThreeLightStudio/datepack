import type { EventTiming } from '@datepack/core';
import type { Locale } from '../../i18n/core';

export function timingLabel(timing: EventTiming, locale: Locale): string {
  const ko = locale === 'ko';
  const point = (p: { dayOffset: 0 | 1; time: string }) =>
    `${p.time}${p.dayOffset ? (ko ? ' (다음 날)' : ' (next day)') : ''}`;
  if (timing.kind === 'unscheduled') return timing.label || (ko ? '시간 미정' : 'time unset');
  if (timing.kind === 'window')
    return `${point(timing.earliestStart)}–${point(timing.latestStart)} ${ko ? '시작 시간대' : 'start window'}`;
  return `${point(timing.start)}${timing.end ? `–${point(timing.end)}` : ''}`;
}
