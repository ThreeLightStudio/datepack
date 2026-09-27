import { describe, expect, it } from 'vitest';
import { mapBridgeUrl, toUrlSafeBase64, MAPBRIDGE_BASE } from '../src/utils/mapBridge';

function decodeUrlSafeBase64(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

describe('MapBridge', () => {
  it('encodes UTF-8 into URL-safe base64 without padding', () => {
    // "성심당 본점" → base64 7ISx7Ius64u5IOuzuOygkA== → URL-safe
    expect(toUrlSafeBase64('성심당 본점')).toBe('7ISx7Ius64u5IOuzuOygkA');
  });

  it('round-trips any query string', () => {
    const queries = ['성심당 본점', '디아로마 대전 동구', 'Cafe Litmus Seoul', '몽슈슈 (Mongshoo)'];
    for (const q of queries) {
      expect(decodeUrlSafeBase64(toUrlSafeBase64(q))).toBe(q);
    }
  });

  it('never contains +, / or = characters', () => {
    const encoded = toUrlSafeBase64('가나다라마바사아자차 카파타파하??///+++');
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('builds the full MapBridge URL', () => {
    const url = mapBridgeUrl('성심당 본점');
    expect(url).toBe('https://mapbridge.threelight-studio.com/s/7ISx7Ius64u5IOuzuOygkA');
    expect(url.startsWith(MAPBRIDGE_BASE)).toBe(true);
  });

  it('returns empty URL for empty query', () => {
    expect(mapBridgeUrl('   ')).toBe('');
  });
});
