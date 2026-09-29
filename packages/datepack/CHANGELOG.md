# Changelog

## 0.3.0 — 2026-09-29

- DatePack file format 3.0 adds `baselinePlan`, `experiences`, and `revision`.
- Plans support an optional date, explicit order, exact/window/unscheduled timing,
  overnight `dayOffset`, candidates, meeting details, and granular protection.
- Legacy 1.0 ZIP and 2.0 JSON files convert deterministically to v3 while
  preserving plan, event, place, photo, and Plan B data. Confirmed runtime
  outcomes can become stable-ID experience facts.
- Unknown future file versions retain their original bytes on read errors.
- The package documentation now describes the v3 public types and APIs.

## 0.2.0 — 2026-09-27

Initial release as a standalone package. Extracted verbatim from the DatePack
web app's `src/datepack/` (which had grown into the seed of this library).

- DatePack format 2.0 (single `.datepack.json` document) and legacy v1.0 ZIP
  reading.
- Create / read / write / validate / patch / plan-draft / consistency APIs,
  with ko/en message catalogs for everything the package emits.
- The manifest `generator` string is now `datepack-core <version>` (previously
  `datepack-web <app version>`); `PACKAGE_VERSION` now tracks this package's
  version.
