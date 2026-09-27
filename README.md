# DatePack

**A local-first date planner where the whole date lives in one file.**
**한국어 안내는 아래에 있습니다.** (Korean guide below)

```text
classic-seoul-day-2026-09-28.datepack
├─ manifest.json
├─ plan.json
├─ assets.json
└─ assets/
   ├─ cafe.jpg
   └─ train.png
```

DatePack is a web app for planning a date — the itinerary, places, photos and
Plan B's — and packing all of it into a single portable `.datepack` file.
During the date, the **Today** screen answers the only question that matters:
_where are we now, and where are we next?_ Glance for three seconds, pocket the
phone, get back to each other.

> Plan less. Be together.

## Highlights

- **Local-first, no server.** Everything runs in the browser: parsing, editing,
  import/export, photos. Nothing is ever uploaded — there is nowhere to upload
  _to_. Works fully offline once loaded.
- **Today / Itinerary / More.** A 3-second Now & Next screen (with humanized
  departure recommendations like _"Leave around 15:20 — take it slow"_), a full
  editable timeline, and a details surface for photos, files and replanning.
- **The `.datepack` format.** A ZIP with `manifest.json`, `plan.json`,
  `assets.json` and an `assets/` folder. Versioned `major.minor` (currently
  `1.0`): newer _minor_ versions stay readable with a warning, a new _major_
  is a clean break. See `src/datepack/schema.ts` for the reader policy.
- **Plan B per stop.** Each stop can carry a fallback plan ("if the line is out
  the door, skip it and swing back at 15:30") and switching is one tap and
  always reversible.
- **AI replanning without an AI backend.** The app drafts a prompt describing
  exactly what happened and what must not change; paste your AI assistant's
  reply (a small JSON patch) back, preview the diff, approve, undo anytime.
  No API keys, no telemetry.
- **MapBridge.** Map buttons never bind to a specific map service — they open
  `https://mapbridge.threelight-studio.com/s/<url-safe-base64>` with the place
  query, so the same file works everywhere.
- **Korean & English UI.** Written _for_ each language, not translated word by
  word. Switch on the first screen or in **More → Language**; the choice persists.

## Status

**Public Beta.** Versions in the `0.x` line are an open beta: the format, the
day-mode engine and the import/export loop are solid, but expect rough edges.
The app is installable as a PWA and works fully offline. Bug reports and ideas
are welcome on [GitHub Issues](https://github.com/ThreeLightStudio/datepack/issues).
A demo seed (a classic day out in Seoul) is generated on demand from the empty
state, written in the active UI language.

## Development

```bash
pnpm install
pnpm dev        # vite dev server
pnpm verify     # format (oxfmt) + lint (oxlint) + typecheck + tests (vitest)
pnpm build      # production build to dist/
```

Requires Node ≥ 24 and pnpm 10.

### Project layout

```text
src/
├─ datepack/     # the format: types, schema, create/read/write, validate, patch — no UI here
├─ storage/      # IndexedDB (packs, asset blobs, day-mode runtime state, meta)
├─ store/        # app state: current pack, undo stack, toasts
├─ features/     # day (Today), plan (Itinerary), editor, details, ai
├─ components/   # icons, sheet, tab bar, image loader, error boundary
├─ i18n/         # ko/en catalogs + locale store
└─ utils/        # time math, MapBridge URLs, ids
```

`src/datepack/` is deliberately UI-free and is the seed of a future
`@datepack/core` package.

## Things you should know

- **Single tab, please.** The app persists the whole working pack on every
  change. Two tabs editing the same pack will silently last-write-win — open
  one tab per browser profile.
- **IndexedDB is the database.** Clearing site data deletes your dates, so
  keep `.datepack` exports of the ones you care about. That is what the format
  is for.
- **The demo seed is generated locally** when you opt in from the empty state
  (including its sample images, drawn as SVG in code) — no bundled photography,
  no remote assets.
- **Font**: Pretendard (bundled, per-weight subsets).

## License

[MIT](./LICENSE)

---

# DatePack (한국어 안내)

**데이트 전체가 파일 하나로 담기는, 로컬 퍼스트 데이트 플래너.**

DatePack은 웹에서 동작하는 데이트 플래너입니다. 일정, 장소, 사진, Plan B까지
`.datepack` 파일 하나로 저장하고 주고받을 수 있어요. 데이트 중에는 **오늘** 화면이
가장 중요한 질문 하나만 답합니다 — _지금 어디쯤이고, 다음은 어디인가._
3초만 보고 폰을 다시 주머니에 넣을 수 있도록.

## 특징

- **서버 없음, 계정 없음.** 파싱·편집·가져오기·내보내기·사진까지 전부 브라우저 안에서
  처리됩니다. 업로드할 곳이 아예 없고, 한 번 불러오면 오프라인에서도 동작해요.
- **오늘 / 전체 일정 / 더보기.** NOW·NEXT만 크게 보여주는 오늘 화면("15:20쯤 천천히
  출발해요" 같은 사람다운 출발 권장 포함), 손대기 쉬운 전체 타임라인, 사진과 파일을
  모아두는 더보기.
- **`.datepack` 포맷.** ZIP 안에 `manifest.json`, `plan.json`, `assets.json`,
  `assets/` 폴더. 버전은 `major.minor`(현재 `1.0`)로 관리하고, 같은 major의 더 새로운
  minor는 경고 후 읽을 수 있어요. 정책은 `src/datepack/schema.ts` 참고.
- **일정마다 Plan B.** "줄이 너무 길면 건너뛰고 15:30에 재방문" 같은 대체 계획을
  일정마다 붙일 수 있고, 전환도 한 번의 탭, 언제든 되돌리기 가능.
- **AI 백엔드 없는 AI 재계획.** 앱이 상황과 제약을 담은 요청문을 만들어 주면, AI의
  답(JSON patch)을 붙여넣고 변경사항을 미리 본 뒤 승인해 적용합니다. API 키 입력도,
  텔레메트리도 없어요.
- **MapBridge.** 지도 버튼은 특정 지도 서비스에 묶이지 않고
  `mapbridge.threelight-studio.com/s/<base64>` 링크를 열어요.
- **한국어·영어 UI.** 번역이 아니라 각 언어로 새로 쓴 카피. 첫 화면 또는
  **더보기 → 언어**에서 바꾸면 선택이 저장됩니다.

## 상태

**퍼블릭 베타.** `0.x` 버전은 오픈 베타로 제공돼요. 포맷과 당일 엔진, 가져오기/내보내기는
안정적이지만 아직 거친 부분이 있을 수 있습니다. PWA로 설치할 수 있고 한 번 불러오면
오프라인에서도 동작해요. 버그 제보와 아이디어는
[GitHub Issues](https://github.com/ThreeLightStudio/datepack/issues)로 부탁드립니다.

## 개발

```bash
pnpm install
pnpm dev        # vite 개발 서버
pnpm verify     # oxfmt + oxlint + tsc + vitest
pnpm build      # 프로덕션 빌드 → dist/
```

자세한 구조와 주의 사항(싱글 탭 권장, IndexedDB 데이터 관리 등)은 위 영어 문서를
참고해주세요.

## 라이선스

[MIT](./LICENSE)
