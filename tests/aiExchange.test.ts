import { describe, expect, it } from 'vitest';
import {
  parseAiResponse,
  responseFingerprint,
  responseContract,
  isPatchWithinScope,
  type AiRequestIdentity,
} from '../src/features/ai/exchange';
import type { DatePackPatch } from '@datepack/core';

const identity: AiRequestIdentity = {
  requestId: 'req-1',
  packId: 'plan-1',
  baseRevision: 4,
  contextRevision: 2,
  generatedAt: '2026-09-29T10:00:00.000Z',
  kind: 'remaining-change',
};

function answer(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'datepack.response',
    version: 2,
    ...identity,
    result: { type: 'datepack.patch', version: 1, operations: [] },
    ...overrides,
  });
}

describe('AI v2 response envelope', () => {
  it('requires every request identity field to match exactly', () => {
    expect(parseAiResponse(answer(), identity).ok).toBe(true);
    for (const field of [
      'requestId',
      'packId',
      'baseRevision',
      'contextRevision',
      'generatedAt',
      'kind',
    ]) {
      const altered = {
        ...identity,
        [field]: field === 'baseRevision' || field === 'contextRevision' ? 99 : 'other',
      };
      expect(parseAiResponse(answer(), altered).ok).toBe(false);
    }
    expect(parseAiResponse(answer({ requestId: undefined }), identity)).toMatchObject({
      ok: false,
      reason: 'missing-id',
    });
  });

  it('rejects legacy replies and envelopes with no result', () => {
    expect(
      parseAiResponse('{"type":"datepack.patch","version":1,"operations":[]}', identity).ok,
    ).toBe(false);
    expect(parseAiResponse(answer({ result: undefined }), identity)).toMatchObject({
      ok: false,
      reason: 'missing-result',
    });
  });

  it('produces deterministic local duplicate fingerprints and a complete response contract', () => {
    expect(responseFingerprint(answer())).toBe(responseFingerprint(answer()));
    const contract = responseContract(identity, {
      type: 'datepack.patch',
      version: 1,
      operations: [],
    });
    expect(contract).toContain('"requestId": "req-1"');
    expect(contract).toContain('"contextRevision": 2');
    expect(contract).toContain('"generatedAt": "2026-09-29T10:00:00.000Z"');
    expect(contract).toContain('"kind": "remaining-change"');
  });
});

describe('AI patch scope', () => {
  const firstInsert: DatePackPatch = {
    type: 'datepack.patch',
    version: 1,
    operations: [{ op: 'insertFirst', value: { title: 'Coffee' } }],
  };
  const targeted: DatePackPatch = {
    type: 'datepack.patch',
    version: 1,
    operations: [{ op: 'move', target: 'event:stop-1', value: { start: '10:00' } }],
  };

  it('permits insertFirst only for the captured empty-plan scope', () => {
    expect(isPatchWithinScope(firstInsert, [], true)).toBe(true);
    expect(isPatchWithinScope(firstInsert, [], false)).toBe(false);
  });

  it('keeps targeted operations inside the captured event IDs', () => {
    expect(isPatchWithinScope(targeted, ['stop-1'], false)).toBe(true);
    expect(isPatchWithinScope(targeted, [], true)).toBe(false);
  });
});
