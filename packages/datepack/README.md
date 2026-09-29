# @datepack/core

The UI independent library for reading, writing, validating, migrating, and patching portable `.datepack.json` files.

## Format 3.0

The in-memory `DatePack` object contains `manifest`, `plan`, `assets`,
`baselinePlan`, `experiences`, and a monotonic `revision` field. `writeDatePack`
serializes manifest metadata (`format`, `version`, `createdAt`, `updatedAt`, and
`generator`) at the JSON document's top level. Each serialized asset entry
contains its registry fields and, when its blob is available, a `data:` URL in
`assets[].data`. The package version and file format version are independent;
this release is `@datepack/core` 0.3.0 with file format 3.0. The checked-in
[3.0 example](../../examples/classic-seoul-day-2026-09-28.datepack.json) is
generated with this package's public creation/writer APIs and validated by
`readDatePack` in the core tests.

Plans may omit `date`. Each event has an explicit `order` and a `timing` union:

```ts
type LocalPoint = { dayOffset: 0 | 1; time: string }; // validated HH:mm
type EventTiming =
  | { kind: 'exact'; start: LocalPoint; end?: LocalPoint }
  | { kind: 'window'; earliestStart: LocalPoint; latestStart: LocalPoint }
  | { kind: 'unscheduled'; label?: string };
```

`window` describes possible start times, not a duration. `dayOffset: 1` represents a time on the day after the plan date. Exact intervals and start windows cannot exceed 24 hours. The event array and `order` field are authoritative; changing a time never sorts events. `findPlanConflicts` reports time/order inversions for review and separately checks chronological overlaps. Plans also support candidates (including excluded choices), places, constraints, a separate meeting point, and shared travel notes. Personal origins or routes are not part of the portable model.

Events can set `importance` and independently protect `time`, `place`, `content`, `delete`, or `order`. `experiences` record user-confirmed completed/skipped events or notes; their occurrence date and optional exact/approximate time are independent of the plan date, and `recordedAt` stores when the fact was entered. Broken v3 references to places, events, or asset registry entries fail validation and block the whole read/apply.

## Public API

```ts
import {
  createDatePack, createEvent, validateDatePack,
  readDatePack, writeDatePack,
  migrateLegacyDatePack,
  parsePatch, describePatch, applyPatch,
} from '@datepack/core';

const pack = createDatePack({ title: 'Afternoon together' });
pack.plan.events.push(createEvent({
  title: 'Dinner',
  order: 0,
  timing: { kind: 'unscheduled', label: 'After the gallery' },
}));

const validation = validateDatePack(pack);
const result = await readDatePack(fileBlob);
const exported = await writeDatePack(result.pack, (assetId) => loadBlob(assetId));
```

- `createDatePack({ title, date? })` returns a v3 pack with a matching baseline snapshot, revision 0, and an empty experience log.
- `validatePlan` and `validateDatePack` check structure, dates, time semantics, required IDs, revision metadata, and references. Missing asset registry references are errors. A registry entry whose binary photo blob is unavailable remains valid: writing reports its ID in `missingAssetIds`, and reading keeps the registry record without a blob.
- `readDatePack(blob)` reads v3 JSON and converts supported 1.0 ZIP / 2.0 JSON files to v3. The returned `ReadResult` includes the pack, extracted asset blobs, and warnings.
- `migrateLegacyDatePack(legacy, runtime?)` is a pure deterministic converter. It maps legacy times to exact timing, preserves event and asset IDs, turns legacy fixed events into full field protection, and only creates experiences for runtime states explicitly marked completed or skipped. Generated experience IDs are stable across retries.
- Unsupported future versions reject with `DatePackReadError.originalFile` containing the untouched input bytes. The caller can offer those bytes for save-as or export without reserializing them.
- `writeDatePack(pack, loadBlob)` validates references, then writes format 3.0 JSON with base64 data URLs. Invalid structure/references throw `DatePackWriteError`. A missing binary blob with a valid registry entry remains nonfatal and its ID is returned in `missingAssetIds`.
- `parsePatch` / `describePatch` / `applyPatch` remain the v1 patch proposal API. They prepare a complete cloned result before apply and reject protected changes atomically. Existing `start` and `fixed` proposal fields are compatibility inputs; v3 events store `timing` and `protectedFields`.

Runtime progress such as pending/current status, delay, and selected Plan B
stays device local and is not exported as a file fact. The web app's IndexedDB
layer manages local saves and plan undo; the core package does not own storage
transactions. Consumers changing a pack directly must update `revision`
themselves before validating or writing it.

## Verification

```sh
pnpm --filter @datepack/core verify
```
