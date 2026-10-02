/**
 * Korean message catalog for @datepack/core — the source of truth for the
 * package's message keys. en.ts must carry every key here (enforced by the type).
 *
 * Covers everything the package itself emits: read/validation/patch errors,
 * plan-consistency warnings, and the AI-patch change-rendering strings.
 * The app merges this catalog into its own (see src/i18n/core.ts there), so
 * package issues localize transparently through the app's t()/format().
 *
 * 원칙: 각 언어는 번역이 아니라 그 언어권에서 자연스러운 문장으로 "재생성"한다.
 */
export const ko = {
  // change rendering (AI patch preview)
  'change.replace': '"{title}"에서 {details} 변경',
  'change.move': '"{title}" 시간을 {from} → {to}으로 이동',
  'change.remove': '"{title}" 일정 삭제',
  'change.insertBefore': '"{title}" 앞에 "{newTitle}"({time}) 일정 추가',
  'change.insertAfter': '"{title}" 뒤에 "{newTitle}"({time}) 일정 추가',
  'change.insertFirst': '첫 일정으로 "{newTitle}"({time}) 추가',
  'change.field.start': '시작을 {from} → {to}으로',
  'change.field.end': '종료를 {from} → {to}으로',
  'change.field.title': '이름을 {from} → {to}으로',
  'change.field.type': '종류를 {from} → {to}으로',
  'change.field.note': '메모 수정',
  'change.field.travel': '이동 시간을 {from}분 → {to}분으로',
  'change.field.fixedOn': '고정 일정으로 지정',
  'change.field.fixedOff': '고정 해제',
  'change.field.other': '{field}을 {to}으로',
  'change.field.none': '없음',
  'change.fixedTag': '(고정 일정)',

  // error keys (the package throws these; the UI renders them localized)
  'err.read.badZip': 'DatePack 파일을 여는데 실패했어요. 손상되었거나 지원하지 않는 형식이에요.',
  'err.read.noManifest': 'manifest.json이 없어요. DatePack 파일이 맞나요?',
  'err.read.badManifest': 'manifest.json을 파싱할 수 없어요.',
  'err.read.noEntry': '일정 데이터(plan)가 없어요. DatePack 파일이 맞나요?',
  'err.read.badPlan': 'plan.json을 파싱할 수 없어요.',
  'err.read.badAssets': 'assets.json을 파싱할 수 없어요.',
  'err.read.invalidContent': 'DatePack 내용에 문제가 있어요:',
  'err.read.formatWrong': 'DatePack 포맷이 아닙니다. (format: {value})',
  'err.read.unsupportedVersion':
    '지원하지 않는 포맷 버전입니다 (v{value}). 이 앱은 1.0 ZIP, 2.0 JSON, 3.0 JSON을 읽을 수 있으며 원본 파일은 보존됩니다.',
  'err.read.badVersion': '읽을 수 없는 포맷 버전입니다: {value}',
  'err.read.newerVersion':
    '이 DatePack은 더 새로운 호환 포맷(v{value})으로 만들어졌어요. 일부 필드는 무시될 수 있습니다.',
  'err.plan.noId': 'plan.id가 필요합니다.',
  'err.plan.noTitle': 'plan.title이 필요합니다.',
  'err.plan.badDate': 'plan.date는 YYYY-MM-DD 형식이어야 합니다.',
  'err.plan.eventsArray': 'plan.events는 배열이어야 합니다.',
  'err.plan.eventId': 'events[{index}].id가 필요합니다.',
  'err.plan.eventTitle': 'events[{index}].title이 필요합니다.',
  'err.plan.dupId': 'events[{index}]: 중복된 event id "{id}"',
  'err.plan.dupAssetId': 'assets: 중복된 asset id "{id}"',
  'err.plan.startInvalid': 'events[{index}].start는 HH:mm 형식이어야 합니다.',
  'err.plan.endInvalid': 'events[{index}].end는 HH:mm 형식이어야 합니다.',
  'err.plan.typeInvalid':
    'events[{index}].type "{value}"은(는) 알 수 없는 종류입니다. type은 반드시 지정해주세요.',
  'err.plan.typeRequired': 'events[{index}].type이 필요합니다.',
  'err.plan.planBTitle': 'events[{index}].planB.title이 필요합니다.',
  'err.plan.travelInvalid': 'events[{index}].travelMinutes는 0 이상의 숫자여야 합니다.',
  'err.plan.assetIds': 'events[{index}].assetIds는 배열이어야 합니다.',
  'err.plan.placesArray': 'plan.places는 배열이어야 합니다.',
  'err.plan.assetMissing': '에셋 "{id}"를 찾을 수 없습니다. (파일 누락)',
  'err.plan.brokenReference': '{field}에서 참조한 ID "{id}"가 없습니다.',
  'err.plan.manifestVersion': 'manifest.version이 필요합니다.',
  'err.patch.wrongType': 'type이 "datepack.patch"가 아닙니다. (현재 값: {value})',
  'err.patch.badVersion': '지원하지 않는 patch 버전입니다. (version: {value})',
  'err.patch.opsArray': 'operations는 배열이어야 합니다.',
  'err.patch.notOperation': 'operations[{index}]: operation 객체가 아닙니다.',
  'err.patch.unknownOp': 'operations[{index}]: 알 수 없는 op "{value}"',
  'err.patch.noTarget': 'operations[{index}]: target event id가 필요합니다.',
  'err.patch.noValue': 'operations[{index}]: value 객체가 필요합니다.',
  'err.patch.needTitle': 'operations[{index}]: 새 일정에는 title이 필요합니다.',
  'err.patch.needStart': 'operations[{index}]: 새 일정 start는 HH:mm 형식이어야 합니다.',
  'err.patch.badType': 'operations[{index}]: 알 수 없는 일정 종류 "{value}"',
  'err.patch.badTime': 'operations[{index}]: {field}는 HH:mm 형식이어야 합니다.',
  'err.patch.emptyReplace': 'operations[{index}]: 바꿀 내용이 비어 있습니다.',
  'err.patch.badFixed': 'operations[{index}]: fixed는 boolean이어야 합니다.',
  'err.patch.badTravel': 'operations[{index}]: travelMinutes는 0 이상의 숫자여야 합니다.',
  'err.patch.badJson': 'JSON 파싱에 실패했어요: {detail}',
  'err.patch.notJson': 'Patch JSON을 읽을 수 없습니다.',
  'err.patch.unknownTarget': '"{target}" 일정을 찾을 수 없어 이 변경은 건너뛰었어요.',
  'err.patch.noAnchor': '기준 일정 "{target}"을(를) 찾을 수 없어 이 변경은 건너뛰었어요.',
  'err.patch.emptyOnly': '첫 일정 추가는 비어 있는 계획에서만 할 수 있어요.',
  'err.patch.protected': '보호된 일정 "{title}"은(는) AI 변경안으로 수정할 수 없어요.',
  'err.patch.protectedOrder': '이 변경안은 보호된 일정의 순서를 바꿔요.',
  'err.patch.stale': '미리보기 이후 계획이 바뀌었어요. 변경안을 다시 검토해주세요.',
  'err.patch.nothingApplied': '적용할 수 있는 변경이 없어요.',

  // plan-level consistency warnings (advisory — shown in the AI review card)
  'warn.conflict.overlap': '"{prev}"과(와) "{next}" 일정이 겹쳐요.',
  'warn.conflict.travel': '"{next}"은(는) 이동 시간 {minutes}분을 고려하면 너무 이르게 시작해요.',
  'warn.conflict.endBeforeStart': '"{title}" 일정의 종료가 시작보다 앞서 있어요.',
  'warn.conflict.orderTime':
    '일정에서는 "{next}"가 뒤에 있지만 "{previous}"보다 먼저 시작할 수 있어요.',

  // plan draft (AI-authored datepack.plan)
  'err.planDraft.notJson': '계획 JSON을 찾지 못했어요. AI가 답한 내용 전체를 붙여넣어 주세요.',
  'err.planDraft.wrongType': 'type이 "datepack.plan"이 아닙니다. (현재 값: {value})',
  'err.planDraft.badVersion': '지원하지 않는 plan 버전입니다. (version: {value})',
  'err.planDraft.noTitle': 'title이 필요합니다.',
  'err.planDraft.badDate': 'date는 YYYY-MM-DD 형식이어야 합니다.',
  'err.planDraft.eventsArray': 'events는 배열이어야 합니다.',
  'err.planDraft.noEvents': 'events에 일정이 최소 1개 필요합니다.',
  'err.planDraft.eventTitle': 'events[{index}].title이 필요합니다.',
  'err.planDraft.startInvalid': 'events[{index}].start는 HH:mm 형식이어야 합니다.',
  'err.planDraft.endInvalid': 'events[{index}].end는 HH:mm 형식이어야 합니다.',
  'err.planDraft.typeInvalid': 'events[{index}].type "{value}"은(는) 알 수 없는 종류입니다.',
  'err.planDraft.travelInvalid': 'events[{index}].travelMinutes는 0 이상의 숫자여야 합니다.',
  'err.planDraft.placeString': 'events[{index}].place는 문자열이어야 합니다.',
  'err.plan.outingConditions': '혼자·함께, 지역, 원화 예산과 소요 시간을 확인해주세요.',
  'err.planDraft.constraints': 'constraints의 must/prefer/avoid는 문자열 배열이어야 합니다.',
  'err.planDraft.memo': 'memo는 문자열이어야 합니다.',
  'err.planDraft.timingInvalid':
    'events[{index}].timing이 잘못되었거나 start/end와 일치하지 않아요. 다음 날은 dayOffset으로 표시하세요.',
  'err.planDraft.durationInvalid':
    'events[{index}].estimatedDurationMinutes는 0 이상의 숫자여야 합니다.',
  'err.planDraft.protectionInvalid':
    'events[{index}].protectedFields에는 time/place/content/delete/order만 사용할 수 있어요.',
  'err.planDraft.note': 'events[{index}].note는 문자열이어야 합니다.',
  'err.planDraft.unsupportedField':
    '지원하지 않는 필드 "{field}"가 있어요. 요청문의 결과 형식으로 다시 답해주세요.',
} as const;

export type DatePackIssueKey = keyof typeof ko;
