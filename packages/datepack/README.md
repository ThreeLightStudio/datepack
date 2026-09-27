# @datepack/core

The DatePack file format library — read, write, validate and patch portable
`.datepack.json` documents. Deliberately UI-free: no React, no components, no
app state. The [DatePack web app](https://github.com/ThreeLightStudio/datepack)
is one consumer; future products consume the same format through this package.

## What's inside

- **Format & schema** — `major.minor` version policy (newer minors read with a
  warning, other majors rejected; legacy v1.0 ZIP still readable), manifest
  parsing, generator stamping.
- **Create / read / write** — factory helpers, single-JSON-document reading
  (with base64-inlined assets), export filenames.
- **Validate & patch** — structural validation with localizable issues, and the
  AI patch pipeline (`parsePatch` → `describePatch` → `applyPatch`).
- **Plan drafts & consistency** — parse AI-authored `datepack.plan` JSON and
  check a plan for overlaps and impossible travel times.
- **Localization surface** — the package owns the message catalogs for
  everything it emits (`err.*`, `warn.conflict.*`, `change.*`) in ko/en, with
  `format` / `localizeIssues` helpers. Host apps can merge these catalogs into
  their own i18n layer (the web app does exactly that).

## Usage

```ts
import { readDatePack, writeDatePack, validateDatePack, applyPatch } from '@datepack/core';
```

Consumed as source (`exports` points at `src/index.ts`), so bundlers — Vite,
Next, etc. — compile it directly. A compiled `dist/` build will be added when
the package is first published to npm.

## Versioning

Versions are managed manually in `package.json` (see `CHANGELOG.md`). The
format version (`2.0`) and the package version are independent: the format
version is what readers check, the package version tracks the library itself
and shows up in the manifest `generator` string (`datepack-core x.y.z`).
