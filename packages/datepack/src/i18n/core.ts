import { ko, type DatePackIssueKey } from './ko';
import { en } from './en';

export type DatePackLocale = 'ko' | 'en';
export type DatePackVars = Record<string, string | number>;

/** A structured, localizable message emitted by the package. */
export type DatePackIssue = { key: DatePackIssueKey; params?: DatePackVars };

const CATALOGS = { ko, en } as const;

function interpolate(template: string, params?: DatePackVars): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Format a package message with an explicit locale — mirrors the app's i18n format(). */
export function format(
  locale: DatePackLocale,
  key: DatePackIssueKey,
  params?: DatePackVars,
): string;
export function format(locale: DatePackLocale, issue: DatePackIssue): string;
export function format(
  locale: DatePackLocale,
  keyOrIssue: DatePackIssueKey | DatePackIssue,
  params?: DatePackVars,
): string {
  const issue: DatePackIssue = typeof keyOrIssue === 'string' ? { key: keyOrIssue } : keyOrIssue;
  const catalog = CATALOGS[locale] as Record<DatePackIssueKey, string>;
  const template = catalog[issue.key] ?? ko[issue.key] ?? issue.key;
  return interpolate(template, issue.params ?? params);
}

/** Localize a list of issues — used for error surfaces and log fallbacks. */
export function localizeIssues(locale: DatePackLocale, issues: readonly DatePackIssue[]): string[] {
  return issues.map((issue) => format(locale, issue));
}
