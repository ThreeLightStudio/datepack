import type { DatePackManifest } from './types';
import type { I18nIssue } from '../i18n/core';

/**
 * DatePack file format version policy (major.minor):
 *  - major = incompatible structural change → readers reject other majors
 *  - minor = backward-compatible extension → readers accept older minors,
 *    and accept newer minors with a "some fields may be ignored" warning
 */
export const DATEPACK_FORMAT = 'datepack';
export const DATEPACK_FORMAT_VERSION = '1.0';
/** Highest minor this reader fully understands for major 1. */
export const DATEPACK_SUPPORTED_MINOR = 0;
/** Package/library version — separate from the file format version on purpose. */
export const PACKAGE_VERSION = '0.1.0';
export const DATEPACK_ENTRY = 'plan.json' as const;

export type ParsedFormatVersion = { major: number; minor: number; raw: string };

export type VersionCheck =
  | { status: 'ok'; parsed: ParsedFormatVersion }
  | { status: 'warn'; parsed: ParsedFormatVersion; message: I18nIssue }
  | { status: 'reject'; parsed: ParsedFormatVersion | null; message: I18nIssue };

/** Accepts "1.0", "1", and the number 1 (older drafts of the spec). */
export function parseFormatVersion(raw: unknown): ParsedFormatVersion | null {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim();
  } else {
    return null;
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  return { major, minor, raw: text };
}

export function checkFormatVersion(raw: unknown): VersionCheck {
  const parsed = parseFormatVersion(raw);
  if (!parsed) {
    return {
      status: 'reject',
      parsed: null,
      message: { key: 'err.read.badVersion', params: { value: String(raw) } },
    };
  }
  if (parsed.major !== 1) {
    return {
      status: 'reject',
      parsed,
      message: { key: 'err.read.unsupportedVersion', params: { value: parsed.raw } },
    };
  }
  if (parsed.minor > DATEPACK_SUPPORTED_MINOR) {
    return {
      status: 'warn',
      parsed,
      message: { key: 'err.read.newerVersion', params: { value: parsed.raw } },
    };
  }
  return { status: 'ok', parsed };
}

export function makeManifest(): DatePackManifest {
  const now = new Date().toISOString();
  return {
    format: DATEPACK_FORMAT,
    version: DATEPACK_FORMAT_VERSION,
    entry: DATEPACK_ENTRY,
    createdAt: now,
    updatedAt: now,
    generator: `datepack-web ${PACKAGE_VERSION}`,
  };
}

export type ManifestResult =
  | { ok: true; manifest: DatePackManifest; warnings: I18nIssue[] }
  | { ok: false; errors: I18nIssue[] };

export function parseManifest(raw: unknown): ManifestResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: [{ key: 'err.read.badManifest' }] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== DATEPACK_FORMAT) {
    return {
      ok: false,
      errors: [{ key: 'err.read.formatWrong', params: { value: String(obj.format) } }],
    };
  }

  const version = checkFormatVersion(obj.version);
  if (version.status === 'reject') {
    return { ok: false, errors: [version.message] };
  }
  const warnings: I18nIssue[] = version.status === 'warn' ? [version.message] : [];

  // 1.0 always uses plan.json as the entry; readers fall back to it regardless.
  return {
    ok: true,
    warnings,
    manifest: {
      format: DATEPACK_FORMAT,
      version: version.parsed.raw,
      entry: DATEPACK_ENTRY,
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : undefined,
      updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
      generator: typeof obj.generator === 'string' ? obj.generator : undefined,
    },
  };
}
