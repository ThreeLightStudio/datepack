# DatePack

**Local-first outing plans and photo memories, alone or together.**

App and core version **0.4.0** · portable file format **4.0** · public beta.
This checkout has not been deployed. The [public site](https://threelightstudio.github.io/datepack/)
may show an earlier release. See [release readiness](docs/release-readiness.md) for verification and limits.

## Start with a plan or a photo

Home works without a plan. Save several photos as one memory: select photos,
review or remove them, then save once. A title, description, date and plan
connection are optional. Saving finishes before any optional editor opens.
You can also write a memory without photos.

Home / Plans / Memories are the main tabs. Inside a selected plan, Now & Next
and the full itinerary keep their roles. Language, files and app information
are in the top menu. Home brings back saved AI work and user-confirmed outings;
a calendar date alone never marks an outing started or an activity visited.

Make a loose plan directly or use your own AI app. Optional conditions include
solo/together, region, duration, nearby travel, one venue and a KRW budget with
an explicit total or per-person basis. Quick conditions are editable; the short
outing default is 120 minutes and the low-budget default is 10,000 KRW.
Solo plans do not require a companion or meeting point. Prices, opening hours
and travel times stay unverified unless independently supported.

Short edits, memory connections and sharing open sheets. Long AI requests and
answer review use dedicated screens. Draft text and saved requests survive
restart. New, unsaved photo selections survive closing a sheet and retrying in
the same running app; after app shutdown, select those photos again.

## Your data and files

- No DatePack account, AI backend or automatic upload. Parsing, photos,
  editing and storage run locally in the browser. Explicitly sharing an AI
  request sends its text through the app you choose.
- A `.datepack.json` file is one JSON document with embedded photo data URLs.
  Format 4.0 has `kind: outing` with `plan` and `originalPlan`, or `kind: memories`
  with real records and no plan. Both have a document ID, metadata, revision,
  experiences and assets. Document IDs and plan IDs have separate roles.
- [Outing example](examples/classic-seoul-day-2026-09-28.datepack.json) and
  [title-free independent photo example](examples/independent-photos.datepack.json)
  are checked by the core reader/writer tests. See [core API](packages/datepack/README.md).
- Only format 4.0 files are accepted. Older files and other versions, including
  4.1, are rejected
  and retained as original bytes for recovery. Existing current-v3 **local**
  data is converted separately, with its plans, photos, runtime and unfinished
  input preserved. Source stores survive failed conversion for retry.
- Connecting, changing or removing a memory's connection moves its record and
  photos together. Deleting a plan preserves its memories as independent
  records. Deleting a memory is a separate explicit action.
- Import never silently overwrites existing content. Identical files deduplicate;
  a different file with the same document ID becomes a copy with a new ID.
- AI wording saves `editedNote` separately from the user's original `note`.
  Request identity, revision, scope, protected fields and freshness are checked
  before application. Unverified route-sensitive changes stay blocked.
- Memory sharing sends selected text. Downloading a file includes the entire
  document and its available photos, not just the checked memories.
- IndexedDB is the database. Clearing site data removes local plans and photos.
  Keep exports of what matters. Concurrent stale edits are rejected and offer
  recovery rather than silently overwriting another tab's work.

## Browser and app use

Open the site in a browser. Safari offers **Share → Add to Home Screen**;
Android Chrome offers **Install app**; desktop Chrome/Edge offer an install icon.
The build includes a PWA service worker and local assets. Once the app shell
has been cached, local work can continue offline. This release's browser tests
are recorded separately from physical installed-PWA verification, which remains
pending on iOS and Android. Native share, GPS, HEIC picker conversion and a real
external AI round trip also need device checks.

Raw HEIC/HEIF is not converted by DatePack. Use a supported, decodable image;
a platform-converted JPEG/PNG is accepted even if the original name ends in HEIC.
Storage errors keep input and selected photos available for retry in the running app.

Map buttons open [MapBridge](https://mapbridge.threelight-studio.com/).
A map link is not evidence of a route or arrival. Public route/resolver services
remain disabled until their operating conditions are met.

## Development

Requires Node ≥24.14.1 and pnpm 10.

```sh
pnpm install
pnpm dev
pnpm verify   # format, lint, app/core types and tests
pnpm build    # dist/ including PWA output
```

`packages/datepack` contains UI-free `@datepack/core`; `src` contains the React
app, IndexedDB storage, home/plan/record/AI features and Korean/English catalogs.
The font is bundled Pretendard. [Product flow](docs/product-flow.md),
[AI contract](docs/ai-flow-contract.md) and [acceptance](docs/ai-flow-acceptance.md)
describe the current implementation.

## 한국어 안내

**혼자 또는 함께하는 외출을 준비하고, 계획 없이도 사진으로 순간을 남깁니다.**

홈에서 사진을 고르고 미리보기 뒤 저장하면 기록이 완성됩니다. 여러 사진은 한 기록으로
저장하고, 설명과 과거 날짜 보완·일정 연결은 나중에 선택할 수 있습니다. 글만 남기는
경로도 있습니다. 홈 / 일정 / 기록으로 이동하고, 언어와 파일 관리는 상단 메뉴에서 엽니다.

혼자·함께, 지역, 사용 시간, 가까운 이동, 한 곳 방문과 원화 예산을 선택할 수 있습니다.
예산은 전체인지 한 사람당인지 명시합니다. 직접 계획과 내 AI 앱에 보내는 요청에 같은
조건을 사용하며, 확인하지 않은 가격이나 이동 시간을 확정 정보로 다루지 않습니다.

파일 형식은 4.0입니다. 외출 문서에는 계획과 원래 계획이 있고, 독립 기록 문서에는
계획이 없습니다. 구버전 파일은 가져오지 않으며, 기존 기기의 3.0 로컬 자료는 별도로
변환해 보존합니다. 같은 ID의 다른 파일은 기존 내용을 덮지 않고 복사본으로 가져옵니다.
일정을 삭제해도 연결했던 기록과 사진은 독립 기록으로 남습니다.

작성 중인 글과 AI 작업은 재실행 후 복원됩니다. 저장하지 않은 새 사진 선택은 앱 완전
종료 후 다시 선택해야 합니다. 앱에는 서버·계정·자동 업로드가 없고, 사용자가 AI 요청을
공유할 때에만 선택한 외부 앱으로 전달됩니다. 사이트 데이터를 지우기 전에 중요한
문서는 `.datepack.json`으로 내보내 두세요. 실제 iOS/Android 설치 PWA, HEIC 변환,
GPS, OS 공유와 외부 AI 왕복은 아직 실기기 확인이 필요합니다.

## License

[MIT](LICENSE)
