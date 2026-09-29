import { extractJsonObject } from '@datepack/core';
import type { DatePackPatch } from '@datepack/core';

export type AiRequestKind = 'create' | 'next-change' | 'remaining-change' | 'memory-edit';

export type AiRequestIdentity = {
  requestId: string;
  packId: string;
  baseRevision: number;
  contextRevision: number;
  generatedAt: string;
  kind: AiRequestKind;
};

export type AiResponse = AiRequestIdentity & {
  type: 'datepack.response';
  version: 2;
  result: unknown;
};

export type AiResponseParse =
  | { ok: true; response: AiResponse }
  | {
      ok: false;
      reason: 'not-json' | 'wrong-envelope' | 'missing-id' | 'mismatch' | 'missing-result';
    };

export function responseContract(identity: AiRequestIdentity, resultShape: unknown): string {
  return JSON.stringify(
    {
      type: 'datepack.response',
      version: 2,
      requestId: identity.requestId,
      packId: identity.packId,
      baseRevision: identity.baseRevision,
      contextRevision: identity.contextRevision,
      generatedAt: identity.generatedAt,
      kind: identity.kind,
      result: resultShape,
    },
    null,
    2,
  );
}

export function parseAiResponse(raw: string, expected: AiRequestIdentity): AiResponseParse {
  const value = extractJsonObject(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, reason: 'not-json' };
  const obj = value as Record<string, unknown>;
  if (obj.type !== 'datepack.response' || obj.version !== 2)
    return { ok: false, reason: 'wrong-envelope' };
  if (
    typeof obj.requestId !== 'string' ||
    typeof obj.packId !== 'string' ||
    typeof obj.baseRevision !== 'number' ||
    typeof obj.contextRevision !== 'number' ||
    typeof obj.generatedAt !== 'string' ||
    typeof obj.kind !== 'string'
  )
    return { ok: false, reason: 'missing-id' };
  if (
    obj.requestId !== expected.requestId ||
    obj.packId !== expected.packId ||
    obj.baseRevision !== expected.baseRevision ||
    obj.contextRevision !== expected.contextRevision ||
    obj.generatedAt !== expected.generatedAt ||
    obj.kind !== expected.kind
  )
    return { ok: false, reason: 'mismatch' };
  if (!Object.hasOwn(obj, 'result')) return { ok: false, reason: 'missing-result' };
  return { ok: true, response: obj as unknown as AiResponse };
}

export function responseFingerprint(raw: string): string {
  // Stable local duplicate detection; this is an integrity check, not a signature.
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Every targeted operation must stay within the IDs fixed for this request. */
export function isPatchWithinScope(
  patch: DatePackPatch,
  allowedEventIds: readonly string[],
  allowFirstInsert: boolean,
): boolean {
  const allowed = new Set(allowedEventIds);
  return patch.operations.every((operation) => {
    if (operation.op === 'insertFirst') return allowFirstInsert;
    const target = operation.target.startsWith('event:')
      ? operation.target.slice('event:'.length)
      : operation.target;
    return allowed.has(target);
  });
}
