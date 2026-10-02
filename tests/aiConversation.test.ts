import { describe, expect, it } from 'vitest';
import {
  buildPlanFromDraft,
  createEvent,
  describePatch,
  parsePatch,
  parsePlanDraft,
  type DatePlan,
  type Experience,
} from '@datepack/core';
import { buildCreatePrompt } from '../src/features/ai/createPromptBuilder';
import { buildAiPrompt } from '../src/features/ai/promptBuilder';
import {
  parseAiResponse,
  responseContract,
  type AiRequestIdentity,
} from '../src/features/ai/exchange';
import { buildMemoryPrompt, parseMemoryReply } from '../src/features/memories/aiMemory';

const identity: AiRequestIdentity = {
  requestId: 'T03-rain-001',
  packId: 'T03-plan-001',
  baseRevision: 7,
  contextRevision: 3,
  generatedAt: '2026-10-01T07:40:00Z',
  kind: 'next-change',
};
const plan: DatePlan = {
  id: identity.packId,
  title: 'Rain date',
  events: [
    createEvent({
      id: 'cafe',
      order: 0,
      title: 'Cafe',
      placeId: 'cafe-place',
      timing: {
        kind: 'window',
        earliestStart: { dayOffset: 0, time: '16:40' },
        latestStart: { dayOffset: 0, time: '17:00' },
      },
      estimatedDurationMinutes: 20,
    }),
    createEvent({ id: 'booking', order: 1, title: 'Dinner', start: '18:00', fixed: true }),
  ],
  places: [{ id: 'cafe-place', name: 'Public Cafe' }],
};
const memory: Experience = {
  id: 'T03-memory-001',
  title: 'Coffee break',
  note: '  비를 피했다.\n커피를 마셨다.  ',
  outcome: 'note',
  recordedAt: '2026-10-01T07:30:00Z',
  assetIds: ['private-photo'],
  placeSnapshot: { name: 'private-place' },
};

describe.each(['ko', 'en'] as const)('T03 conversations and parser fixtures (%s)', (locale) => {
  it('offers one recommendation, accepts reactions, and immediately exports on approval in all three stages', () => {
    const prompts = [
      buildCreatePrompt({ region: '성수동', identity: { ...identity, kind: 'create' }, locale }),
      buildAiPrompt({
        plan,
        runtime: null,
        situationId: 'rain',
        scopeEventIds: ['cafe'],
        identity,
        now: new Date('2026-10-01T07:40:00Z'),
        locale,
      }),
      buildMemoryPrompt(memory, { ...identity, kind: 'memory-edit' }, locale),
    ];
    for (const [index, prompt] of prompts.entries()) {
      expect(prompt).toContain(
        index === 2
          ? locale === 'ko'
            ? '다듬은 문장 하나'
            : 'one edited version'
          : locale === 'ko'
            ? '기본 추천 하나'
            : 'one easy default recommendation',
      );
      expect(prompt).toContain(
        locale === 'ko' ? '승인·거절·다른 제안' : 'approve, reject, or ask for another',
      );
      expect(prompt).toContain(
        locale === 'ko'
          ? '별도 생성 명령어를 기다리지'
          : 'do not wait for a separate generation command',
      );
      expect(prompt).toContain(locale === 'ko' ? 'JSON 객체 하나' : 'one JSON object');
      expect(prompt).toContain(locale === 'ko' ? '중괄호나 다른 JSON' : 'braces or other JSON');
      expect(prompt).toContain(
        locale === 'ko'
          ? '미리보기에서 변경을 확인하여 적용'
          : 'review the changes before applying',
      );
      for (const field of [
        'requestId',
        'packId',
        'baseRevision',
        'contextRevision',
        'generatedAt',
        'kind',
      ])
        expect(prompt).toContain(`"${field}"`);
    }
    expect(prompts[0]).toContain(locale === 'ko' ? '날짜: 미정' : 'Date: Undecided');
    expect(prompts[0]).not.toContain('"date":');
    expect(prompts[1]).toContain(
      locale === 'ko' ? '시작 시간대 16:40–17:00' : 'start window 16:40–17:00',
    );
    expect(prompts[1]).toContain('Public Cafe');
    expect(prompts[1]).toContain(
      locale === 'ko'
        ? '수정 가능한 target id (이 목록만 사용): cafe'
        : 'Editable target ids (use only this list): cafe',
    );
    expect(prompts[1]).toContain(
      locale === 'ko'
        ? '사용자가 앱에서 해당 일정을 직접 편집'
        : 'edit that stop directly in the app',
    );
    expect(prompts[1]).not.toContain('fixed: true');
    expect(prompts[2]).toContain(memory.note);
  });

  it('accepts full replies and JSON alone for create, next, remaining and memory, preserving identity and facts', () => {
    const fixtures = [
      {
        kind: 'create' as const,
        result: {
          type: 'datepack.plan',
          version: 1,
          title: 'Undated',
          events: [
            { title: 'Unset' },
            {
              title: 'Late',
              timing: { kind: 'exact', start: { dayOffset: 1, time: '00:10' } },
              protectedFields: ['time', 'order'],
            },
          ],
        },
      },
      {
        kind: 'next-change' as const,
        result: {
          type: 'datepack.patch',
          version: 1,
          operations: [{ op: 'replace', target: 'event:cafe', value: { note: 'Bring umbrella' } }],
        },
      },
      {
        kind: 'remaining-change' as const,
        result: {
          type: 'datepack.patch',
          version: 1,
          operations: [
            {
              op: 'insertAfter',
              target: 'event:cafe',
              value: {
                title: 'Bookshop',
                timing: { kind: 'unscheduled' },
                estimatedDurationMinutes: 15,
              },
            },
          ],
        },
      },
      {
        kind: 'memory-edit' as const,
        result: { experienceId: memory.id, editedText: '비를 피하며 커피를 마셨다.' },
      },
    ];
    for (const fixture of fixtures) {
      const expected = { ...identity, kind: fixture.kind };
      const json = responseContract(expected, fixture.result);
      for (const raw of [
        json,
        `${locale === 'ko' ? '확정안입니다.' : 'Here is the settled proposal.'}\n\n\`\`\`json\n${json}\n\`\`\`\n\n${locale === 'ko' ? 'DatePack에 붙여넣고 변경을 검토하세요.' : 'Paste into DatePack and review the changes.'}`,
      ]) {
        const envelope = parseAiResponse(raw, expected);
        if (!envelope.ok) throw new Error(envelope.reason);
        expect(envelope.response).toMatchObject(expected);
        if (fixture.kind === 'create') {
          const parsed = parsePlanDraft(JSON.stringify(envelope.response.result), {
            allowUndated: true,
          });
          if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
          const draft = buildPlanFromDraft(parsed.draft);
          expect(draft.plan.date).toBeUndefined();
          expect(draft.plan.events[0].timing.kind).toBe('unscheduled');
          expect(draft.plan.events[1]).toMatchObject({
            timing: { start: { dayOffset: 1 } },
            protectedFields: ['time', 'order'],
          });
        } else if (fixture.kind === 'memory-edit') {
          expect(parseMemoryReply(raw, expected, memory, memory.note)).toMatchObject({
            ok: true,
            originalText: memory.note,
            editedText: fixture.result.editedText,
          });
        } else {
          const parsed = parsePatch(JSON.stringify(envelope.response.result));
          if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
          const change = describePatch(plan, parsed.patch);
          expect(change.canApply).toBe(true);
          const { order: _order, ...protectedBooking } = plan.events[1];
          expect(change.plan.events.find((event) => event.id === 'booking')).toMatchObject(
            protectedBooking,
          );
          expect(change.plan.events.findIndex((event) => event.id === 'cafe')).toBeLessThan(
            change.plan.events.findIndex((event) => event.id === 'booking'),
          );
        }
      }
      for (const field of [
        'requestId',
        'packId',
        'baseRevision',
        'contextRevision',
        'generatedAt',
        'kind',
      ] as const) {
        expect(
          parseAiResponse(
            responseContract(
              { ...expected, [field]: typeof expected[field] === 'number' ? 99 : 'another' },
              fixture.result,
            ),
            expected,
          ).ok,
        ).toBe(false);
      }
      expect(parseAiResponse(`Explanation {extra}\n${json}`, expected).ok).toBe(false);
      expect(parseAiResponse(`${json}\n${json}`, expected).ok).toBe(false);
    }
  });

  it('selects coarse area and observation time without serializing runtime/provider/private data', () => {
    const observation = {
      source: 'gps' as const,
      coarseLabel: '성수동',
      observedAt: '2026-10-01T07:20:00Z',
      latitude: 37.123456,
      longitude: 127.987654,
      coordinate: { lat: 37.123456, lon: 127.987654 },
      geometry: 'secret-geometry',
      providerRaw: 'secret-provider',
    };
    const liveContext = {
      planId: plan.id,
      revision: 3,
      updatedAt: '2026-10-01T07:40:00Z',
      locationAttempt: {
        status: 'denied' as const,
        attemptedAt: '2026-10-01T07:40:00Z',
        lastKnown: observation,
      },
      personalJourney: { origin: 'secret-origin' },
    };
    const prompt = buildAiPrompt({
      plan,
      runtime: null,
      situationId: 'rain',
      locale,
      identity,
      liveContext,
    });
    expect(prompt).toContain('성수동');
    expect(prompt).toContain(observation.observedAt);
    expect(prompt).toContain('denied');
    for (const secret of [
      '37.123456',
      '127.987654',
      'secret-geometry',
      'secret-provider',
      'secret-origin',
    ])
      expect(prompt).not.toContain(secret);
    const memoryPrompt = buildMemoryPrompt(memory, { ...identity, kind: 'memory-edit' }, locale);
    for (const secret of ['private-photo', 'private-place', memory.recordedAt, 'Rain date'])
      expect(memoryPrompt).not.toContain(secret);
  });
});

describe('memory correction boundary', () => {
  const expected = { ...identity, kind: 'memory-edit' as const };
  it('rejects another experience, modified original, empty wording, or unsupported fact fields', () => {
    const reply = (result: unknown) => responseContract(expected, result);
    expect(
      parseMemoryReply(
        reply({ experienceId: 'other', editedText: 'Text' }),
        expected,
        memory,
        memory.note,
      ),
    ).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(
      parseMemoryReply(
        reply({ experienceId: memory.id, editedText: 'Text' }),
        expected,
        { ...memory, note: 'Changed' },
        memory.note,
      ),
    ).toMatchObject({ ok: false, reason: 'stale' });
    for (const result of [
      { experienceId: memory.id, editedText: ' ' },
      { experienceId: memory.id, editedText: 'Text', outcome: 'completed' },
      { experienceId: memory.id, editedText: 'Text', note: 'Overwrite original' },
    ])
      expect(parseMemoryReply(reply(result), expected, memory, memory.note).ok).toBe(false);
  });
});
