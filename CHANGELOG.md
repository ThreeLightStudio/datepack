# Changelog

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
