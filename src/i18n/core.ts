import { useSyncExternalStore } from 'react';
import { datepackKo, datepackEn, type DatePackIssueKey } from '@datepack/core';
import { ko, type MessageKey } from './ko';
import { en } from './en';

export type Locale = 'ko' | 'en';

const CATALOGS: Record<Locale, Record<MessageKey | DatePackIssueKey, string>> = {
  ko: { ...ko, ...datepackKo },
  en: { ...en, ...datepackEn },
};
const STORAGE_KEY = 'datepack.locale';

export type I18nVars = Record<string, string | number>;
export type I18nIssue = { key: MessageKey | DatePackIssueKey; params?: I18nVars };
export type I18nInput = MessageKey | DatePackIssueKey | I18nIssue;

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ko' || stored === 'en') return stored;
  } catch {
    // storage unavailable (private mode etc.) — fall through to navigator
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko')) {
    return 'ko';
  }
  return 'en';
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // non-fatal: the in-memory locale still applies for this session
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

/** Called once by App bootstrap to sync <html lang>. */
export function initLocale(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function interpolate(template: string, params?: I18nVars): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Format with an explicit locale — used by phrase helpers and tests. */
export function format(locale: Locale, key: I18nInput, params?: I18nVars): string {
  const issue: I18nIssue = typeof key === 'string' ? { key } : key;
  const catalog = CATALOGS[locale];
  const template = catalog[issue.key] ?? issue.key;
  return interpolate(template, issue.params ?? params);
}

/** Format with the current locale. */
export function t(key: I18nInput, params?: I18nVars): string {
  return format(current, key, params);
}

// ---------------------------------------------------------------------------
// Localized data formatters (deterministic — no Intl variance)
// ---------------------------------------------------------------------------

const WEEKDAYS = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ko: "9월 28일 (월)" · en: "Mon, Sep 28" */
export function formatDate(locale: Locale, iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const weekday = new Date(y, m - 1, d).getDay();
  if (locale === 'ko') return `${m}월 ${d}일 (${WEEKDAYS.ko[weekday]})`;
  return `${WEEKDAYS.en[weekday]}, ${MONTHS[m - 1]} ${d}`;
}

/** ko: "1시간 20분" · en: "1h 20m" */
export function formatDuration(locale: Locale, minutes: number): string {
  if (minutes < 60) return format(locale, 'phrase.duration.minutes', { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return format(locale, 'phrase.duration.hour', { hours });
  return format(locale, 'phrase.duration.hourMinute', { hours, minutes: rest });
}

/** "15:20쯤 천천히 출발해요" / "Leave around 15:20 — take it slow." */
export function departurePhrase(
  locale: Locale,
  departureMinutes: number,
  travelMinutes?: number,
): string {
  const time = formatTime(floorTo5(departureMinutes));
  if (travelMinutes && travelMinutes > 0) {
    return format(locale, 'phrase.departure.travel', { time });
  }
  return format(locale, 'phrase.departure.plain', { time });
}

/** "여기서 18분 더 있어도 돼요" / "No rush — 18 min to enjoy here." */
export function remainingPhrase(locale: Locale, remaining: number | null): string | null {
  if (remaining === null) return null;
  if (remaining > 2)
    return format(locale, 'phrase.remaining.left', { duration: formatDuration(locale, remaining) });
  if (remaining >= -2) return format(locale, 'phrase.remaining.soon');
  return format(locale, 'phrase.remaining.over', {
    duration: formatDuration(locale, Math.abs(remaining)),
  });
}

const EVENT_TYPE_KEYS = {
  place: 'type.place',
  meal: 'type.meal',
  cafe: 'type.cafe',
  transport: 'type.transport',
  reservation: 'type.reservation',
  activity: 'type.activity',
  note: 'type.note',
} as const;

export type EventTypeName = keyof typeof EVENT_TYPE_KEYS;

export function eventTypeLabel(locale: Locale, type: string): string {
  const key = EVENT_TYPE_KEYS[type as EventTypeName];
  return key ? format(locale, key) : type;
}

/** Localize a list of issues (key + params) — used for error surfaces. */
export function localizeAll(locale: Locale, issues: readonly I18nIssue[]): string[] {
  return issues.map((issue) => format(locale, issue));
}

// tiny local copy to avoid a circular import with @datepack/core
function floorTo5(minutes: number): number {
  return Math.floor(minutes / 5) * 5;
}

function formatTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
