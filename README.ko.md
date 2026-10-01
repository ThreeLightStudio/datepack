# DatePack

**계획, 사진, 실제 경험 기록을 `.datepack.json` 파일 하나로 옮길 수 있는 로컬 퍼스트 데이트 플래너입니다.**

[웹 앱 열기](https://threelightstudio.github.io/datepack/) · [English](README.md) · [코어 포맷 API](packages/datepack/README.md) · [릴리스 준비 현황](docs/release-readiness.md)

**공개 베타 — 앱 0.3.0, 파일 형식 3.0.** 계획 편집, 파일 가져오기·내보내기, 사용자가 전달한 AI 답안 처리에는 공개 구현과 테스트가 있습니다. 설치형 모바일 PWA, 오프라인 재실행, 접근성, OS 공유는 실기기 인수 확인이 남아 있습니다. 데이트 중 계획을 다시 짜는 부담을 줄이는 것이 제품 목표이며, 사용성 효과를 측정했다는 뜻은 아닙니다.

## 입력한 계획이 파일이 되는 과정

저장소의 [Classic Seoul Day 예제](examples/classic-seoul-day-2026-09-28.datepack.json)에는 14:00–15:00 사이에 시작하는 “Coffee together” 일정, 장소, 파일에 포함된 사진이 있습니다. [예제 파일 테스트](packages/datepack/tests/exampleFile.test.ts)는 이 파일을 코어 API로 읽습니다.

1. **입력:** 제목과 선택 날짜를 정하고, 순서가 있는 일정을 추가합니다. 시각은 확정 시각, 시작 가능 범위, 미정 중에서 표현합니다. [생성 API](packages/datepack/src/create.ts)
2. **파일 생성:** 팩을 검증한 뒤 3.0 JSON으로 씁니다. 읽을 수 있는 사진 데이터는 파일 안의 `data:` URL이 됩니다. [검증](packages/datepack/src/validate.ts) · [쓰기](packages/datepack/src/write.ts)
3. **읽기·가져오기:** `readDatePack`이 문서를 검증하고 사진을 분리합니다. 앱은 결과를 IndexedDB에 저장하고 가져온 계획을 선택합니다. [읽기](packages/datepack/src/read.ts) · [가져오기 흐름](src/store/datepackStore.ts)
4. **계획 사용:** 전체 일정이나 오늘 화면에서 다음 장소를 바꾸고 다시 내보낼 수 있습니다. 파일을 가져왔다고 방문 사실이 확정되지는 않습니다. [전체 일정](src/features/plan/PlanView.tsx) · [오늘 화면](src/features/day/DayView.tsx)

[영어 문서의 짧은 코드 예제](README.md#a-plan-becomes-a-portable-file)는 사진 없는 계획을 생성·검증·저장·복원하는 공개 코어 API 사용법입니다. 별도 npm 설치 안내가 아닙니다. [왕복 테스트](packages/datepack/tests/datepack.test.ts)에는 계획·사진, 누락된 사진 데이터, 과거·미래 버전 입력이 포함됩니다.

## 코드에서 확인할 설계 선택

**계획과 실제 경험을 구분합니다.** 3.0 파일에는 현재 `plan`, 기준 `baselinePlan`, 명시적으로 기록한 `experiences`, 사진 목록, revision이 있습니다. 계획이 바뀌어도 경험의 장소·일정 스냅샷을 보존할 수 있습니다. 현재 상황, 개인 이동 정보, 대기 중인 AI 요청, 실행 취소 기록은 IndexedDB의 기기 상태에 따로 둡니다. [타입](packages/datepack/src/types.ts) · [저장 계층](src/storage/indexedDb.ts) · [v3 테스트](packages/datepack/tests/v3.test.ts)

**호환되지 않는 입력도 원본을 보존합니다.** 지원하는 1.0 ZIP과 2.0 JSON은 3.0으로 변환합니다. 지원하지 않는 미래 버전은 해석을 거부하면서 `DatePackReadError.originalFile`에 원본 파일을 남겨, 호출자가 그대로 저장할 수 있게 합니다. 쓰기 단계는 참조를 검증하고 누락된 사진 바이너리를 별도로 보고합니다. [읽기](packages/datepack/src/read.ts) · [쓰기](packages/datepack/src/write.ts) · [호환성 테스트](packages/datepack/tests/datepack.test.ts)

**AI 답안은 검토할 제안입니다.** 사용자가 자신의 AI 앱에 요청을 전달하고 답안을 붙여넣습니다. 요청 식별 정보, 계획·상황 revision, 중복, 변경 범위, 보호된 필드를 확인한 뒤 변경 내용과 경고를 보여주고 승인을 받습니다. 일부 일정 충돌은 참고 경고이며, 실제 영업 여부나 이동 가능성을 보장하지 않습니다. [답안 계약](src/features/ai/exchange.ts) · [검토·적용 UI](src/features/ai/AiSection.tsx) · [저장 시 재검증](src/storage/indexedDb.ts) · [테스트](tests/aiExchange.test.ts)

## 브라우저 사용과 데이터 경계

계획과 파일 처리는 브라우저에서 수행합니다. AI 요청은 사용자가 선택한 외부 앱을 통해 전달됩니다. [AI 전달 코드](src/features/ai/AiSection.tsx)와 [제품 흐름·후속 방향](docs/product-flow.md)을 참고하세요.

[PWA 설정](vite.config.ts)은 앱 셸과 요청한 폰트를 캐시합니다. 지원하는 브라우저에서 설치할 수 있지만, iOS·Android 설치 후 사용, 오프라인 시작, VoiceOver·TalkBack, OS 공유, 다른 기기에서 파일 재열기는 [추가 확인 대상](docs/release-readiness.md)입니다.

사이트 데이터를 지우면 브라우저의 저장 자료도 사라지므로 중요한 날짜는 파일로 내보내 보관하세요. 편집 탭은 하나를 권장합니다. [동시성 테스트](tests/indexedDb.test.ts)가 revision 검증을 다루지만 완전한 다중 탭 동기화 경험을 입증하지는 않습니다. 지도 버튼은 이미 공개된 [MapBridge 장소 검색 URL 연동](src/utils/mapBridge.ts)과 [URL 테스트](tests/mapBridge.test.ts)를 사용합니다.

## 개발과 검증

[package.json](package.json)의 기준은 **Node ≥24.14.1, pnpm 10.33.2**입니다.

```sh
pnpm install
pnpm dev
pnpm verify
pnpm build
```

`verify`는 포맷 검사, lint, 타입 검사, 앱 테스트, 코어 패키지 검증을 실행합니다. `build`는 Vite 앱을 빌드합니다. [UI에 의존하지 않는 코어](packages/datepack/README.md)는 워크스페이스 패키지이며 파일 형식과 버전을 따로 관리합니다.

확인한 공개 커밋에는 성공한 [Verify](https://github.com/ThreeLightStudio/datepack/actions/runs/36710171947)와 [Pages 배포](https://github.com/ThreeLightStudio/datepack/actions/runs/36710172631) 실행이 있습니다. 자동화 결과이며 앞서 설명한 실기기 인수 확인과는 별개입니다. 같은 커밋 기준으로 GitHub 릴리스 산출물은 없었습니다. 자세한 규칙과 경로는 [코어 문서](packages/datepack/README.md), [앱 테스트](tests/), [릴리스 준비 현황](docs/release-readiness.md)에 있습니다.

[문제 제보](https://github.com/ThreeLightStudio/datepack/issues) · [MIT 라이선스](LICENSE)
