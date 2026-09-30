import type { Locale } from '../../i18n/core';
import { responseContract, type AiRequestIdentity } from './exchange';

/** The same human reactions finish every AI conversation; no export command is needed. */
export function conversationGuide(locale: Locale, stage: 'plan' | 'memory' = 'plan'): string {
  return locale === 'ko'
    ? [
        '진행 방식:',
        stage === 'memory'
          ? '1. 사실 확인에 꼭 필요한 정보만 짧게 질문하세요. 원문만으로 다듬을 수 있으면 다듬은 문장 하나부터 제안하고 사실이 모호한 부분은 원문 그대로 유지하세요.'
          : '1. 안전한 제안에 꼭 필요한 정보만 짧게 질문하세요. 취향을 모르면 부담이 적은 기본 추천 하나부터 제안하고 이유와 미확인 사항을 설명하세요.',
        stage === 'memory'
          ? '2. 사용자는 승인·거절·다른 제안으로 반응할 수 있습니다. 거절하면 다른 표현 하나를 제안하되 원문의 사실·미정 사항은 바꾸지 마세요.'
          : '2. 사용자는 승인·거절·다른 제안으로 반응할 수 있습니다. 거절하면 이유를 아는 범위에서 다른 후보 하나를 제안하세요. 사용자가 직접 고른 장소·순서·미정 조건을 존중하세요.',
        '3. 사용자가 승인하면 별도 생성 명령어를 기다리지 말고 그 답변 말미에 아래 DatePack 결과와 가져오기 안내를 바로 붙이세요. AI에서의 승인은 후보 확정이며 앱 저장은 사용자가 미리보기를 확인한 뒤 합니다.',
      ].join('\n')
    : [
        'How to proceed:',
        stage === 'memory'
          ? '1. Ask only for necessary factual clarification. If the original is enough, propose one edited version first and keep ambiguous facts in their original wording.'
          : '1. Ask only for information needed for a safe proposal. When preferences are unknown, start with one easy default recommendation and explain its reason and uncertainties.',
        stage === 'memory'
          ? '2. The user can approve, reject, or ask for another suggestion. After rejection, offer one alternative wording while preserving the original facts and unknowns.'
          : '2. The user can approve, reject, or ask for another suggestion. After rejection, offer one alternative using the reasons they provided. Respect their chosen venues, explicit order, and undecided details.',
        '3. On approval, immediately append the DatePack result and import instructions below; do not wait for a separate generation command. Approval in AI settles a candidate; the user still reviews it in DatePack before saving.',
      ].join('\n');
}

export function resultFooterGuide(
  locale: Locale,
  result: unknown,
  identity?: AiRequestIdentity,
): string {
  const contract = identity ? responseContract(identity, result) : JSON.stringify(result, null, 2);
  return [
    locale === 'ko'
      ? '승인 후 답변 말미: 사람이 읽는 확정안 설명 → JSON 객체 하나 → 가져오기 안내 순서로 쓰세요. 설명·안내에는 중괄호나 다른 JSON을 쓰지 마세요. JSON만 요청받으면 그 객체 하나만 반환해도 됩니다. 답변 전체 또는 JSON만 붙여넣기를 모두 지원합니다.'
      : 'After approval, end with a readable explanation of the settled proposal → one JSON object → import instructions. Do not put braces or other JSON in the explanation or instructions. If asked for JSON only, return just that object. Both the full reply and the JSON alone can be pasted.',
    ...(identity
      ? [
          locale === 'ko'
            ? '아래 봉투의 requestId, packId, baseRevision, contextRevision, generatedAt, kind를 그대로 반환하세요. generatedAt은 답변 시각으로 바꾸지 마세요. result만 확정안으로 채우세요.'
            : 'Return requestId, packId, baseRevision, contextRevision, generatedAt, and kind exactly as shown. Do not replace generatedAt with the reply time. Fill only result with the settled proposal.',
        ]
      : []),
    contract,
    locale === 'ko'
      ? 'JSON 다음 안내: “이 DatePack 결과를 복사해 DatePack의 AI 답안 입력란에 붙여넣고, 미리보기에서 변경을 확인하여 적용하세요. 원문과 고정 조건을 다시 확인하세요.”'
      : 'After the JSON, say: “Copy this DatePack result, return to DatePack, paste it into the AI reply field, and review the changes before applying. Check the original text and protected conditions.”',
  ].join('\n\n');
}
