# DatePack 녹화 없는 데모 리허설

2026-10-01 Asia/Seoul · T07 · **실제 UI 실행 완료 / 메인 검토 대기**.
[60초 대본](demo-video-script.md)의 한 workflow인 ‘기억 한 줄 다듬어 원문과 함께 저장’을
실행했다. 60초는 편집 후 장면 배분이며 실제 조작·대기 시간을 측정한 영상 길이가 아니다.
영상·자막·export·게시 결과물은 없다.

## 환경과 데이터

- 승인 입력: `codex/datepack-ai-flow` @ `63950527895632a16e6974bcf7b5e9e8e303f3c2`, clean.
  상위 AGENTS 폴더 정책, decisions v3/demoTemplate, T01–T06 handoff/review와
  [UI audit](ui-audit.md)를 확인했다. 기존 Vite `http://127.0.0.1:5174/`가 HTTP200으로 실행 중이었다.
  서버를 교체·중단하거나 새 서버를 만들지 않았다.
- macOS Chrome tab `1021608689`, browser `1`. CUA의 실제 버튼/키보드와 DOM 관찰을 사용했다.
  페이지 내부 store·IndexedDB·네트워크 응답을 주입하거나 직접 수정하지 않았다.
- CSS **1291×828** desktop 및 **390×844** viewport를 DOM `innerWidth/innerHeight`로 확인했다.
  양쪽 문서 가로 넘침 0. 초기 연결은390px였고 desktop은 명시 설정 후 확인했다.
  끝에 viewport reset, 한국어 복원, 최종 DOM1291×828. 실제 모바일 기기는 아니다.
- 더보기 → 새 데이트 만들기의 ‘데이트 이름’ 입력 → 만들기로 독립 계획
  `plan-muos50bmtvllc3` / ‘T07 비를 피해 쉬었던 순간’을 생성했다. 원문은 실제
  ‘기억할 순간’·‘짧은 메모 (선택)’ 입력 → ‘추억 저장’으로 보관했다.
  기록 `b8c5de65-a389-4dbf-a966-5ce2709bbbbf`. T06 계획과 기록을 덮어쓰지 않았다.
- 원문: ‘비가 와서 카페에 들어갔다. 따뜻한 커피를 마시며 쉬었다.’
  다듬은 문장: ‘비를 피해 카페에서 따뜻한 커피를 마시며 쉬었다.’
  모두 데모용 수제 내용이다. 방문일·방문시각·장소·사진을 입력하지 않았다.
  파일 fixture를 가져오지 않았고 생성·저장 API를 우회하지 않았다.

## 대본 장면과 실제 실행 근거

한 workflow를 사전 desktop/mobile 관찰 → 한 batch 보완 → desktop/mobile 재확인으로 진행했다.
desktop은 같은 원문을 이미 저장한 상태에서 반복 편집했다.390px 초기 실행에는 원문 입력·첫
저장도 포함됐다. 외부 AI 대화/승인은 실행하지 않았다.

| 대본 / 시간      | 실제 실행                                                                | 결과 / 증거                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook 0–3s        | 저장 후 카드에서 두 문장 확인                                            | 원문 라벨과 확인 문장 함께 표시. [390 결과](evidence/t07/saved-390.jpg), [desktop 결과](evidence/t07/saved-desktop.jpg). hook용 결과 장면을 처음으로 편집하는 것은 미래 제작이다.      |
| Step 1 3–12s     | ‘AI로 문장 다듬기’ 클릭                                                  | memory-edit 요청 준비. 기록 제목·원문만 포함한다는 설명, 요청문 disclosure 확인. [desktop 안내](evidence/t07/request-help-desktop.jpg), [390 안내](evidence/t07/request-help-390.jpg). |
| Step 2 12–27s    | 요청문 보기 → 닫기 → ‘요청문 복사’ → 답안 입력                           | 두 viewport에서 복사 완료 메시지와 clipboard 내용 = 표시 요청문을 확인했다. 기존 clipboard는 empty였고 검증 뒤 empty text로 복원했다. OS 공유 시트는 실행하지 않았다.                  |
| Step 2 복귀 보강 | desktop reload → AI 요청 이어가기.390px 오늘 → reload → AI 요청 이어가기 | 각 최신 답안의 식별값·문장 복원 확인. [390 복원](evidence/t07/resumed-answer-390.jpg). 다른 화면에서도 전역 재개가 가능했다.                                                           |
| Step 3 27–40s    | ‘다듬은 문장 검토’ → 원문/수정본 비교 → ‘원문과 함께 저장’               | desktop/390px에서 실제 버튼 동작, Enter로 검토/저장 성공. Tab 이동과 포커스 링 관찰. [desktop 검토](evidence/t07/review-desktop.jpg), [390 검토](evidence/t07/review-390.jpg).         |
| Oh, nice 40–50s  | 입력부 종료 → 오늘/더보기 복귀,390px 저장 후 reload/더보기               | 성공 상태와 원문+editedNote 유지. 날짜/시각 미상 그대로. 메모 저장 때문에 빈 계획에 방문·일정을 만들지 않았다.                                                                         |
| CTA 50–60s       | README의 URL 대조                                                        | URL 문자열 근거 확인. 공개 웹사이트 방문·버전 일치·배포·CTA 영상 합성 미실행.                                                                                                          |

390px 최종 검토에서 저장 버튼은 enabled, **133.87×47.25px**, viewport 좌표
`x95/y398.29`였다. 버튼은 고정 하단 navigation 위에 노출됐고 문서 overflow0이었다.
원문·수정 문장을 읽고 필요한 만큼 세로 스크롤해 검토/저장할 수 있었다.
작은 안내문·긴 JSON·스크롤 전환은 영상에서 확대/컷할 제작 지점이다. 모든 조작이 한 프레임에
들어온다거나 실기기 키보드에 가려지지 않는다는 주장은 하지 않는다.

## Fixture와 live 검증의 경계

답안은 화면의 요청문 JSON 예시에서 **그 요청의** requestId/packId/baseRevision/
contextRevision/generatedAt/kind/experienceId를 유지하고 editedText만 수제로 채웠다.
리허설에서 입력·검토·저장한 실제 답안 파일은
[desktop fixture](evidence/t07/desktop-response-fixture.json)와
[390 fixture](evidence/t07/mobile-response-fixture.json)이다. 완료한 요청을 다시 붙여넣어
성공 장면을 만드는 방식이 아니다. 다시 실행할 때는 UI에서 새 요청을 만들어야 한다.

실제 확인: 로컬 UI 입력·요청문 공개·복사·답안 보존/재개·원문 비교·확인 저장·화면 복귀.
**미확인:** 외부 LLM의 대화/승인/JSON 준수, 외부 앱 자동 전환, OS 공유 시트, 실제 GPS 권한,
공개 운영 route/reverse, 지도 목적지, iOS/Android touch·설치PWA·보조기술·OS 파일 회수.
이 workflow는 경로에 영향이 없어 route 검증 성공을 보여주지 않는다. 기존 provider/resolver는
disabled이며 ‘검증된 도착’·‘예약 도착 가능’·‘다음 장소 확인’을 주장하지 않는다.
T06의 mock 경로/GPS/오프라인 검사와 이 실제 UI 리허설은 별도 근거다.

## 발견한 마찰과 한 batch 보완

1. 후기 편집에도 공통 안내가 ‘확인 적용 전에는 **계획**이 바뀌지 않아요’라고 표시됐다.
   RequestHelp에 purpose=memory를 연결하고 ko/en 모두 ‘검토 후 원문과 함께 저장’으로
   설명했다. 기본 plan 안내와 식별·저장·검증 동작은 유지한다.
2. 최종 저장 카드에 수정 문장만 라벨이 있어 위 문장이 원문인지 즉시 구분하기 어려웠다.
   editedNote가 있을 때 원문에 ‘원문 — 그대로 보존’ / ‘Original — kept unchanged’를 추가했다.

재확인: 위 desktop/390px 요청·복사·답안·검토·저장·복귀 화면에서 두 변경을 확인했다.
영어390px에서도 원문 라벨, memory 전용 안내, 긴 문구 줄바꿈, overflow0과 포커스 링을
확인했다([영어 안내](evidence/t07/help-en-390.jpg)). 영어 재확인용 새 요청은 정상 UI로 취소하고
한국어로 복원했다. 원문/수정본은 유지했다. 더 수정하거나 새 디자인 체계를 도입하지 않았다.

impeccable context/clarify/craft-floor와 기존 rose/cream CSS·토큰·SVG 체계를 적용했다.
React 지침에 따라 표시를 렌더에서 조건부로 결정하고 새 effect/상태/의존성을 추가하지 않았다.
변경한 두 컴포넌트 detector를 **한 번** 실행한 결과는
[빈 결과](evidence/t07/detector.json) `[]`이다. 전체 UI 재점수나 실기기 접근성 통과의 근거는 아니다.
T06의15/20 및 열린 P2 네 개를 닫지 않는다.

## 검사와 종료 상태

기존 의미 있는 검사를 재실행했다. 간단한 안내·라벨 변경을 그대로 복제하는 새 테스트는
추가하지 않았다. 최종 검사와 빌드 수치는 [verification](evidence/t07/verification.txt)에 보존한다.
T07 문서/근거는 메인의 최종 검토를 기다린다. 제품 전체 완료와 heartbeat 종료는 메인 소관이다.

기존 T04/T05/T06 기록·DB reset/삭제 없음. 새 chat/subagent/재위임 없음. 서버·키·계정·유료 서비스·
route 정책 변경 없음. push/PR/배포·영상 촬영·영상 export·외부 게시 없음.
기존 Chrome tab은 T07 결과 기록 화면을 메인 검토용으로 남긴다.
