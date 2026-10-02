# DatePack

**혼자 또는 함께하는 외출을 준비하고, 계획 없이도 사진으로 순간을 남기는 로컬 퍼스트 앱입니다. 계획과 기록은 `.datepack.json` 파일로 옮길 수 있습니다.**

[웹 앱 열기](https://threelightstudio.github.io/datepack/) · [English](README.md) · [코어 포맷 API](packages/datepack/README.md) · [릴리스 준비 현황](docs/release-readiness.md)

**공개 베타 — 앱·코어 0.4.0, 파일 형식 4.0.** 공개 사이트는 이전 버전일 수 있습니다. 계획 편집, 파일 가져오기·내보내기, 사용자가 전달한 AI 답안 처리에는 공개 구현과 테스트가 있습니다. 설치형 모바일 PWA, 오프라인 재실행, 접근성, OS 공유는 실기기 인수 확인이 남아 있습니다. 외출 중 계획을 다시 짜는 부담을 줄이는 것이 제품 목표이며, 사용성 효과를 측정했다는 뜻은 아닙니다.

## 계획이나 사진으로 시작하기

홈에서 사진을 고르고 미리보기 뒤 한 번 저장하면 여러 사진이 하나의 기록으로 남습니다. 제목, 설명, 날짜 보완과 일정 연결은 선택이며 글만 남길 수도 있습니다. 홈 / 일정 / 기록으로 이동하고, 언어와 파일 관리는 상단 메뉴에서 엽니다. 날짜만으로 외출 시작이나 방문을 확정하지 않습니다.

혼자·함께, 지역, 사용 시간, 가까운 이동, 한 곳 방문과 원화 예산을 선택합니다. 예산은 전체 또는 한 사람당으로 구분하며, 빠른 조건의 기본값은 120분과 10,000원입니다. 직접 계획과 AI 요청에 같은 조건을 사용하고, 혼자 계획에는 동행자나 합류 장소가 필요하지 않습니다. 확인하지 않은 가격·영업·이동 시간은 확정 정보로 다루지 않습니다.

짧은 편집·연결·공유는 시트, 긴 AI 요청·검토는 복원 가능한 화면에서 처리합니다. 작성 중인 글은 재실행 후 복원되지만 저장 전 새 사진 선택은 완전 종료 후 다시 선택해야 합니다. 일정 연결·변경·해제는 기록과 사진을 함께 이동하고, 일정 삭제 시에도 독립 기록으로 보존합니다. 같은 파일은 중복 저장하지 않고, 같은 ID의 다른 내용은 복사본으로 가져옵니다. AI 편집문은 원문과 별도로 저장합니다. 기록 공유는 선택한 글을 보내며 파일 내보내기는 문서 전체와 사진을 포함합니다.

[제목 없는 독립 사진 예제](examples/independent-photos.datepack.json)도 아래 외출 예제와 함께 파일 왕복 검증을 거칩니다.

## 입력한 계획이 파일이 되는 과정

저장소의 [Classic Seoul Day 예제](examples/classic-seoul-day-2026-09-28.datepack.json)에는 14:00–15:00 사이에 시작하는 “Coffee together” 일정, 장소, 파일에 포함된 사진이 있습니다. [예제 파일 테스트](packages/datepack/tests/exampleFile.test.ts)는 이 파일을 코어 API로 읽습니다.

1. **입력:** 제목과 선택 날짜를 정하고, 순서가 있는 일정을 추가합니다. 시각은 확정 시각, 시작 가능 범위, 미정 중에서 표현합니다. [생성 API](packages/datepack/src/create.ts)
2. **파일 생성:** 팩을 검증한 뒤 4.0 JSON으로 씁니다. 읽을 수 있는 사진 데이터는 파일 안의 `data:` URL이 됩니다. [검증](packages/datepack/src/validate.ts) · [쓰기](packages/datepack/src/write.ts)
3. **읽기·가져오기:** `readDatePack`이 문서를 검증하고 사진을 분리합니다. 앱은 결과를 IndexedDB에 저장하고 가져온 계획을 선택합니다. [읽기](packages/datepack/src/read.ts) · [가져오기 흐름](src/store/datepackStore.ts)
4. **계획 사용:** 전체 일정이나 오늘 화면에서 다음 장소를 바꾸고 다시 내보낼 수 있습니다. 파일을 가져왔다고 방문 사실이 확정되지는 않습니다. [전체 일정](src/features/plan/PlanView.tsx) · [오늘 화면](src/features/day/DayView.tsx)

[영어 문서의 짧은 코드 예제](README.md#a-plan-becomes-a-portable-file)는 사진 없는 계획을 생성·검증·저장·복원하는 공개 코어 API 사용법입니다. 별도 npm 설치 안내가 아닙니다. [왕복 테스트](packages/datepack/tests/datepack.test.ts)에는 계획·사진, 누락된 사진 데이터, 과거·미래 버전 입력이 포함됩니다.

## 코드에서 확인할 설계 선택

**계획과 실제 경험을 구분합니다.** 4.0 파일은 계획과 원래 계획(`plan`, `originalPlan`)이 있는 `outing`과 계획 없이 실제 기록을 담는 `memories`로 구분합니다. 두 종류 모두 문서 ID, 메타데이터, `experiences`, 사진 목록, revision이 있으며 문서 ID와 계획 ID는 역할이 다릅니다. 계획이 바뀌어도 경험의 장소·일정 스냅샷을 보존할 수 있습니다. 현재 상황, 개인 이동 정보, 대기 중인 AI 요청, 실행 취소 기록은 IndexedDB의 기기 상태에 따로 둡니다. [타입](packages/datepack/src/types.ts) · [저장 계층](src/storage/indexedDb.ts) · [v4 테스트](packages/datepack/tests/v4.test.ts)

**호환되지 않는 입력도 원본을 보존합니다.** 파일 읽기는 4.0만 허용하며, 구버전과 4.1을 포함한 다른 버전은 거부합니다. 기존 기기의 3.0 로컬 자료와 초안은 별도로 변환하고, 실패 시 원본 저장소를 유지해 재시도할 수 있습니다. 거부한 입력은 `DatePackReadError.originalFile`에 원본 파일을 남겨, 호출자가 그대로 저장할 수 있게 합니다. 쓰기 단계는 참조를 검증하고 누락된 사진 바이너리를 별도로 보고합니다. [읽기](packages/datepack/src/read.ts) · [쓰기](packages/datepack/src/write.ts) · [호환성 테스트](packages/datepack/tests/datepack.test.ts)

**AI 답안은 검토할 제안입니다.** 사용자가 자신의 AI 앱에 요청을 전달하고 답안을 붙여넣습니다. 요청 식별 정보, 계획·상황 revision, 중복, 변경 범위, 보호된 필드를 확인한 뒤 변경 내용과 경고를 보여주고 승인을 받습니다. 일부 일정 충돌은 참고 경고이며, 실제 영업 여부나 이동 가능성을 보장하지 않습니다. [답안 계약](src/features/ai/exchange.ts) · [검토·적용 UI](src/features/ai/AiSection.tsx) · [저장 시 재검증](src/storage/indexedDb.ts) · [테스트](tests/aiExchange.test.ts)

## 브라우저 사용과 데이터 경계

계획과 파일 처리는 브라우저에서 수행합니다. AI 요청은 사용자가 선택한 외부 앱을 통해 전달됩니다. [AI 전달 코드](src/features/ai/AiSection.tsx)와 [제품 흐름·후속 방향](docs/product-flow.md)을 참고하세요.

[통합 보고서](docs/u04-integration.md)에 283개 테스트, 브라우저 오프라인 사진 저장·재실행과 파일 내용 왕복 결과를 기록했습니다. 실제 다운로드 파일 회수와 삭제 확인창 완료는 관찰하지 못했습니다. 앱은 원본 HEIC/HEIF를 변환하지 않으며 플랫폼에서 변환된 지원 이미지가 정상 해독되면 받아들입니다. 실제 GPS·외부 AI·OS 공유·설치형 모바일 PWA는 실기기 확인이 필요합니다.

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

이전에 확인한 0.3.0 공개 커밋에는 성공한 [Verify](https://github.com/ThreeLightStudio/datepack/actions/runs/36710171947)와 [Pages 배포](https://github.com/ThreeLightStudio/datepack/actions/runs/36710172631) 실행이 있습니다. 자동화 결과이며 앞서 설명한 실기기 인수 확인과는 별개입니다. 같은 커밋 기준으로 GitHub 릴리스 산출물은 없었습니다. 자세한 규칙과 경로는 [코어 문서](packages/datepack/README.md), [앱 테스트](tests/), [릴리스 준비 현황](docs/release-readiness.md)에 있습니다.

[문제 제보](https://github.com/ThreeLightStudio/datepack/issues) · [MIT 라이선스](LICENSE)
