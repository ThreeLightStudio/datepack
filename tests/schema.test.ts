import { describe, expect, it } from 'vitest';
import { checkFormatVersion, parseFormatVersion, parseManifest } from '../src/datepack/schema';
import { DATEPACK_FORMAT_VERSION } from '../src/datepack/schema';
import { format } from '../src/i18n/core';

describe('format version policy', () => {
  it('accepts "1.0", "1" and the number 1', () => {
    expect(parseFormatVersion('1.0')).toEqual({ major: 1, minor: 0, raw: '1.0' });
    expect(parseFormatVersion('1')?.minor).toBe(0);
    expect(parseFormatVersion(1)?.minor).toBe(0);
  });

  it('accepts older and equal minors, warns on newer minors of the same major', () => {
    expect(checkFormatVersion('1.0').status).toBe('ok');
    // a reader that understands 1.2 would be ok here; we support 1.0
    expect(checkFormatVersion('1.1').status).toBe('warn');
    expect(checkFormatVersion('1.9').status).toBe('warn');
    const warn = checkFormatVersion('1.2');
    expect(warn.status === 'warn' && format('ko', warn.message)).toContain('무시');
    expect(warn.status === 'warn' && format('en', warn.message)).toContain('ignored');
  });

  it('accepts supported majors and rejects other majors and garbage', () => {
    expect(checkFormatVersion('1.0').status).toBe('ok');
    expect(checkFormatVersion('2.0').status).toBe('ok');
    expect(checkFormatVersion('3.0').status).toBe('reject');
    expect(checkFormatVersion('0.9').status).toBe('reject');
    expect(checkFormatVersion('abc').status).toBe('reject');
    expect(checkFormatVersion(null).status).toBe('reject');
  });

  it('exposes the current format version constant', () => {
    expect(DATEPACK_FORMAT_VERSION).toBe('2.0');
  });
});

describe('manifest parsing', () => {
  const base = { format: 'datepack', version: '1.0', entry: 'plan.json' };

  it('accepts a valid manifest', () => {
    const result = parseManifest(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.version).toBe('1.0');
      expect(result.manifest.entry).toBe('plan.json');
      expect(result.warnings).toHaveLength(0);
    }
  });

  it('warns on newer minor versions', () => {
    const result = parseManifest({ ...base, version: '1.3' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects non-datepack formats and bad versions', () => {
    expect(parseManifest({ ...base, format: 'other' }).ok).toBe(false);
    expect(parseManifest({ ...base, version: '3.0' }).ok).toBe(false);
    expect(parseManifest('nope').ok).toBe(false);
    expect(parseManifest(null).ok).toBe(false);
  });
});
