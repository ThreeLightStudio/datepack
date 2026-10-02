# DatePack AI 왕복과 검증 계약

계약 **2.0 · 앱/코어 0.4.0 · 파일 4.0 · 2026-10-02 (Asia/Seoul)**.
승인된 U01–U04 계획과 검토된 누적 구현이 기준이다. AI 봉투 버전은 그대로
`datepack.response` v2, 생성 draft는 `datepack.plan` v1, patch는 v1이다.
이 문서는 현행 경계이며 T01–T07 과거 설계보다 우선한다.

공개 서비스의 실제 가능 범위는 [서비스 조사](public-map-feasibility.md),
관찰할 결과는 [수용 시나리오](ai-flow-acceptance.md)에 연결한다.

## 세 단계와 사용자 반응

| 단계 | 기준 맥락                                                         | AI가 할 일                               | 자동으로 만들면 안 되는 사실                   |
| ---- | ----------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| 계획 | 예정 지역·날짜·가능 시간·취향·고정 조건                           | 필요한 정보만 묻고 기본 추천 하나를 제안 | 미정 날짜·시각, 확정되지 않은 예약             |
| 외출 | 새 요청의 현재 시각·최근 위치·현재 활동·사용자가 정한 다음 목적지 | 다음 활동 또는 남은 계획을 제안          | GPS에 근거한 방문·완료·건너뜀·감정             |
| 후기 | 사용자가 확인한 실제 경험과 원문                                  | 사실을 보존하며 표현을 정리              | 계획을 실제 경험으로 전환, 없는 대화·감정·방문 |

AI는 승인·거절·다른 제안·사용자의 직접 조작에 반응한다. 승인 전에는 후보이며
현재 일정에 자동 반영하지 않는다. 승인 후 AI 답변 말미에 DatePack 결과와
가져오기 안내를 붙인다. 별도 생성 명령어를 요구하지 않는다. AI 대화에서의
승인과 앱에서 변경 미리보기를 확인하여 저장하는 행동은 별도다.

계획 상태는 **후보 → 현재 선택한 일정 → 보호 조건**만 사용한다. 공동 합의나
상대방 승인 상태를 추가하지 않는다. 각자 출발·만남·대기·마무리·귀가는 세 단계의
맥락으로 표현하며 별도 필수 화면이나 완료 입력 절차를 만들지 않는다.

## 문서·조건·기기 경계

- `DatePack` 4.0은 outing/memories union. outing만 plan/originalPlan을 갖고
  재계획 API를 사용한다. 독립 기록에는 없는 일정·동행 맥락을 만들지 않는다.
- response의 `packId`는 **문서 ID**다. 실제 plan/patch는 `pack.plan.id`를
  사용한다. 복사본에서 두 ID가 달라도 요청·답안·revision 검사가 동작한다.
- `DatePlan.outingConditions`는 party?, region?, durationMinutes?(1–1440),
  nearby?, singleStop?, budget?를 저장한다. 예산은 KRW의 음이 아닌 안전한 정수와
  basis=`total | per-person`이다. 금액 0도 허용하며 확인된 지출을 뜻하지 않는다.
- 직접 생성과 AI 생성/재계획은 같은 조건을 사용한다. 빠른 조건 기본값은 120분,
  10,000원이며 편집할 수 있다. 혼자 조건은 합류·동행자 답변을 요구하지 않는다.
  미정 날짜·정확한 시각을 채워 넣지 않으며, availableFrom/mustEndBy는 선택이다.
- 생성 답안에서 사용자 조건·날짜·시간을 변경/생략해도 사용자 초안을 유지한다.
  store guard가 조건 교체를 재검사한다. 기존 가져온 AI 계획은 새 draft로 검사해
  별도 request identity를 만들고 현재 파일/계획을 덮지 않는다.
- 파일 reader는 4.0만 허용하며 4.1을 포함한 다른 버전은 거부한다. 기존 3.0 로컬 자료의 변환은 별도 경계다.
  사진·정확 좌표·개인 출발·runtime·요청·초안은 휴대 문서 밖 기기 상태에 둔다.
- 새 기록 입력은 record-form:new, 편집은 record-form:edit:<documentId>:<experienceId>,
  legacy 복원은 record-form:legacy:<documentId>. 기존 memory:<documentId 또는 planId>는
  읽기 복원 대상으로 보존한다. 답안은 ai-form:memory-answer:<documentId>에 분리한다.
  답안-only legacy 입력을 새 기록으로 해석하지 않고 request/experience를 대조한다.
- 기록 문장 요청에는 선택한 원문만 보낸다. `note`, 사진, 연결, occurredOn/timing,
  recordedAt을 AI가 변경할 수 없다. `editedNote`는 별도 저장하며 원문을 보존한다.
- 장문 요청·검토는 전용 화면이고 짧은 작업은 시트다. 닫기/뒤로/탭/재실행은 저장된
  요청과 입력의 재개이며 취소·적용과 다르다. 새로운 미저장 사진은 앱 종료 후 재선택한다.

공유 코드 경계는 `packages/datepack/src/{types,planDraft,patch,json}.ts`,
`src/features/ai/{exchange,promptBuilder,createPromptBuilder}.ts`,
`src/storage/indexedDb.ts`, `src/features/memories/recordDrafts.ts`,
`src/features/day/{dayRuntime,nextDestination}.ts`다. parser/타입/저장 경계를 함께 유지한다.

## 보호와 변경 범위

- `fixed: true`인 legacy 이벤트는 time/place/content/delete/order 전부 보호한다.
  `protectedFields`가 함께 있어도 전면 보호를 약화하지 않는다. 그 외에는 명시한
  필드만 보호한다. `importance: core`는 보호와 다르다.
- time은 `timing`과 legacy `start/end`, place는 `placeId`와 연결된 장소의
  이름·검색어 변경, content는 title/type/note를 포함한다. 장소 레코드를 바꾸어
  보호를 우회하거나 이벤트를 삭제 후 재생성하는 것도 거부한다.
- AI는 보호 필드와 보호 설정을 변경·해제할 수 없다. 일반적인 “좋아”, “적용”은
  해제 승인이 아니다. 해당 일정의 보호를 사용자가 직접 편집해야만 해제된다.
- order 보호는 고정 이벤트와 **남아 있는 기존 이벤트의 앞뒤 관계**를 보호한다.
  고정 항목의 숫자 인덱스가 바뀌었다는 이유만으로 막지 않는다. 다른 기존 항목을
  고정 항목 너머로 넘기는 이동은 양쪽 방향 모두 차단한다. 새 활동의 삽입은
  다른 보호 조건과 전체 동선을 만족할 때만 허용한다.
- 변경 scope와 검증 scope를 분리한다. next-change의 target은 화면에 표시된
  실제 다음 이벤트 ID와 같아야 한다. remaining-change는 미확인 과거를 임의로
  포함하지 않고, 사용자가 재포함한 이벤트만 포함한다.
- 한 카페를 바꾸더라도 현재 위치 → 새 카페 → 뒤따르는 활동 → 영향받는 고정
  예약까지 검사한다. 종료 제한이나 이후 고정 예약에 영향이 전파되면 그 구간도
  이어서 검사한다. scope 밖 이벤트를 검사하기 위해 AI에 수정 권한을 주지 않는다.
- 보호 위반·scope 위반·확인된 도착 불가가 하나라도 있으면 변경 묶음 전체를
  거부한다. 유효 operation만 골라 일부 적용하지 않는다. 예약 변경을 대안으로
  유도하지 않는다.

## 위치 동의와 freshness

위치 설명은 “새 AI 요청마다 현재 위치를 한 번 조회하며, 필요한 지도 서비스에
좌표가 전달될 수 있다”를 담고 서비스·목적·로그 정책 링크를 보여 준다. 브라우저의
기술적 권한과 앱 동의를 함께 확인한다. 허용해도 `watchPosition`을 사용하지 않는다.
후기나 예정 지역을 다루는 계획 요청에는 현재 GPS를 필수로 요청하지 않는다.

외출의 새 요청·다시 만들기마다 `getCurrentPosition`을 한 번 호출한다. initial
권장 옵션은 `maximumAge: 0`, `timeout: 10000`, `enableHighAccuracy: false`다.
기술적 기본값은 사용자 정책 변경이 아니며 실기기 근거로 조정할 수 있다. 실패,
거부, timeout, offline, 지원 안 됨을 각각 저장하고 성공으로 표시하지 않는다.
동의 전·철회 후에는 GPS와 좌표를 보내는 지도 요청을 실행하지 않는다.

정확한 좌표는 기본적으로 메모리에서만 유지한다. 기기 저장에는 coarse 장소와
확인 시각·출처·실패 상태를 남긴다. 앱 종료 후 정확한 위치가 필요한 검증은 다시
조회한다. 요청·답안 초안은 계속 보존한다. 좌표와 경로 원응답을 UI 오류 로그나
분석 로그에 덤프하지 않는다.

역지오코딩 성공은 GPS 관찰 시각을 갱신하지 않는다. coarse 변환은 허용된 서비스
응답의 city/borough/suburb 등 행정 구역이나 확인 가능한 주변 기준점으로 제한하고
집 번호·상세 주소·lat/lon·geometry·검색 URL을 AI 맥락에서 제외한다. Transitous는
`areas`를 우선 사용한다. `score`는 거리나 정확도 수치로 해석하지 않는다. 해당
지역 정보가 없으면 장소 입력으로 이어간다.

GPS 실패 시 “마지막 확인: 명동, 16:40 · 현재 위치 조회 실패”처럼 마지막 coarse
위치와 **그 관찰 시각**을 표시한다. 마지막 위치를 현재 위치로 승격하지 않는다.
사용자가 장소를 직접 확인하면 새 manual 관찰을 만들고 contextRevision을 증가시킨다.
직접 입력 문자열도 자동으로 유효 좌표가 되지 않는다.

기술 기본값은 위치/경로 증거 최대 수명 **5분**, GPS accuracy 허용 상한 **100m**,
경로 endpoint snap 허용 상한 **100m**다. 정확도가 낮거나 오래된 위치를 표시하는
것은 가능하지만 현재 출발점 검증에는 쓰지 않는다. 지도 오차를 이용해 더 빠른
경로를 만들지 않는다. TTL 내라도 위치·다음 목적지·계획·수단·출발 시각·보호 조건이
달라지면 즉시 무효다. 적용 시 시간이 흐른 만큼 예약 도착을 다시 계산한다.

## 경로 상태와 전체 영향 동선

`verified`는 선택 수단의 실제 경로 응답과 유효한 입력에 근거한 계산이라는 뜻이다.
실제 방문, 현장 보행 가능, 실시간 폐쇄·혼잡, 열차 운행, 정시 도착 보장이 아니다.
도보만 확인했으면 “도보 경로 확인”으로 표시하며 대중교통과 균형 비교를 확인했다고
표시하지 않는다. 기본 추천은 시간·걷기·환승을 함께 고려하되 확인되지 않은 수단을
채워 넣지 않는다. 차량/택시는 사용자 요청이 있을 때만 후보에 포함한다.

| 상태       | 조건                                                                                             | 변경 처리                                                   |
| ---------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| verified   | 실제 지원 수단·endpoint·좌표·시각·모든 영향 leg·활동 체류 시간이 유효하고 고정 조건 내 계산 가능 | 근거와 변경 요약을 미리보기로 보여 주고 사용자 확인 후 적용 |
| unverified | 공급자 없음/조건 미충족/CORS 실패/timeout/좌표 모호/오래됨/체류 미정/구간 누락/지원 불명         | 검증 가능한 다른 후보 우선, 없으면 기존 일정 유지           |
| impossible | 유효 증거와 확정 시간 조건으로 예약/종료 제한 위반이 확인됨                                      | 적용 차단, 가능한 다른 후보 또는 기존 유지 안내             |

공급자가 `NoRoute`를 반환해도 전 세계 모든 수단의 이동 불가능으로 해석하지 않는다.
선택한 경로가 없다는 사유로 unverified 처리한다. 증거가 이미 있는 하위 구간에서
고정 시각을 넘는다면 나머지 leg가 미확인이어도 impossible 근거를 남길 수 있다.
직선거리·AI의 travelMinutes·지도 링크·사용자 이동 시간 메모는 경로 증거가 아니다.

알고리즘은 보호 검사 → 실제 다음 이벤트와 변경 scope 고정 → 변경 전후 영향 동선
산출 → 장소 해석 및 출발점 freshness 확인 → leg별 경로 조회/캐시 확인 → 체류·대기·
환승·예약 시각 누적 → 결과 생성 순서다. OSRM 초는 분으로 올림하며 응답의
`waypoints.distance`와 좌표 snap을 확인한다. 고정 시각까지의 ETA에 기본 **10분
도착 여유**를 더해 비교한다. 10분은 기술적 안전 여유이며 공급자의 예측 정확도가
아니다. 알 수 없는 대기·체류 시간을 0으로 넣지 않는다. 미정 시각을 채워 넣는 대신
검증 미확인 사유를 표시하고 후보 변경을 보류한다.

현재 위치가 필요 없는 계획의 경우 사용자가 정한 시작 장소와 예정 시각을 사용한다.
날짜가 없거나 transit 출발 일시를 만들 수 없으면 대중교통 검증은 unverified다.
근거가 필요 없는 텍스트 편집·같은 장소에서의 메모 수정은 경로 공급자 장애 때문에
막지 않는다. “영향 없음”을 순서/장소/시간/보호 조건 비교로 설명할 수 있어야 한다.

## 기기 전용 위치·영향 API

아래는 검증 의미를 설명하는 인터페이스다. 실제 이름은 코드 타입을 참조한다.
공급자 원응답이나 정확 좌표를 DatePack에 추가하지 않는다.

```ts
type RouteState = 'verified' | 'unverified' | 'impossible';
type TravelMode = 'walking' | 'transit' | 'car' | 'taxi';
type LocalCoordinate = { lat: number; lon: number; accuracyMeters?: number };
type LocationObservation = {
  source: 'gps' | 'manual';
  observedAt: string; // instant, ISO 8601 with offset/Z
  coarseLabel: string;
  coordinate?: LocalCoordinate; // memory only
};
type LocationAttempt = {
  attemptedAt: string;
  status: 'success' | 'denied' | 'timeout' | 'unavailable' | 'offline';
  observation?: LocationObservation;
  lastKnown?: Omit<LocationObservation, 'coordinate'>;
};
type ResolvedPlace = {
  placeId: string;
  coordinate: LocalCoordinate; // memory only
  source: string;
  querySnapshot: string;
  resolvedAt: string;
  userConfirmed: boolean; // duplicate/ambiguous matches require confirmation
};
type RouteEvidence = {
  id: string;
  provider: string;
  endpoint: string; // base URL only; no GPS query stored
  mode: TravelMode;
  fromKey: string;
  toKey: string;
  coordinateDigest: string; // opaque memory-local key; not exported
  fetchedAt: string;
  departureAt: string;
  durationSeconds: number;
  distanceMeters: number;
  walkingMeters?: number;
  transfers?: number;
  basis: 'osm-static' | 'timetable' | 'realtime';
  attribution: string;
};
type ValidationSnapshot = {
  planId: string; // document ID in the existing snapshot API
  planRevision: number;
  contextRevision: number;
  requestId?: string;
  candidateDigest: string;
  orderedEventIds: string[];
  scopeEventIds: string[];
  mode: TravelMode;
  evaluatedAt: string;
};
type ImpactResult = {
  status: RouteState;
  snapshot: ValidationSnapshot;
  evidenceIds: string[];
  affectedEventIds: string[];
  reasonCodes: string[];
  anchorArrivals: Array<{ eventId: string; arrivalAt: string; deadlineAt: string }>;
};
```

필요한 경계는 `acquireLocation(consent)`, `toCoarseContext(observation)`,
`resolvePlace(publicVenueQuery)`, `fetchRoute(mode, endpoints, departureAt)`,
`validateImpact(before, proposed, context)`, `prepareReorder(eventId, beforeId)`,
`commitReviewedChange(snapshot, proposed)`에 해당한다.
외부 I/O와 계산을 분리하고, 테스트에서는 provider를 교체할 수 있게 한다.

이유 코드에는 최소한 `provider-disabled`, `unsupported-mode`, `service-terms`,
`cors-or-network`, `location-stale`, `location-inaccurate`, `place-unresolved`,
`snap-too-far`, `duration-unknown`, `missing-leg`, `evidence-stale`, `anchor-late`,
`protected-field`, `protected-order`, `scope-mismatch`, `snapshot-stale`을 구분한다.
브라우저의 fetch 예외만으로 CORS와 네트워크 장애를 단정하지 않는다.

## AI에 보내는 범위와 footer

복사/공유 전에 실제 보낼 문장과 coarse 위치·확인 시각을 확인할 수 있게 한다.
serialization은 필요한 필드를 선택하는 allowlist로 한다. `DeviceState`나 provider
원응답 전체를 JSON.stringify하지 않는다. 사진·asset data·정확 좌표·개인의 출발지는
자동 첨부하지 않는다. 선택한 장소의 공개 이름과 예약 시각은 필요한 계획 정보로 포함한다.

반응 중심 대화의 마지막은 사람에게 설명하는 확정안 → **JSON 객체 하나** →
“이 DatePack 결과를 복사해 DatePack의 ‘AI의 답’에 붙여넣고 변경을 확인하여
적용하세요”라는 안내로 구성한다. 답변 전체 붙여넣기와 JSON만 복사하기를 모두 다룬다.
전체 답변에 여러 JSON, 설명 중의 중괄호, 다른 요청의 결과를 섞지 않는다.
현행 `extractJsonObject`가 첫 `{`부터 마지막 `}`까지 추출하기 때문이다.

```json
{
  "type": "datepack.response",
  "version": 2,
  "requestId": "request-rain-001",
  "packId": "plan-rain-001",
  "baseRevision": 7,
  "contextRevision": 3,
  "generatedAt": "2026-10-01T07:40:00.000Z",
  "kind": "next-change",
  "result": {
    "type": "datepack.patch",
    "version": 1,
    "operations": [
      { "op": "replace", "target": "event:cafe-next", "value": { "placeId": "place-cafe-alt" } }
    ]
  }
}
```

이 예시는 기존 place ID를 쓰는 현행 parser 호환 예시이며 경로 검증 성공을 뜻하지
않는다. kind별 result는 create=`datepack.plan` v1, 변경=`datepack.patch` v1,
memory-edit=`{ experienceId, editedText }`다. 식별값 6개는 앱이 만들고 AI가 그대로
반환한다. `generatedAt`을 답변 시각으로 바꾸지 않는다. AI가 경로 증거나 검증 상태를
반환해도 신뢰하지 않는다. 기록 원문 `Experience.note`를 유지하고 정리한 표현은
`editedNote`에 저장한다.

하위 호환 v1 입력 확장은 create/new event의 optional `start`, optional
`timing: EventTiming`, `estimatedDurationMinutes`, `protectedFields`와 replace의
`place`/`timing`을 대상으로 한다. 기존 HH:mm 입력을 계속 받고, 두 형식이 모순되면
거부한다. 시간 없음은 unscheduled, window와 dayOffset은 손실 없이 다루며 명시적
배열 순서를 유지한다. parser가 보호 조건을 안전하게 받고 앱에서 다시 검사한다.
지원하지 않는 JSON을 프롬프트에서 요구하거나 parser가 버린 필드로 성공을 주장하지 않는다.
AI의 보호 해제는 금지한다.

AI에서 이미 만든 계획은 draft로 가져오며 현재 계획을 덮지 않는다. request ID가 없는
기존 AI 결과를 현재 request의 답변으로 위장하지 않는다. 별도의 첫 가져오기 경로에서
draft를 검사하고 새 로컬 request identity를 만들어 확인한다.

## 저장과 stale 판정

`PendingRequest`의 input/answerText/payload/scope/identity/status를 입력 중과 닫기 전에
저장한다. 저장 완료 전에 전송 완료나 적용 성공을 표시하지 않는다. 첫 빈 상태에서 plan을
만들어도 AI 작업 화면과 같은 request를 유지한다. 닫기는 취소와 다르다.
닫기·탭 왕복·외부 AI 왕복·재시작 후 같은 request와 답안을 재개한다.

답변을 받을 때 봉투 일치, 현재 planRevision/contextRevision, request status, scope,
중복을 검사한다. preview 복원은 허용하되 applied request는 재적용하지 않는다. 현행
fingerprint는 중복 검출용이며 서명이 아니므로 request 상태와 원문도 대조한다.
다른·오래된·중복·잘못된 답안은 원문을 보존하고 이유와 새 request로 수정하는 안내를 보여 준다.

적용할 때 preview 이후 plan/context 변경과 시간 경과, 위치·증거 TTL, 후보 digest,
보호 상태, 전체 영향 동선을 다시 검사한다. GPS는 새 request에서 조회하며 적용 시
만료되었으면 “위치를 갱신해 다시 확인”하도록 안내한다. pack 갱신, revision 증가,
undo, applied 상태는 같은 IndexedDB transaction에서 commit한다. 저장 실패 시 입력과
preview를 유지하고 applied로 만들지 않으며 재시도를 지원한다. 계획 변경에서 runtime이나
experience를 추측하지 않는다.

`ready → waiting → review → applied`를 중심으로 draft/error/stale/cancelled를 다룬다.
공유 취소는 ready로 돌아가고, 붙여넣기 review는 미적용 상태로 저장한다. 실패 후 재시도에서
다른 plan에 잘못 적용하지 않는다. 적용 후 목적지·출발 안내·지도는 commit 이후 계획 순서와
같은 다음 이벤트를 사용하며 오래된 대상이나 후보를 표시하지 않는다.

## 직접 순서 변경

drag는 순서 변경 의도다. handle/drop 위치, touch 조작, 키보드로 쓸 수 있는 위/아래
버튼을 제공한다. 같은 위치의 drop은 no-op이다. 날짜·시간·장소를 바꾸지 않고 보호 경계나
동선에 영향이 없는 이동은 저장+undo를 제공한다. 시각 미정 활동에 시각을 강제하지 않는다.
계획 표시·AI scope·파일의 event.order는 같은 순서를 사용한다.

시각/동선 추가 조정이 필요하면 조정안을 요약해 확인받는다. 고정 조건 위반·확인된 예약
도착 불가면 차단한다. 필요한 동선이 unverified면 검증 가능한 다른 순서를 제안하고
없으면 기존 순서를 유지한다. undo도 commit 시 revision을 검사하여 다른 변경을 덮지
않는다. undo로 위치 context를 되돌리지 않고 새 계획에 대해 검증한다.

## 날짜와 URL 경계

예정일 `YYYY-MM-DD`와 순간의 ISO 시각을 혼동하지 않는다. `LocalPoint.dayOffset`으로
다음 날을 표현하고, 예약 18:00은 계획일·지역의 시각으로 다룬다. 이번 대상은 Asia/Seoul이다.
날짜 미정을 오늘로 바꾸지 않는다. 다른 시간대 여행을 단말 시각만으로 검증하지 않는다.
시간대를 확정할 수 없으면 시간에 의존하는 검증은 unverified다.

외부 서비스는 공개 HTTPS·allowlist endpoint에만 연결한다. AI가 반환한 URL을 검증
목적으로 fetch하지 않는다. OSRM은 lon,lat, MOTIS는 lat,lon으로 순서가 다르다. 좌표의
범위·유한값과 초/분/미터 단위를 검사한다. 브라우저 fetch는 credentials omit이며
API 키나 가짜 User-Agent를 붙이지 않고 일반 Referer를 사용한다. query는 안전하게
encode한다. MapBridge의 URL-safe Base64는 암호화가 아니다. GPS나 개인 입력을 지도
검색 URL에 자동으로 섞지 않는다. AI 복사·공유·portable writer는 각각 allowlist로 검사한다.
