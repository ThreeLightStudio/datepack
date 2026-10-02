# @datepack/core

UI-independent creation, reading, writing, validation and plan patching for
portable `.datepack.json` documents. Package **0.4.0**, file format **4.0**.

## Two document kinds

`DatePack = OutingDatePack | MemoriesDatePack`. Common fields are `id`,
`manifest`, `meta`, `revision`, `experiences` and `assets`.

- `outing` requires `plan` and `originalPlan` (the initial snapshot).
- `memories` has no plan fields and contains at least one real experience.
- Experience titles are optional; a record needs photos or nonblank title/note.
  `recordedAt` is an instant; `occurredOn` and optional occurrence timing describe
  the experience separately. No planned event is automatically a visited fact.
- A document ID need not equal a plan ID. File copies retain plan/experience IDs
  but get a new document ID. Storage and AI request `packId` use document IDs.

`writeDatePack` flattens manifest format/version/generator/timestamps at the
JSON top level, adds id/kind/meta and embeds binary assets as `assets[].data`
data URLs. [Outing](../../examples/classic-seoul-day-2026-09-28.datepack.json)
and [independent photos](../../examples/independent-photos.datepack.json)
are real reader/writer fixtures. Runtime, exact GPS, requests and drafts stay
outside portable files.

## Plans and optional conditions

Dates can be omitted. Events preserve array order and explicit `order`; editing
a time does not sort them. `timing` is exact, window (possible start times), or
unscheduled. `LocalPoint.dayOffset: 0 | 1` supports overnight plans; exact spans
and windows cannot exceed 24 hours. Conflicts are reported for review.

`outingConditions` can include party (solo/together), region, durationMinutes
(integer 1–1440), nearby, singleStop and budget `{currency: 'KRW', amount, basis}`.
Amount is a nonnegative safe integer, and basis is `total` or `per-person`.
These are user preferences and budget ceilings, not verified prices/spending.
Available-from and must-end-by are optional LocalPoints. Solo requires no meeting.

Plans also contain places, candidates, meeting and travel notes. Granular event
protection covers time/place/content/delete/order; importance alone is not
protection. AI cannot remove protection. A broken reference fails validation.

## Public API

```ts
import {
  createDatePack, createEvent, createMemoriesPack,
  validateDatePack, readDatePack, writeDatePack,
} from '@datepack/core';

const outing = createDatePack({
  title: 'An hour nearby',
  outingConditions: {
    party: 'solo', durationMinutes: 60, nearby: true, singleStop: true,
    budget: { currency: 'KRW', amount: 10000, basis: 'total' },
  },
});
outing.plan.events.push(createEvent({ title: 'Coffee', order: 0 }));
const memories = createMemoriesPack([
  { id: 'memory-one', outcome: 'note', recordedAt: new Date().toISOString(), note: 'A quiet walk' },
]);
const checked = validateDatePack(memories);
const loaded = await readDatePack(fileBlob);
const exported = await writeDatePack(loaded.pack, async id => loaded.blobs.get(id) ?? null);
```

- `createDatePack` / `buildPlanFromDraft` return outings; initial originalPlan
  and revision 0 are created alongside the plan. `createMemoriesPack` creates
  a standalone collection with real content.
- `validatePlan` / `validateDatePack` check shape, IDs, dates, timing, conditions,
  revision and references. Missing registry entries fail; a registered asset with
  missing binary remains valid. Writer reports `missingAssetIds`.
- `readDatePack` accepts only format 4.0 JSON. Older ZIP/JSON and other versions,
  including 4.1, reject with untouched bytes in `DatePackReadError.originalFile`.
  The lower-level `checkFormatVersion` classifier warns on newer minor versions;
  this does not widen file-reader support. Reader does not migrate old imported files.
- `migrateLocalV3DatePack` and legacy converters exist only for preserving
  existing local data. The web app stores conversion plus backup/completion
  marker atomically and leaves the source available after a failed attempt.
- `parsePatch` / `describePatch` / `applyPatch` use the `datepack.patch` v1
  proposal contract. They take outings and prepare complete cloned results;
  protected changes are rejected atomically. `datepack.plan` v1 remains the AI
  creation draft format, with additive conditions and optional timing.
- Direct mutation callers must update revision before validation/writing.
  The core owns no IndexedDB transaction. The app owns atomic record/photo saves,
  linking, plan deletion with record preservation, deduplicating imports and
  revision-guarded plan/AI commits.

## Verification

```sh
pnpm --filter @datepack/core verify
```
