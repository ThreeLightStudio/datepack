# Changelog

## 0.4.0 — 2026-10-02 (local pre-release)

- Format 4.0 separates outing plans and real standalone memory documents. Old
  imported formats are rejected; current local v3 data and drafts convert safely.
- Add home, photo-first memories, atomic record/photo connection changes,
  plan deletion with record preservation and non-overwriting file imports.
- Add optional solo/together, duration, nearby, one-venue and total/per-person KRW
  budgets to direct and AI planning. Use restorable dedicated AI screens and
  short focus-restoring sheets.
- Preserve legacy/new/edit record drafts and separate AI answer drafts. Keep
  revisions, original wording, protected fields and route verification guards.
- Update release examples and current docs. Verification and device limits are
  in [release readiness](docs/release-readiness.md). No deployment/publication.

## 0.3.0 — 2026-09-29

- Integrate DatePack format 3.0 planning, day-of adjustments, local undo and
  device state, experience memories, portable file export, and review-before-
  apply AI exchanges.
- Keep actual visits separate from planned events; save memories even when a
  plan was not used, and let people choose which memories and notes to share.
- Add release readiness and acceptance traceability for D01–D18, C01–C40, and
  the required end-to-end scenarios.
- Add a real DatePack 3.0 example emitted by `createDatePack` / `writeDatePack`
  and validated through `readDatePack`.
- Pre-release verification: `pnpm run verify`, `pnpm run build`, and
  `git diff --check` pass. Browser coverage and device limitations are recorded
  in [release readiness](docs/release-readiness.md).
- No deployment, publication, or package release was performed.

## 0.2.0

- Initial public beta of the DatePack web app.
