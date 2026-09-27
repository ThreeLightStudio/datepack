# Changelog

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
