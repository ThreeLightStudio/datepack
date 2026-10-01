# U04 integration verification · 0.4.0

2026-10-02, Asia/Seoul. Input `d83b030983c37ba2c788e29eec6c345a8d621d08`
with reviewed U01/U02/U03 results already applied. App and core 0.4.0; file 4.0.
Main review remains required. No deployment, push, PR, publication or recruitment.

## Changes and checks

- Align package versions, PWA/browser descriptions and current docs with outing
  plans and standalone memories. Keep historical T05–T07 evidence and archive the
  previous release readiness separately. Preserve user research unchanged.
- Add a real title-free photo-only memories example and reader/writer binary
  roundtrip test. Existing outing example now identifies core 0.4.0.
- Fix production preview's `/datepack/` base path. Fix current-situation sheet
  focus returning to its trigger. Clarify Korean AI creation and plan-saving copy.
- Final automatic check: format/lint/app and core types, **172 app + 111 core =
  283 passing tests**. Meaningful existing safety/atomicity/migration/condition
  tests remain unchanged; failure-injection stderr is expected.
- Production build: 15 PWA precache entries, 873.50 KiB; main JS 572.23 kB,
  gzip 173.29 kB. Existing >500 kB warning remains. Detector `[]`, diff check clean.

Raw logs, fixtures, DOM/data observations and more screens are in local
`/Users/three-light/.codex/orchestration/datepack-usage-v4-20261001-01a0f765/U04-evidence/`.
The final handoff records exact result/build identity and environment constraints.
The dependency runtime was inspected read-only; no unsupported browser driver,
new installation, OS unlock or direct browser-profile access was attempted.

## Browser observations

Chrome desktop browser through CUA on isolated `127.0.0.1:5185/datepack/`.
Only synthetic records and public icon PNGs; prior user-data origins untouched.
The initial 0.4.0 build used `index-5Higti_f.js`; the focus fix confirmation used
`index-mzMGZxNQ.js`; the final Korean-copy build is `index-hOBZKvj7.js`.
These identities are distinguished rather than treating earlier images as final-copy screenshots.

| Check                          | Observed result                                                                                                                                           | Evidence / scope                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Empty home and photo-only save | Two selected PNGs become one title-free independent record. No automatic description editor                                                               | [saved](evidence/u04/production-offline-photo-saved-ko-390.png), initial 0.4.0 build                   |
| Production offline restart     | Stop server; connection refusal; save photos; reload then close/new-tab reopen works and shows both photos                                                | server-stop log, offline-photo-restart-state.json; cached browser app, not installed device            |
| Offline file contents          | Blob export/read/import; hashes equal for both PNGs; original experience unchanged; same file dedup; changed-title same-ID copy dedup; original unchanged | offline-blob-roundtrip.json; diagnostic public core/storage API, not native download                   |
| Past-date correction           | 2026-09-25, 14:20, original note and manual place stored with original recordedAt                                                                         | state snapshots / record screen                                                                        |
| Connections                    | Activity coffee → changed to second activity → unlink → different AI-created plan-only connection                                                         | final-unlink-state.json, final-linked-plan-only-state.json; ID/note/dates/PNG hashes preserved         |
| Direct solo plan               | Solo, region, 60min, KRW 10000 total, nearby, singleStop persisted. Solo has no meeting summary                                                           | offline-direct-plan-state.json and desktop input image                                                 |
| Direct next destination        | Current-situation sheet adds named unscheduled next activity and stores manual nextPlaceId. No route verification claim                                   | production-direct-next-sheet/return images and document/runtime snapshot                               |
| Sheet keyboard/return          | Shift+Tab reaches Save; Tab reaches Close; Back closes sheet; final focus fix returns to Update now                                                       | final-context-focus.json, [focus](evidence/u04/final-direct-next-focus-ko-390.png) on mzMG build       |
| Simulated AI creation          | Same conditions in request; hand-written reply omits conditions; review/save keeps user conditions. Answer survives Back/reload/resume                    | create-request.json, mock-create-answer.json, [review](evidence/u04/final-ai-create-review-ko-390.png) |
| Plan deletion                  | Correct record/photo-preservation confirmation observed; native dialog processing then tool stalled                                                       | outcome not inferred; automatic recordsV4 deletion/rollback tests are passing                          |
| Actual download                | Clicked download; event timed out after 10 seconds. Internal downloads page blocked by browser URL policy                                                 | file retrieval/re-import remains unverified                                                            |

Mobile CSS **390×844**, scrollWidth=390 was measured on photo/AI/context flow.
A new tab reset to desktop **1291×772**; its direct-condition screenshot is labeled
`production-direct-solo-ko-desktop.png`, not falsely called 390px. U03 reviewed
KO/EN **390×844, 320×800, 1440×900** screens remain applicable to unchanged layouts.
Final-copy IAB English screens were readable with measured desktop 1719×1075 and
narrow 382×955, both without overflow. Requested IAB sizes did not match CSS
sizes, so the report uses measured values. After native confirmation stalled,
further IAB input did not change UI state; those clicks are not counted as successes.
Mac locked status was explicitly reported by the native-app tool. A second browser
did not complete the remaining interactive checks. Final-copy KO/EN interaction,
latest-build interactive photo/AI checks and delete-confirmation outcome remain unobserved.
After stopping the final server, a fresh IAB tab loaded the exact final
`index-hOBZKvj7.js` shell offline; screenshot/DOM and connection-refusal log are
in final-build-offline-shell evidence. No global network disconnection is claimed.
Earlier verified flows are retained rather than rerun.

## Retained prior evidence

U02 reviewed photo cancellation, raw HEIC/invalid images, injected quota preserving
selection, original AI wording and composite-key conflict recovery. U03 amendment
reviewed actual v3 rows plus visible legacy resume, six fields/activity context,
intentional save, new/edit restart, revision conflict compare/continue/save and
AI-answer separation. These are retained predecessor proofs, not new U04 runs.

## Limits

Desktop browser cache/offline is not a physical installed iOS/Android PWA.
External AI apps, actual GPS, OS share, native HEIC conversion, screen readers,
200% text enlargement and touch gestures remain unverified. Raw HEIC is rejected;
platform-converted supported MIME with successful decoding is accepted. Unsaved
new File selection needs re-selection after app shutdown. Public routing stays
provider-disabled; required unverified route changes remain blocked. Historical
UI findings remain open and the previous 15/20 audit is not a new U04 score.

The user-owned research remains untracked and unstaged with SHA-256
`dc584044f4f6c61130cdbc9cda0625f69a0d23aa014c3a22249ac89055dcd8dc`.
