import { useSyncExternalStore } from 'react';
import { getLocale, setLocale, subscribeLocale, type Locale } from './core';

export {
  t,
  format,
  getLocale,
  setLocale,
  initLocale,
  formatDate,
  formatDuration,
  departurePhrase,
  remainingPhrase,
  eventTypeLabel,
  localizeAll,
} from './core';
export type { Locale, I18nIssue, I18nVars } from './core';

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** Both supported locales with their display names (never localized). */
export const LOCALES: Array<{ id: Locale; label: string }> = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
];
