# T05 구현 체크포인트 — 후속 검토·저장 완료

후속 기록: worker가 idle/completed 상태임을 확인한 오케스트레이터가 승인된 범위의 준비된 결과 저장만 제한적으로 인수했다. 구현 코드는 추가 수정하지 않았다. 로컬 서버와 IAB에서 fixture 파일 가져오기, 위/아래 즉시 저장, reload 후 Today 순서 일치, undo, 실제 pointer drag, handle ArrowUp, 보호 예약 crossing의 적용 차단, 시간 조정 preview와 미확인 경로 적용 차단을 확인했다. 실제 CSS 390x844 (DOM 확인, overflow 없음)와 기본 desktop에서 관찰했으며 실기기·touch·외부AI·실서비스 경로 성공은 검증하지 않았다. 증거는 orchestration의 `T05-review-saved-desktop.jpg`, `T05-review-adjustment-390.jpg`와 canonical `T05-handoff.md` / `T05-review.md`에 보존한다. 아래 내용은 권한 제한 시점의 체크포인트로 보존하며, 최신 결과 커밋·판정은 canonical 인계와 status.json을 따른다.

2026-10-01 Asia/Seoul. 작업 소유자: 현재 T05 worker. 시작 및 현재 HEAD `fb700b75243885faab66bdcaabf4e7d598e0c271`, 브랜치 `codex/datepack-ai-flow`. 결과는 **아직 커밋되지 않은 공유 checkout 변경**이다. T05 완료·검토 통과 또는 전체 제품 완료로 처리하지 않는다.

원래 인계 경로 `/Users/three-light/.codex/orchestration/datepack-ai-flow-20261001-01a0f3dc/T05-handoff.md`는 현재 writable roots 밖이므로 이 파일을 임시 인계로 보존한다. 환경 복구 후 같은 worker가 잔여 작업을 끝내고 원래 경로에 최종 인계를 작성해야 한다.

## 구현과 API

- `src/features/plan/reorder.ts`: `reorderPlan(plan, eventId, beforeId)`는 명시적 `event.order` 기준으로 이동·재번호를 수행하고 현재 gap, 자기 자신, 없는 ID는 null(no-op)로 반환한다. 날짜·시간·장소 등 다른 필드를 변경하지 않는다. `adjustReorderedTimes(plan)`는 선택적인 시간 조정 초안만 만든다. 겹치는 exact/window 시각을 앞으로 이동하고 체류 시간을 보존하며 time 보호·fixed·미정 시각을 유지한다. 분 단위 반올림은 올림, 다음 날 표시 유지, 지원하는 이틀을 넘으면 초안 없음. 이동 시간을 추정하지 않는다.
- `src/store/datepackStore.ts`: `prepareReorder` / `prepareReorderTimeAdjustment` / `commitReviewedReorder`, `ReorderReview`. 계획·상황 revision, 후보, 순서, 장소/경로 메모리 snapshot 및 5분 검토 만료를 재검사한다. 기본 phase=plan, 전체 itinerary/후속 예약을 기존 `prepareImpact`로 검사. 승인 저장은 verified만 허용한다.
- `src/storage/indexedDb.ts`: `DirectPlanGuard`와 `commitPlanChange`의 마지막 선택 인수 추가. 기존 AI 인수는 호환 유지. 원자적 transaction 안에서 저장된 원본 plan/revision/context와 memory-only 검증 callback을 확인한 뒤 plan/revision/undo를 함께 저장한다. 이 guard와 GPS·경로 근거는 저장/휴대용 파일에 넣지 않는다.
- `src/features/plan/usePlanReorder.tsx`와 `PlanView.tsx`: pointer capture handle, 8px drag threshold, drop 위치 표시, 위·아래 버튼, handle ArrowUp/ArrowDown, Escape/cancel/outside drop, 이동 영향 미리보기, 기존 유지, 선택적 시간 조정 preview와 명시적 적용. pointer handler는 touch를 지원하는 구현이나 실제 터치 장치 검증은 아직 없다. 이동 중 포인터 상태는 ref 사용. 기존 UI/편집·완료·건너뜀·후보 흐름을 유지한다.
- `src/features/day/routeImpact.ts`: 순서·보호·검증이 배열 물리 위치 대신 `event.order` 정렬을 사용한다. 빈 evidence를 `[]`로 통일해 no-impact 미리보기와 저장의 snapshot mismatch를 수정했다.
- `src/features/day/dayRuntime.ts`: 명시적 next 선택/재포함을 유지하고 기본 remaining 순서는 저장된 순서를 따른다. 시간 미정 활동보다 나중의 timed booking을 먼저 AI/Today 목적지로 끌어올리던 fallback을 제거했다. `computeDayContext`의 시각 추론/사실 판단은 바꾸지 않았다.
- `src/i18n/{ko,en}.ts`, `src/styles/app.css`: 양 언어 동작 안내·확인·실패 문구, 44px 조작 목표, focus와 drop affordance. 기존 색상 토큰 사용.

## 영향 없는 변경의 경계

기존 no-route-impact 메모 수정 외에, **다른 필드가 전부 동일하고, 순서가 바뀌는 연속 구간의 모든 활동이 같은 유효 placeId의 시간 미정 활동이며, 체류 시간이 알려져 있는 순수 permutation**만 경로 영향 없음으로 판정한다. 기존 장소 출입 순서·총 체류 시간·시간 anchor가 동일하다. fixed/order 보호를 넘는 이동은 이 판정에 앞서 차단한다. 다른 장소, 미정 장소, exact/window, 미정 체류 시간, 날짜/장소/시간 변경은 전체 경로 검증을 요구한다. 무경로 서비스를 verified로 바꾸지 않는다.

안전한 no-impact는 즉시 저장하고 toast에서 undo를 제공한다. 영향 있는 이동은 저장되지 않은 preview를 보여 주며, verified가 아니면 적용을 비활성화한다. 시간 조정 preview 또한 경로 검증을 우회하지 않는다. APP_ROUTING_POLICY와 공개 provider의 운영 gate는 변경하지 않았다.

## 확인된 검사

최종 코드 검사: `pnpm verify` 통과(app **132** + core **101**, 총 **233**), format/lint/typecheck 포함. `pnpm build` 통과(PWA 생성); 기존 500kB chunk warning은 남아 있다. `git diff --check` 통과. 로그: `/tmp/datepack-t05-verify.log`, `/tmp/datepack-t05-build.log`, `/tmp/datepack-t05-test.log`.

`tests/reorder.test.ts` 10개 집중 검사: no-op/explicit order, 같은 장소 no-impact와 provider I/O 없음, 양방향 보호 anchor crossing 차단, 저장·재열기·undo·baseline/후기 원문 보존, Day/AI/portable 순서 일치, transaction 내부 context 경합, 후보 변조·review TTL, 저장 실패 후 재시도, 외부 plan commit 경합, preview TTL 내 장소 근거 만료, downstream booking까지 모든 leg 검증·확인된 지각 차단, 선택적 시간 조정/미정/보호/다음 날/소수 체류 시간 처리. 기존 routeImpact의 crossing fixture는 배열만 이동하던 입력에 실제 order 재번호를 추가했다.

verified/impossible 경로 증거는 **test fixture**다. 실제 서비스/GPS/외부 AI/OS 공유/iOS·Android 성공 근거로 취급하지 않는다. 기존 T02의 GPS accuracy/snap≤100m, 장소·경로 TTL 및 provider 정책 검사는 유지했고 전체 verify에서 통과했다.

## 실제 CUA 및 환경 제약 — 잔여 작업

- 현재 환경은 로컬 포트 실행을 차단한다. `pnpm dev --host 127.0.0.1 --port 5174` → `listen EPERM: operation not permitted 127.0.0.1:5174`. 연결된 터미널 connector 실행도 `MCP tool call requires approval, but approval policy is never`로 차단. 서버가 실행됐다고 주장하지 않는다.
- CUA inventory 조회는 성공했다. 이 worker의 IAB에는 기존 탭이 없었다. `createBrowserTab('iab', 'http://127.0.0.1:5174/', {visible:true})`는 브라우저 보안 정책에서 **사용자가 권한을 거부했다**고 반환했다. 같은 결과를 위한 다른 브라우저/우회 경로를 시도하지 않았다. 따라서 실제 제품 screenshot/drag/mobile/keyboard/preview 관찰은 **미수행**이다.
- Git staging 시 `.git/index.lock: Operation not permitted`. 현재 `.git`는 읽기 전용이며 승인 정책 never. 결과 커밋 없음. 승인된 커밋 메시지 후보: `feat: guard direct itinerary reordering`.
- canonical orchestration 인계 경로도 현재 writable roots 밖이다. 이 fallback을 복사할 수 있는 환경 복구가 필요하다.

## 같은 worker가 재개할 UI 확인

브라우저 권한이 명시적으로 복구되고 5174 서버가 실행된 뒤 수행한다. `examples/t05-reorder.datepack.json`은 사용자 데이터 없는 import fixture이며, 기존 pack은 삭제하지 않는다. fixture 내 첫 두 활동은 동일 장소·시간 미정·체류 시간 고정이다. 마지막은 18시 보호 예약이다.

1. fixture를 별도 plan으로 가져와 위/아래·handle drag로 첫 두 활동 이동 → 즉시 저장, drop 위치 관찰, undo/reload/후속 AI 순서 확인. 같은 gap·자기 위치·취소 drop은 revision/undo 불변.
2. 첫 활동을 예약 뒤로 이동 → protected-order preview, 적용 불가, 기존 유지. drag와 버튼 모두 확인.
3. 공원 산책을 카페 앞에 이동 → 시간 역전과 동선 미확인 preview, 변경 전 저장 없음. 시간 조정 preview → 변경 시각 표기, 고정 예약/미정 시각 유지, provider disabled에서는 적용 불가. 취소 원 순서 확인.
4. desktop와 390px narrow layout, ko/en, keyboard focus 및 touch 대체 버튼을 확인. 실제 touch/device 관찰이 없으면 명시한다. screenshot은 허용된 시각화 폴더에 보존하고 canonical handoff에 증거를 연결한다.
5. 필요 보완 후 verify/build, 로컬 커밋, canonical T05-handoff 작성. 오케스트레이터 검토를 받는다.

## 모델/후속 통합

작업 정책은 gpt-6.1-sol/high 권장이다. 이 worker에서 실제 적용된 정확한 model ID/effort를 확인한 도구 근거는 없으므로 적용했다고 주장하지 않는다. 새 세션/subagent/재위임 없음. push/배포/게시/촬영 없음.

T06은 이 체크포인트를 완료로 간주하지 않는다. T05의 실제 CUA·커밋 완료 뒤 impeccable 통합 audit를 수행하고, T07은 템플릿 대본과 녹화 없는 리허설을 별도 수행한다. 공유 구현/UI 소유권은 재개·검토 시 오케스트레이터가 같은 T05 worker 기준으로 유지해야 한다.
