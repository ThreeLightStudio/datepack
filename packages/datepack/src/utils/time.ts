const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
import type { EventTiming, LocalPoint } from '../types';

/** "HH:mm" → minutes since midnight, or null when invalid. */
export function parseTime(value: string | undefined | null): number | null {
  if (typeof value !== 'string' || !value) return null;
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function isValidTime(value: string | undefined | null): value is string {
  return parseTime(value) !== null;
}

/** minutes since midnight → "HH:mm" (wraps at 24h) */
export function formatTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normalize a validated time to canonical "HH:mm" ("9:30" → "09:30"). */
export function normalizeTime(value: string): string {
  return formatTime(parseTime(value) ?? 0);
}

export function addMinutes(time: string, delta: number): string {
  const base = parseTime(time) ?? 0;
  return formatTime(base + delta);
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Floor to a 5-minute boundary — used for humanized departure times (15:21 → 15:20). */
export function floorTo5(minutes: number): number {
  return Math.floor(minutes / 5) * 5;
}

export function isValidDateISO(value: string): boolean {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Local date as "YYYY-MM-DD". */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function nowLabel(now: Date = new Date()): string {
  return formatTime(minutesOfDay(now));
}

/** Absolute minute position within a plan; null for non-exact timings. */
export function localPointMinutes(point: LocalPoint): number | null {
  const minute = parseTime(point?.time);
  if (minute === null || (point?.dayOffset !== 0 && point?.dayOffset !== 1)) return null;
  return point.dayOffset * 1440 + minute;
}

export function timingStartMinutes(timing: EventTiming | undefined): number | null {
  if (!timing) return null;
  if (timing.kind === 'exact') return localPointMinutes(timing.start);
  if (timing.kind === 'window') return localPointMinutes(timing.earliestStart);
  return null;
}

/** Sort key for exact/window time, while leaving unscheduled events unordered by time. */
export function compareTiming(a: EventTiming, b: EventTiming): number {
  return (
    (timingStartMinutes(a) ?? Number.MAX_SAFE_INTEGER) -
    (timingStartMinutes(b) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function isValidLocalPoint(value: unknown): value is LocalPoint {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Partial<LocalPoint>;
  return (point.dayOffset === 0 || point.dayOffset === 1) && isValidTime(point.time);
}

export function isValidTiming(value: unknown): value is EventTiming {
  if (typeof value !== 'object' || value === null) return false;
  const timing = value as Record<string, unknown>;
  if (timing.kind === 'unscheduled')
    return timing.label === undefined || typeof timing.label === 'string';
  if (timing.kind === 'exact') {
    if (!isValidLocalPoint(timing.start)) return false;
    if (timing.end !== undefined && !isValidLocalPoint(timing.end)) return false;
    return (
      timing.end === undefined ||
      (localPointMinutes(timing.end as LocalPoint)! >=
        localPointMinutes(timing.start as LocalPoint)! &&
        localPointMinutes(timing.end as LocalPoint)! -
          localPointMinutes(timing.start as LocalPoint)! <=
          1440)
    );
  }
  if (timing.kind === 'window') {
    if (!isValidLocalPoint(timing.earliestStart) || !isValidLocalPoint(timing.latestStart))
      return false;
    return (
      localPointMinutes(timing.latestStart as LocalPoint)! >=
        localPointMinutes(timing.earliestStart as LocalPoint)! &&
      localPointMinutes(timing.latestStart as LocalPoint)! -
        localPointMinutes(timing.earliestStart as LocalPoint)! <=
        1440
    );
  }
  return false;
}
