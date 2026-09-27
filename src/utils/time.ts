const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "HH:mm" → minutes since midnight, or null when invalid. */
export function parseTime(value: string | undefined | null): number | null {
  if (!value) return null;
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
  if (!DATE_RE.test(value)) return false;
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
