# T06 통합 UI audit

2026-10-01 · `codex/datepack-ai-flow` · 입력 `e9e6716` + T06 변경.
**Implementation Integrity: 통과(조건부).** 같은 계획에서 선택한 활동, 보호 예약,
현재 상황, 원문/확인한 문장을 구분하는 기존 제품 구조를 유지한다. 장식용 지표나
검증되지 않은 경로 성공을 추가하지 않았다. 진행 중 요청의 범위 선택 표시에는
아래 P2 혼동이 남는다. 제품 전체 완료는 T07 대본과 녹화 없는 리허설 이후 판단한다.

## 방법과 범위

- 필수 `/Users/three-light/.agents/skills/impeccable/SKILL.md`, `reference/audit.md`,
  `reference/craft-floor.md`를 읽고 `context --target src/app/App.tsx`를 한 번 실행했다.
  PRODUCT.md/DESIGN.md는 없다. 기존 CSS/tokens/components를 시각 권위로 사용했다.
  새 디자인 체계를 만들거나 브랜드를 바꾸지 않았다.
- desktop/mobile 사전 관찰 → 한 fix batch → 한 최종 confirmation batch.
  추가 미세 수정/재감사 루프는 수행하지 않았다. 최종 확인에서 발견한 P2는 아래에 남겼다.
- detector 한 번: `detect --json src/app src/components src/features src/styles`.
  [원결과](evidence/t06/detector.json)는 `[]`. 기계적 탐지 결과와 아래 시각/동작 판단은 별개다.
- macOS Chrome 실제 브라우저 포인터/키보드. 기본 desktop CSS 1291×828,
  별도 생산 빌드 탭 CSS 1291×772. 모바일은 Chrome viewport CSS **390×844**와 320×740.
  모두 DOM으로 크기를 확인했고 문서의 가로 넘침은 없었다.
  앞선 IAB 사전 확인은 기본 1600×900, override 312×675가 실제 CSS390×844였다.
- 모든 입력은 T06 로컬 fixture다. AI 답안도 식별값을 보존한 수제 fixture이며 실제 LLM 답안이 아니다.
  서비스 성공 fixture, 실제 UI 동작, 실기기 결과를 서로 대체하지 않았다.

## 점수

| 차원                     | 점수 /4          | 근거                                                                                                    |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------- |
| Accessibility            | 3                | 초기 Shift+Tab 탈출 보완, 전역 focus ring/라벨/상태, 영어 Close 확인. VoiceOver/TalkBack 미검증         |
| Performance              | 3                | 보이는 동작에서 멈춤 없음, drag는 ref와 한 animation frame을 사용. 초기 JS 612.07kB 경고 잔존           |
| Responsive Design        | 3                | 390/320px에서 overflow 없음, drag/화살표/위아래 대체. 일부 보조 컨트롤 44px 미만, 실제 touch 미검증     |
| Theming                  | 3                | 기존 rose/cream 토큰 유지, native light scheme, 오류/경고 텍스트 대비 보완. 일부 legacy 상태색 하드코딩 |
| Implementation Integrity | 3                | detector 0, 계획/사실/보호/미확인 일관. 현재 요청과 범위 선택 표시의 P2 혼동                            |
| **합계**                 | **15/20 · Good** | P0/P1 열린 항목 없음. 아래 P2 4개와 검증 한계 잔존                                                      |

## 이번 batch에서 보완한 결함

| 심각도 | 위치                                                               | 재현/영향 → 보완/확인                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1     | `src/components/Sheet.tsx:21`                                      | 시트 자체에 최초 포커스가 있을 때 Shift+Tab이 배경 후보 버튼으로 나감(WCAG 2.4.3). 최초/외부 포커스도 경계에 포함. Chrome AI 생성 시트에서 마지막 요청 생성 버튼으로 순환, `inDialog:true`                                                              |
| P1     | `src/styles/app.css:1289`, `src/styles/tokens.css:20`              | error #ef4444와 warning #f59e0b 텍스트의 white 대비 3.76/2.15:1(WCAG 1.4.3). 별도 error-text #b91c1c 6.47:1, warning-text #92610c 5.33:1로 변경. 밝은 오류·경고 문구가 장식색을 쓰지 않음                                                               |
| P2     | `src/features/plan/usePlanReorder.tsx:88`                          | pointermove 한 번당만 스크롤하여 가장자리에 정지하면 계속 내려가지 못함. rAF가 스크롤 뒤 drop 위치를 다시 계산하고, 종료/취소/lost capture/blur/숨김/계획 변경/언마운트에서 프레임 정리. 실제 가장자리 drag에서 scrollY497→509, 순서 저장과 표시 0 확인 |
| P2     | `src/components/Sheet.tsx:72`                                      | 영어 시트도 닫기 접근성 이름이 한국어. locale별 Close/닫기, 영어 모바일 편집/순서 검토에서 확인                                                                                                                                                         |
| P3     | `src/components/icons.tsx`, `src/features/details/DetailsView.tsx` | reorder Unicode 그림 대신 기존 SVG stroke 체계의 grip/화살표 사용. 제목 위 중복 DatePack 라벨 제거                                                                                                                                                      |

Sheet의 key listener는 open 상태 동안 유지하고 최신 close callback만 ref로 갱신한다.
부모 callback 변경 때문에 입력 중 포커스를 다시 초기화하지 않는다.
기존 secondary text #6b7280/white는 4.83:1, primary-deep/white는 5.83:1이다.
reduced-motion에서는 입장/맥박/조작 transition만 제거하며 내용·상태·focus는 유지한다.

## 남은 findings

총 열린 항목 **P0 0 / P1 0 / P2 4 / P3 0**. 실기기 미검증은 결함으로 추정하지 않았다.

1. **[P2] 일부 보조 조작 목표가 44px 미만.** 위치 `src/styles/app.css:99,512,1515,909`.
   Responsive/A11y: DOM 기준 Undo 높이33.375px, 편집34×34px, 언어 버튼 높이38px,
   select 높이41px. 핵심 reorder 버튼은44px이지만 한 손 조작 여유가 균일하지 않다.
   WCAG 2.5.8의24px 최소와 skill의44px 권장은 구분한다. 다음 `$impeccable adapt`에서
   보조 버튼·select hit area를44px 이상으로 조정하고 좁은 화면을 확인한다.
2. **[P2] 초기 JS 묶음이 큼.** 위치 `src/app/App.tsx`, `src/features/details/DetailsView.tsx`.
   Performance: build JS612.07kB(gzip186.68kB), CSS266.02kB(gzip86.07kB), precache906.57KiB.
   Vite의500kB 경고가 실제 남아 있다. 저속망 첫 진입은 미측정이다. `$impeccable optimize`에서
   필요할 때 열리는 AI/기록/파일 기능의 분할 비용을 측정한다. 임의 LCP/INP 숫자는 보고하지 않는다.
3. **[P2] legacy 상태색의 토큰 사용 불균일.** 위치 `src/styles/app.css:419,448,638,860`.
   Theming: success/skip 보조색 일부는 hex가 남는다. 현재 light 화면을 깨뜨리지는 않지만
   palette 변경에 누락될 수 있다. `$impeccable colorize`에서 상태 토큰으로 모으고 대비를 확인한다.
   dark theme은 제품에 없으며 `color-scheme:light`를 명시했다. dark 완전 지원으로 평가하지 않는다.
4. **[P2] 진행 중 요청과 미래 범위 선택의 관계가 덜 명확함.** 위치
   `src/features/ai/AiSection.tsx:744,752,271` 및 stale 오류 안내.
   Implementation Integrity: ready 요청 뒤 범위 버튼을 바꾸어도 현재 요청 식별값/kind는 유지된다.
   새 상황 버튼은 먼저 완료/취소하라고 알린다. stale 오류도 기존 요청 취소 후 새 요청을 만들면
   정상 회복하지만 안내만으로 그 순서를 바로 알기 어렵다. guard와 원문 보존은 통과했다.
   `$impeccable clarify`에서 현재 요청 범위를 표시하고 취소→새 요청의 복구 행동을 명확히 한다.

토큰 드리프트와 작은 hit area는 legacy 보조 컨트롤에서 반복된다. 새 reorder 조작의
44px 대체 경로는 유지됐다. 후속 우선순위는 `$impeccable adapt` → `$impeccable clarify`
→ `$impeccable optimize` → `$impeccable colorize` → `$impeccable polish`다.
명령은 하나씩, 한 번에, 원하는 순서로 요청할 수 있다. 후속 수정 이후 별도 audit에서 점수를 갱신한다.

## 실제 통합 확인과 근거

| ID      | 종류/입력                                         | 관찰                                                                                                    | 판정/근거                                                                                                                                   |
| ------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| T06-U01 | Chrome/dev, 새 AI 초안                            | 생성 창 유지; 답안2092자 닫기/reload/재개 보존; 검토 후13개 활동 저장; 같은 next/map ID                 | 통과 · [desktop](evidence/t06/create-applied-desktop.png)                                                                                   |
| T06-U02 | Chrome 실제 pointer/keyboard, 긴 목록             | drag02→01, undo 원복, ArrowUp 저장/reload, same-gap/outside 변경 없음, drop 표시0                       | 통과 · [edge drag](evidence/t06/drag-edge-desktop.png). 가장자리 scroll497→509. 장시간 stationary hold는 별도 미검증                        |
| T06-U03 | Chrome/dev 보호 예약                              | 보호 booking 위로 crossing 차단, apply disabled, 기존 유지                                              | 통과 · [protected](evidence/t06/protected-order-desktop.png)                                                                                |
| T06-U04 | Chrome/dev 장소10 변경 후 reorder                 | provider disabled, unresolved venue 설명, 영어390px apply disabled                                      | 통과 · [미확인](evidence/t06/unverified-order-en-390.png)                                                                                   |
| T06-U05 | 수동 성수 책방/next05, GPS 동의 없음              | Today next05, request target05 하나, 뒤의18시 예약 읽기 전용; prompt에 lat/lon/geometry/photo data 없음 | 통과 · DOM/요청문 관찰. 복사/OS 공유의 실제 전송은 미실행                                                                                   |
| T06-U06 | 잘못된 ID / 검토 중 context 변경                  | mismatch 거부; context1→2 뒤 stale 거부,370자 입력 보존; 취소/새 요청/메모-only 검토/적용 정상          | 통과 · [stale](evidence/t06/stale-answer-desktop.png). 경로 영향 없는 메모 적용이며 실경로 성공이 아님                                      |
| T06-U07 | 날짜/방문시각 없는 독립 후기, memory-edit fixture | 원문 공백/개행 보존, editedNote 별도 검토/저장/reload, 방문 사실 생성 없음                              | 통과 · [ko390](evidence/t06/memory-ko-390.png), [en390](evidence/t06/memory-en-390.png)                                                     |
| T06-U08 | 최신 build, localhost4176/datepack/               | preview 종료와 curl connection refusal 뒤 cache reload, 활동 수정·후기 저장, 재reload 보존              | 통과 · [생산 빌드 후기](evidence/t06/offline-memory-prod.png). 데스크톱 local origin의 서버 중단이며 설치PWA/실기기/전체 인터넷 차단은 아님 |
| T06-F01 | public core API, T06 정식 파일 fixture            | 13활동/후보/보호/미정/원문/editedNote, 선택next05, no-impact 순열과 보호 crossing, write/read roundtrip | 통과 · `tests/t06Integration.test.ts`, `examples/t06-integration.datepack.json`. 브라우저 가져오기 증거가 아님                              |
| T06-M01 | 기존 GPS/provider/store 모의 suite                | 동의/거부/실패/TTL/one-shot, A/B/C, Seoul/ceil/buffer, stale/duplicate/저장실패·undo·portable           | 통과 · verify 앱133/core101. 기존 meaningful tests를 사용했으며 live GPS/경로 성공으로 해석하지 않음                                        |

## 환경과 미실행 경계

- IAB 파일 chooser `setFiles`가 DOM.setFileInputFiles 시간 초과. 기존/복구 탭 입력도
  응답하지 않아 Chrome 독립 origin 자료로 검증했다. Codex native 앱 접근은 CUA 안전 정책으로
  허용되지 않아 그 경로로 제어하지 않았다. 기존 IAB T04/T05 pack/DB는 삭제·reset하지 않았다.
- Chrome Download는 완료 event10초 timeout. macOS Downloads 읽기는 `Operation not permitted`.
  파일이 실제 회수됐거나 다른 기기에 재가져오기 성공했다고 주장하지 않는다.
  정식 파일 fixture의 public API roundtrip만 자동 확인했다.
- 합성 touch API/held pointer API가 없어 **실제 touch, pointercancel 이벤트 발생, 장시간 edge hold,
  blur 중 held gesture는 미검증**이다. cancel/lost-capture/blur/visibility/unmount 연결은 소스 확인이며
  실제 발생시킨 gesture의 증거를 대신하지 않는다. outside/noop/키보드/실제 desktop drag는 위 증거가 있다.
- 실제 GPS permission UI, OS clipboard/share sheet, 외부 LLM, iOS/Android 설치PWA, VoiceOver/TalkBack,
  200% text zoom, 저속망 performance trace, 공개 운영 route/GPS reverse는 미검증.
- APP_ROUTING_POLICY operational gate/FOSSGIS contact/attribution/Referer/조건 확인이 충족되지 않아
  기본 provider/resolver는 계속 disabled다. T01 live HTTP/CORS fixture는 운영 준비 증거가 아니다.
- 기존 데이터 삭제·push/PR/배포·영상촬영·영상 export·외부 게시 없음. **T07 대본/녹화 없는 리허설 미실행**.
