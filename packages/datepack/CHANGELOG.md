# Changelog

## 0.4.0 — 2026-10-02

- Format 4.0 adds document id/kind/meta and outing/memories union. Outings require
  plan/originalPlan; standalone collections require real records and no plan.
- Titles are optional when a record has photos or nonblank text. Record and
  occurrence timestamps remain distinct. Portable photos retain binary content.
- Only format 4.0 file reads are accepted; other versions, including 4.1, reject.
  Existing local v3 conversion is a separate
  API; original bytes remain available on unsupported-file errors.
- Plan draft and validation preserve optional outing conditions: solo/together,
  region, duration, nearby, singleStop and total/per-person KRW budgets.
- Plan changes accept outings; both document kinds support validation/writing.
  Package generator is datepack-core 0.4.0; release examples cover both kinds.

## 0.3.0 — 2026-09-29

- DatePack file format 3.0 adds `baselinePlan`, `experiences`, and `revision`.
- Plans support an optional date, explicit order, exact/window/unscheduled timing,
  overnight `dayOffset`, candidates, meeting details, and granular protection.
- Legacy 1.0 ZIP and 2.0 JSON files convert deterministically to v3 while
  preserving plan, event, place, photo, and Plan B data. Confirmed runtime
  outcomes can become stable-ID experience facts.
- Unknown future file versions retain their original bytes on read errors.
- Explicit event order is preserved when times change; time/order inversions are
  surfaced as advisory conflicts. Broken plan, asset, and Plan B references block
  validation and writes, while missing binary photo blobs remain nonfatal.
- Legacy travel estimates now reference the immediately previous stop's place
  when known, and migrated experience facts retain their recorded timestamp.
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
