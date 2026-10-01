# AI 왕복과 일정 변경 수용 시나리오

수용 기준 버전 **1.0 · 2026-10-01**. [공통 계약](ai-flow-contract.md) 1.0과
[서비스 조사](public-map-feasibility.md) 1.0에 대응한다. 아래는 T02–T06가 충족해야 할
조건이며, T01 문서 작성만으로 제품 동작이 통과한 것이 아니다.

검증 기록은 `ID / build 또는 commit / 입력 fixture / mock·live·UI·device 구분 /
실제 관찰 / 기대 결과 / 통과·실패·미검증 / 남은 한계`를 포함한다. 단위 테스트의
모의 route 성공을 실서비스 성공으로 기록하지 않는다. 데스크톱 브라우저 확인을
iOS/Android PWA나 외부 AI 앱·OS 공유 시트 확인으로 확장하지 않는다.

## 먼저 검증할 rain-next-cafe

fixture의 날짜는 **2026-10-01, Asia/Seoul**, 현재 시각은 **16:40**이다. 위치는
사용자 동의 후 이번 요청에서 관찰되었다고 설정한다. 순서는 현재 위치 → `cafe-next`
(기존 카페) → `book-next`(서점) → `dinner-fixed`(18:00 식사 예약)이다. 식사 예약은
time/place/content/delete/order 전부 보호한다. pack revision은 7, contextRevision은 3,
request ID는 `request-rain-001`이다. 후보·장소 ID는 앱 fixture가 만들며 AI가 만들지 않는다.

아래 시간은 **모의 경로·체류 데이터**다. 서비스 조사에서 관찰한 847m/677.7초를
이 카페·서점·예약의 실제 경로로 쓰지 않는다.

| case                    | 현재→후보 | 후보 체류 | 후보→서점 | 서점 체류 | 서점→예약 | 10분 여유 포함 도착 |
| ----------------------- | --------- | --------- | --------- | --------- | --------- | ------------------- |
| A: 가능한 실내 카페     | 10분      | 20분      | 10분      | 10분      | 15분      | 17:55, verified     |
| B: 예약에 늦는 카페     | 25분      | 30분      | 15분      | 10분      | 20분      | 18:30, impossible   |
| C: 마지막 leg 확인 실패 | 10분      | 20분      | 10분      | 10분      | 응답 없음 | unverified          |

1. “비가 와서 다음 카페를 바꾸고 싶다”로 새 요청을 만든다. 실제 화면의 다음 이벤트,
   AI 수정 scope는 `cafe-next` 하나다. 검증 scope에는 뒤의 서점과 예약도 포함한다.
2. AI는 실내 카페 하나를 기본 제안하고 사용자의 승인·거절·다른 제안에 반응한다.
   승인 후 식별값이 일치하는 결과와 가져오기 안내를 답변 말미에 제공한다.
3. 앱은 답안을 붙여넣으면 미리보기를 만든다. A는 전체 동선 근거와 보호된 예약을
   보여 주고 사용자 확인 뒤 저장한다. B는 적용할 수 없고 검증 가능한 A를 우선 제안한다.
4. C는 A를 확인할 수 있으면 그 후보로 안내한다. A도 확인 불가면 원래 일정 유지이며
   “예약 도착을 확인했다”는 성공 표시가 없다. 18:00 예약을 뒤로 미루는 답변은 거부한다.
5. 답안 검토 중 위치·다음 활동·순서·보호 상태·revision이 바뀌거나 5분이 지나면
   기존 검증을 적용하지 않는다. 입력은 보존하고 갱신 후 재검토한다.
6. 저장 성공 후 새 카페가 다음 목적지·지도 검색·출발 안내에 같은 ID로 나타난다.
   방문 완료나 후기를 자동 생성하지 않는다. 저장 실패 시 기존 계획과 입력이 유지된다.

## 독립 수용 조건

| ID  | 입력·조작                                                           | 관찰할 결과                                                                         | 담당·검증 종류                       |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| A01 | 빈 계획에서 AI 생성 시작, 초안 pack 생성                            | 시트가 닫히지 않고 같은 request 계속 사용                                           | T04 UI                               |
| A02 | 날짜·시각 미정, 활동 한 개 요청                                     | 최소 질문과 추천 하나, 미정 값 유지, 가짜 HH:mm 생성 없음                           | T03 parser/prompt + T04 UI           |
| A03 | 승인·거절·다른 제안 반복                                            | 승인 전 후보, 승인 뒤 결과+가져오기 안내. 별도 생성 명령어 불필요                   | T03 prompt 사례, 외부 AI는 별도 live |
| A04 | next와 첫 upcoming이 다름, 사용자가 다음 활동 선택                  | UI·request target·저장 후 목적지가 실제 선택 이벤트로 일치                          | T02/T04 unit+UI                      |
| A05 | next 하나 변경, 마지막 예약 leg가 실패                              | 수정 scope는 하나, 검증은 전체; unverified 대안/기존 유지                           | T02 mock                             |
| A06 | 위 fixture B                                                        | 18:00 예약 도착 불가 근거와 차단, 일부 patch 저장 없음                              | T02 mock+UI                          |
| A07 | fixed 시간·장소·내용·삭제·order 변경, fixed=false, 장소 레코드 우회 | 전부 거부, “적용”으로 해제 불가; 직접 해당 일정 편집만 해제                         | T02 core/store                       |
| A08 | fixed=true와 일부 protectedFields 동시 존재                         | legacy 전면 보호를 일부 필드로 약화하지 않음                                        | T02 compatibility                    |
| A09 | GPS로 예약 장소 근처, 예정 시간 지남                                | 자동 방문·완료·감정·후기 없음, 미확인 과거 유지                                     | T02/T03 unit                         |
| A10 | GPS 동의 전, 거부 또는 철회                                         | GPS/좌표 지도 요청 없음; 직접 장소 입력 가능                                        | T02 mocked geolocation + device      |
| A11 | 동의 후 새 데이트 요청 두 번                                        | 요청별 one-shot GPS 두 번, watchPosition 없음; snapshot 새로 생성                   | T02 mock+device                      |
| A12 | GPS timeout/실패/offline                                            | 마지막 coarse 위치와 원 관찰 시각 및 실패 표시; 새 위치 성공처럼 표시 없음          | T02 mock+UI                          |
| A13 | GPS accuracy>100m 또는 오래된 위치                                  | 출발점 확인 미완료, 직접 확인/갱신 안내; 기존 위치 표시 가능                        | T02 mock                             |
| A14 | coarse reverse 성공/areas 없음/실패                                 | 동네·기준점만 AI 포함; 없으면 입력. GPS 시각을 reverse 시각으로 갱신하지 않음       | T02 adapter+UI                       |
| A15 | AI 복사·공유·file export 검사                                       | 정확 GPS/geometry/원응답/사진 data/개인 출발지 자동 유출 없음. 보낼 내용 확인 가능  | T02/T04 serialization                |
| A16 | walking URL 문자열을 기본 OSRM host에 넣음                          | 도보 verified로 인정하지 않음. 전용 foot endpoint와 mode capability 검사            | T02 adapter; T01 live 근거           |
| A17 | NoRoute/HTTP 403/429/timeout/응답 shape 오류/snap>100m              | unverified 사유 분리, 호출 폭주 없음, 다른 수단 성공으로 대체하지 않음              | T02 mock                             |
| A18 | transit provider 비활성, 차량 요청 없음                             | 걷기·환승 균형 비교 미확인 명시; 차량/택시 자동 삽입 없음                           | T02/T03 mock/prompt                  |
| A19 | 날짜 미정·자정 다음 날·기기 시간대 다른 계획                        | 날짜 강제 없음, dayOffset 보존, 예약 날짜 혼동 없음; 불명 시 unverified             | T02/T03 core                         |
| A20 | 전달한 답안을 닫기·탭 이동·재시작                                   | 검토 전 answerText 포함 동일 초안 복원, 자동 적용 없음                              | T04 storage+UI                       |
| A21 | 다른 pack/request/kind/generatedAt의 답변                           | mismatch, 원문 보존, 해당 요청 수정 안내, 계획 변경 없음                            | T03/T04 parser/store                 |
| A22 | 요청 후 직접 편집/GPS context 변경/drag/undo, 오래된 답변           | stale, 현재 계획 보호, 원문 보존. 재요청 identity 갱신                              | T02/T04/T05 store                    |
| A23 | 같은 답안 재검토·재적용, fingerprint 충돌                           | 미적용 preview 복원 가능; applied request 재적용 불가; 상태·원문도 비교             | T04 unit/storage                     |
| A24 | 입력 저장 실패 또는 적용 transaction 실패                           | 성공 toast 없음, 입력·preview 유지, pack/revision/undo/applied 반쪽 저장 없음       | T04 fault injection                  |
| A25 | 복사 실패·공유 지원 없음·공유 취소                                  | 선택/수동 복사 가능, 요청 남음, 취소는 ready, 특정 AI 자동 실행 요구 없음           | T04 desktop UI, OS 공유는 device     |
| A26 | 영향 없는 순서 drag·위/아래 이동                                    | 즉시 저장+undo, event.order·UI·후속 AI 순서 일치                                    | T05 unit+UI                          |
| A27 | 유동 시각/동선 조정이 필요한 drag                                   | 변경 요약 확인 전 저장 없음, 승인 후 검증된 변경만 저장                             | T05 mock+UI                          |
| A28 | 기존 이벤트가 보호 예약을 앞↔뒤로 넘음                              | drag와 위/아래 동일 차단. 취소/실패 후 원 순서 유지                                 | T05 unit+UI                          |
| A29 | unscheduled activity reorder, 동일 위치 drop                        | 미정 시각 유지, no-op 저장 없음, 불필요한 날짜·시각 입력 요구 없음                  | T05 unit+UI                          |
| A30 | 순서 검증에 경로 부족 또는 예약 늦음                                | unverified는 대안/기존 유지, impossible은 차단; 직선거리로 허용하지 않음            | T05 mock+UI                          |
| A31 | 후기 원문 다듬기 승인·거절·재실행                                   | note 원문 유지, 승인 표현만 editedNote, 실제 경험 ID 일치; 새 사실 삽입 없음        | T03/T04 unit+UI                      |
| A32 | 기존 AI 계획을 요청 ID 없이 가져오기                                | 별도 draft 확인 경로, 현재 plan 덮기 없음, 새 로컬 identity, 기존 request 오인 없음 | T04 parser+UI                        |
| A33 | legacy v1/v2 file, 기존 v3 file 열기/저장/재열기                    | 보호·timing/order·원문 보존, 기기 상태/GPS 휴대용 file 제외                         | T02/T03/T06 core                     |
| A34 | ko/en, AI 없이 직접 계획·데이트·후기 사용                           | 번역 누락 없음, 기존 흐름 이용 가능, 공급자 장애가 메모 수정까지 차단하지 않음      | T06 UI                               |
| A35 | 기본 provider 없이 오프라인 실행                                    | 입력·후기·초안 보존, 위치/경로 미확인 표시, 기존 일정 유지 흐름 정상                | T06 storage+device                   |

### A36 구현 후 impeccable UI audit

최신 `decisions.json` v3의 추가 지시에 따라 T06은 모든 UI 구현이 끝난 후
impeccable 스킬로 desktop/mobile 배치, 접근성·반응형·성능·테마·구현 일관성을
검증하고 detector 결과를 기록한다. 발견 사항의 수정과 확인 결과 또는 남은 제약을
명시한다. 모바일 화면 크기의 배치 audit와 실제 iOS/Android PWA 검증을 구분한다.
T01에서는 UI를 구현하지 않아 이 audit를 미리 완료했다고 주장하지 않는다.

## footer와 parser의 확인 기준

공통 계약의 next-change JSON 예시를 대응 identity로 검사하고 `result`를 core
`parsePatch`로 검사한다. 설명 → JSON 하나 → 가져오기 안내의 전체 답변도 받아야 한다.
여러 객체·identity 변조·누락 result·잘못된 kind는 적용하지 않는다. create는
`parsePlanDraft`와 builder를 함께 확인하고, memory-edit는 선택 experience ID와
비어 있지 않은 editedText를 검사한다.

시각 미정·window·다음 날·새 place를 지원한다고 쓰는 프롬프트는 실제 parser의
지원과 함께 검증한다. 예전 HH:mm·기존 placeId 답변의 호환도 확인한다. 추가 필드를
버려놓고 입력 성공만으로 통과하지 않는다. AI 응답에 들어 있는 경로 상태·이동시간은
실제 provider 증거를 대체할 수 없다.

## T01에서 확인한 것과 남은 검증

T01 live 관찰은 공개 서울 fixture의 OSRM foot·Nominatim public reverse·Transitous
public reverse HTTP 및 로컬 브라우저 CORS다. 기본 OSRM host의 walking/driving
동일 응답도 HTTP control로 확인했다. 상세 입력·시각·결과는 서비스 조사와 증거 JSON에
있다. Nominatim은 실제 GPS용으로 채택하지 않는다.

위 A01–A36 제품 동작은 아직 T01 통과 목록이 아니다. GPS 권한/실기기, 도보의
현장 이동, 한국 transit 실제 route, production origin, iOS Safari·Android Chrome
PWA, 외부 AI 대화의 footer 준수, OS 공유 시트는 후속 live/device 검증이다. T06는
실제로 수행한 자동 검사·브라우저 행동·실기기 증거를 각각 보고하고 미수행은 미검증으로
남긴다. `pnpm verify`와 `pnpm build` 통과만으로 이 외부 조건을 통과시키지 않는다.

## T06 실행 상태 · 2026-10-01

실제 UI/fixture/자동 검사/실기기 구분과 A36 필수 audit 결과는 [ui-audit.md](ui-audit.md)에
보존했다. 앱133/core101 검사와 build는 통과했다. A01/A04/A20/보호 reorder/미확인 유지/ko-en/
후기 원문은 실제 Chrome에서 확인했고, 최신 생산 빌드는 서버 중단 후 재실행·직접 편집·후기
저장·재실행 보존을 확인했다. 실제 OS 다운로드 파일 회수/재가져오기는 환경 제한으로 미검증이다.
A10–A19의 GPS·서비스 성공 및 저장 실패/동시성은 모의 자동 검사 근거이며 실서비스/실기기
통과가 아니다. pointercancel/held edge/실제 touch, iOS/Android/PWA/VoiceOver/OS 공유와 실제 외부
AI 반응 준수는 미검증으로 남긴다. T07의 [60초 대본](demo-video-script.md)과
[녹화 없는 실제 리허설](demo-rehearsal.md)은 desktop/CSS390px에서 수제 memory 답안으로
수행했다. 외부 LLM·영상 제작·게시 통과로 확장하지 않으며 메인 검토를 기다린다.
