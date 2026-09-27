/**
 * MapBridge: map buttons never link to a specific map service directly.
 * The query string is UTF-8 encoded, then URL-safe Base64 encoded:
 *   https://mapbridge.threelight-studio.com/s/<URL_SAFE_BASE64>
 */
export const MAPBRIDGE_BASE = 'https://mapbridge.threelight-studio.com/s/';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function toUrlSafeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function mapBridgeUrl(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';
  return `${MAPBRIDGE_BASE}${toUrlSafeBase64(trimmed)}`;
}
