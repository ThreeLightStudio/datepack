# DatePack

**A local-first date planner that carries plans, photos, and recorded experiences in one portable `.datepack.json` file.**

[Try the web app](https://threelightstudio.github.io/datepack/) · [한국어](README.ko.md) · [Core format API](packages/datepack/README.md) · [Release readiness](docs/release-readiness.md)

**Public beta — app 0.3.0, file format 3.0.** Planning, file import/export, and user-supplied AI replies have public implementation and tests. Installed mobile PWA, offline restart, accessibility, and native sharing still need real-device acceptance; see [readiness](docs/release-readiness.md). The product aims to reduce replanning during a date; that goal is not a measured usability result.

## A plan becomes a portable file

The checked-in [Classic Seoul Day example](examples/classic-seoul-day-2026-09-28.datepack.json) contains a “Coffee together” stop with a 14:00–15:00 start window, a place, and an inline photo. The [example-file test](packages/datepack/tests/exampleFile.test.ts) reads that file through the core API.

1. **Input:** create a title and optional date, then add ordered stops with exact, window, or unscheduled timing. [Creation API](packages/datepack/src/create.ts)
2. **File:** validate the pack and write format 3.0 JSON; available asset blobs become `data:` URLs inside the file. [Validator](packages/datepack/src/validate.ts) · [Writer](packages/datepack/src/write.ts)
3. **Read and import:** `readDatePack` validates the document and extracts asset blobs. The app imports the result into IndexedDB and selects the imported plan. [Reader](packages/datepack/src/read.ts) · [Import flow](src/store/datepackStore.ts)
4. **Use the adopted plan:** open it in the itinerary or Today view, edit the next stop, and export the updated pack. Importing a plan does not mark its stops as visited. [Plan view](src/features/plan/PlanView.tsx) · [Day view](src/features/day/DayView.tsx)

A minimal example inside this workspace uses the same public core APIs (no photos in this example):

```ts
import { createDatePack, createEvent, validateDatePack,
  writeDatePack, readDatePack } from '@datepack/core';

const pack = createDatePack({ title: 'Afternoon together' });
pack.plan.events.push(createEvent({
  title: 'Coffee together', order: 0,
  timing: { kind: 'window',
    earliestStart: { dayOffset: 0, time: '14:00' },
    latestStart: { dayOffset: 0, time: '15:00' } },
}));
pack.baselinePlan = structuredClone(pack.plan);
if (!validateDatePack(pack).ok) throw new Error('Invalid plan');
const file = await writeDatePack(pack, () => null);
const restored = await readDatePack(file.blob);
// restored.pack is the validated plan; restored.blobs holds extracted photos.
```

The [roundtrip tests](packages/datepack/tests/datepack.test.ts) cover plans, photos, missing blobs, and older/future inputs. This snippet illustrates the API; it is not a separate published package installation guide.

## Three design decisions to inspect

**A plan is different from what happened.** Format 3.0 carries the current `plan`, a `baselinePlan`, explicit `experiences`, assets, and a revision. Recorded experiences can retain place/event snapshots when a plan changes. Current situation, personal travel details, pending AI requests, and undo history live in separate device state in IndexedDB. See [types](packages/datepack/src/types.ts), [storage](src/storage/indexedDb.ts), and [v3 tests](packages/datepack/tests/v3.test.ts).

**Portability includes compatibility boundaries.** The reader migrates supported 1.0 ZIP and 2.0 JSON files to 3.0. Unsupported future input is rejected with the original file retained on `DatePackReadError.originalFile`, so callers can save the untouched bytes. The writer validates references and reports missing binary blobs separately. See [reader](packages/datepack/src/read.ts), [writer](packages/datepack/src/write.ts), and [compatibility tests](packages/datepack/tests/datepack.test.ts).

**AI output is a proposal before adoption.** Users explicitly share a request with their own AI assistant and paste its reply back. The app checks request identity, plan/context revisions, duplicates, scope, and protected changes, then shows changes and warnings before approval. Some planning conflicts are advisory warnings, not a guarantee that venues or timings are feasible. See [reply contract](src/features/ai/exchange.ts), [review/apply UI](src/features/ai/AiSection.tsx), [commit guards](src/storage/indexedDb.ts), and [exchange tests](tests/aiExchange.test.ts).

## Browser use and data boundaries

Planning and file handling run in the browser; the AI handoff sends a request only through the external app the user chooses. [AI handoff](src/features/ai/AiSection.tsx) · [Product flow and future direction](docs/product-flow.md)

The [PWA configuration](vite.config.ts) caches the app shell and requested fonts. Browser installation is available where supported; installed iOS/Android use, offline launch, VoiceOver/TalkBack, OS sharing, and reopening exports on another device remain [acceptance work](docs/release-readiness.md).

Keep file exports for dates you care about: clearing site data removes browser-local storage. Prefer one editing tab; the public beta's [storage/concurrency tests](tests/indexedDb.test.ts) exercise revision guards, but do not establish a complete multi-tab sync experience. Map buttons use the existing public [MapBridge place-query URL helper](src/utils/mapBridge.ts), with [URL tests](tests/mapBridge.test.ts); this is an integration reference.

## Development and verification

Use **Node ≥24.14.1 and pnpm 10.33.2**, as declared in [package.json](package.json).

```sh
pnpm install
pnpm dev
pnpm verify
pnpm build
```

`verify` runs formatting, linting, typechecking, app tests, and the core package's checks; `build` produces the Vite app. The [UI-free core](packages/datepack/README.md) is a workspace dependency, independently versioned from the file format.

The audited public commit has successful [Verify](https://github.com/ThreeLightStudio/datepack/actions/runs/36710171947) and [Pages deployment](https://github.com/ThreeLightStudio/datepack/actions/runs/36710172631) runs. These are automated workflow observations, distinct from the device acceptance above. No GitHub release artifact was listed at that commit. For the source layout and detailed format rules, follow [core docs](packages/datepack/README.md), [tests](tests/), and [release readiness](docs/release-readiness.md).

[Report an issue](https://github.com/ThreeLightStudio/datepack/issues) · [MIT license](LICENSE)
