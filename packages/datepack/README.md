# @datepack/core

The UI independent library for reading, writing, validating, migrating, and patching portable `.datepack.json` files.

## Format 3.0

A v3 document keeps `manifest`, `plan`, and `assets`, and adds `baselinePlan`, `experiences`, and a monotonic `revision` field. The package version and file format version are independent; this release is `@datepack/core` 0.3.0 with file format 3.0.

Plans may omit `date`. Each event has an explicit `order` and a `timing` union:

```ts
type LocalPoint = { dayOffset: 0 | 1; time: string }; // validated HH:mm
type EventTiming =
  | { kind: 'exact'; start: LocalPoint; end?: LocalPoint }
  | { kind: 'window'; earliestStart: LocalPoint; latestStart: LocalPoint }
  | { kind: 'unscheduled'; label?: string };
```

`window` describes possible start times, not a duration. `dayOffset: 1` represents a time on the day after the plan date. Exact intervals and start windows cannot exceed 24 hours. Plans also support candidates (including excluded choices), places, constraints, a separate meeting point, and shared travel notes. Personal origins or routes are not part of the portable model.

Events can set `importance` and independently protect `time`, `place`, `content`, `delete`, or `order`. `experiences` record user-confirmed completed/skipped events or notes; their date and timing are independent of the plan's date. Asset references that have no registry entry produce warnings and do not prevent reading.

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
- `validatePlan` and `validateDatePack` check structure, dates, time semantics, required IDs, revision metadata, and references. Missing asset references are warnings.
- `readDatePack(blob)` reads v3 JSON and converts supported 1.0 ZIP / 2.0 JSON files to v3. The returned `ReadResult` includes the pack, extracted asset blobs, and warnings.
- `migrateLegacyDatePack(legacy, runtime?)` is a pure deterministic converter. It maps legacy times to exact timing, preserves event and asset IDs, turns legacy fixed events into full field protection, and only creates experiences for runtime states explicitly marked completed or skipped. Generated experience IDs are stable across retries.
- Unsupported future versions reject with `DatePackReadError.originalFile` containing the untouched input bytes. The caller can offer those bytes for save-as or export without reserializing them.
- `writeDatePack(pack, loadBlob)` writes format 3.0 JSON with base64 data URLs. Missing blobs remain as registry records and their IDs are returned in `missingAssetIds`.
- `parsePatch` / `describePatch` / `applyPatch` remain the v1 patch proposal API. They prepare a complete cloned result before apply and reject protected changes atomically. Existing `start` and `fixed` proposal fields are compatibility inputs; v3 events store `timing` and `protectedFields`.

Runtime progress such as pending/current status, delay, and selected Plan B stays device local and is not exported as a file fact. Storage transactions, undo history, and revision increments on app edits are implemented in the next storage phase; consumers writing changes directly must update `revision` themselves.

## Verification

```sh
pnpm --filter @datepack/core verify
```
