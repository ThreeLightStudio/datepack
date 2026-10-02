import { isValidDateISO, localPointMinutes, type LocalPoint } from '@datepack/core';

/** This release's Korean plans use Asia/Seoul (UTC+09:00, no daylight saving). */
export const PLAN_TIME_ZONE = 'Asia/Seoul';
const SEOUL_OFFSET_MS = 9 * 60 * 60_000;
export function seoulPlanDate(now: number): string {
  return new Date(now + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}
export function seoulMinuteOfDay(now: number): number {
  const clock = new Date(now + SEOUL_OFFSET_MS);
  return clock.getUTCHours() * 60 + clock.getUTCMinutes();
}
export function seoulPointInstant(date: string, point: LocalPoint): number {
  const minutes = localPointMinutes(point);
  if (!isValidDateISO(date) || minutes === null) return NaN;
  return Date.parse(`${date}T00:00:00+09:00`) + minutes * 60_000;
}
