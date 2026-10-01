# DatePack 0.4.0 release readiness

2026-10-02 (Asia/Seoul) · app/core **0.4.0** · portable format **4.0**.
Local pre-release implementation; no push, PR, deployment or publication.
U04's report is reviewable evidence, not self-approval of the whole project.
The main orchestrator owns final acceptance. [Integration report](u04-integration.md)
records the tested result, build and outstanding environment/device limits.

## Current contract

- Home / Plans / Memories; home can start with photos and no plan.
- Format 4.0 outing/memories, document identity, originalPlan, title-free photo
  records and separate occurrence/recorded timestamps. Independent documents
  have real records and no fake plan.
- Atomic record/photo saves, links and unlinking; plan deletion preserves linked
  memories. Imports deduplicate identical contents or create conflict copies.
- Only 4.x imported files. Existing local v3 data/drafts migrate separately;
  source data survives failure for retry. Historical 3.0 reader claims are in
  the [archived readiness report](archive/release-readiness-0.3.0.md).
- Optional solo/together, region, 1–1440 minutes, nearby/one venue and KRW budget
  with total/per-person basis. Direct planning and AI share the same conditions.
- Durable legacy/new/edit record text and separate AI answer drafts, revision
  conflict review and explicit saving. Unsaved new File selection does not
  survive complete app shutdown.
- Long AI work uses restorable screens; short editing/linking/sharing uses sheets.
  Original wording, protected fields, request/document identity and stale checks
  remain enforced. A map link is not route evidence; public routing remains disabled.

## Verification sources

| Source                                | Verified scope                                                                                                    | Limits                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| U01 reviewed `1a1aa80`                | format/storage/atomic rollback/local migration/import/AI safety                                                   | automatic fixtures                                                    |
| U02 reviewed `6cba751`                | photo-first save/restart/date/link/unlink, failures and sharing                                                   | viewport desktop browser, injected quota/share, native picker pending |
| U03 reviewed `1836790` + `d83b030`    | direct/AI conditions/screens, v3 visible draft resume, intentional save, new/edit restart/conflict                | synthetic AI/v3 fixtures, no native AI                                |
| U04 [integration](u04-integration.md) | final version/docs/examples, production browser cache, photo save/restart/Blob roundtrip, direct next destination | final result and environment constraints listed in report             |

The latest automatic verification and build logs are associated with U04's
result in its handoff. The existing main JavaScript chunk exceeds Vite's 500 kB
warning threshold; this work does not hide that warning or introduce a performance redesign.

## Device and operating checks still needed

- Physical iOS Safari / Android Chrome installed PWA: installation, cold launch,
  offline editing/photos/import/export and external-app return.
- Raw HEIC/HEIF is not decoded/converted by the app. Platform image conversion
  behavior and native photo-picker cancellation need device verification.
- Actual GPS consent/failure/freshness, operating public route services, external
  AI compliance, OS sharing, VoiceOver/TalkBack and enlarged text.
- Actual download completion and recovered file re-import are distinct from
  tested generated Blob contents and reader/writer/storage roundtrip.
- Screen layout at mobile CSS widths is not physical touch or installed-PWA proof.

Recruitment/usability study, deployment, publishing, accounts, a recommendation
server/feed, automatic tracking and an expense ledger are outside U01–U04.
