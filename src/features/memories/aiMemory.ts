import type { Experience } from '@datepack/core';
import type { Locale } from '../../i18n/core';
import { conversationGuide, resultFooterGuide } from '../ai/conversation';
import { parseAiResponse, type AiRequestIdentity } from '../ai/exchange';

/** Deliberate allowlist: only the selected record's title and original text go to AI. */
export function buildMemoryPrompt(
  experience: Pick<Experience, 'id' | 'title' | 'note'>,
  identity: AiRequestIdentity,
  locale: Locale,
): string {
  return [
    locale === 'ko'
      ? '선택한 기록의 표현만 읽기 편하게 다듬는 일을 도와주세요. 아래 원문에 사용자가 확인한 사실만 사용하세요. 계획·GPS·시각으로 방문·완료·대화·감정·새 경험을 만들거나 추정하지 마세요. 사실이 모호하면 꼭 필요한 확인만 묻고, 확인 전에는 그 표현을 원문 그대로 유지하세요. 원문 note는 그대로 보존하고 승인된 표현만 editedNote로 따로 저장합니다.'
      : 'Help polish only the wording of the selected record. Use only user-confirmed facts in the original below. Do not invent or infer visits, completion, conversations, feelings, or new experiences from plans, GPS, or time. Ask only necessary questions about ambiguous facts, keeping that wording unchanged until confirmed. Original note stays unchanged; approved wording is saved separately as editedNote.',
    conversationGuide(locale, 'memory'),
    `${locale === 'ko' ? '기록 제목' : 'Memory title'}: ${experience.title}`,
    `${locale === 'ko' ? '원문' : 'Original text'}:\n${experience.note ?? ''}`,
    locale === 'ko'
      ? '다듬은 문장 하나를 먼저 제안하세요. result에는 해당 experienceId와 editedText 두 필드만 쓰세요. editedText는 승인된 표현입니다. 원문, 경험 ID, 사실은 변경하지 마세요.'
      : 'Propose one edited version first. result has exactly two fields: this experienceId and editedText containing approved wording. Never change the original, experience id, or facts.',
    resultFooterGuide(locale, { experienceId: experience.id, editedText: '...' }, identity),
  ].join('\n\n');
}

export type MemoryReply =
  | { ok: true; experienceId: string; originalText: string; editedText: string }
  | { ok: false; reason: 'mismatch' | 'invalid' | 'stale' };

/** Parsing enforces identity and original preservation; facts still require human review. */
export function parseMemoryReply(
  raw: string,
  identity: AiRequestIdentity,
  experience: Experience | undefined,
  originalText: unknown,
): MemoryReply {
  if (identity.kind !== 'memory-edit') return { ok: false, reason: 'invalid' };
  const parsed = parseAiResponse(raw, identity);
  if (!parsed.ok)
    return { ok: false, reason: parsed.reason === 'mismatch' ? 'mismatch' : 'invalid' };
  const result = parsed.response.result;
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return { ok: false, reason: 'invalid' };
  const body = result as Record<string, unknown>;
  if (!experience || typeof originalText !== 'string' || experience.note !== originalText)
    return { ok: false, reason: 'stale' };
  if (body.experienceId !== experience.id) return { ok: false, reason: 'mismatch' };
  if (
    Object.keys(body).some((key) => !['experienceId', 'editedText'].includes(key)) ||
    typeof body.editedText !== 'string' ||
    !body.editedText.trim()
  )
    return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    experienceId: experience.id,
    originalText,
    editedText: body.editedText.trim(),
  };
}
