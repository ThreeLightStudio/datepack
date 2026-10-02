import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDatePack, createEvent, type Experience } from '@datepack/core';
import {
  closeStorage,
  listPacks,
  loadPack,
  savePack,
  saveAiFormDraft,
  loadAiFormDraft,
  saveExperience,
  listRecordFormDrafts,
} from '../src/storage/indexedDb';
import {
  emptyRecordDraft,
  persistRecordDraft,
  restoreRecordDrafts,
  editDraftKey,
  flushRecordDrafts,
} from '../src/features/memories/recordDrafts';
import { collectRecords } from '../src/features/memories/recordLibrary';
import { memoryAnswerDraftKey } from '../src/features/ai/useAiDraft';

const legacy = {
  title: '예전 제목',
  note: ' 원문\n줄바꿈 그대로 ',
  eventId: 'walk',
  placeName: '서울숲',
  occurredOn: '2026-09-29',
  time: '14:35',
  outcome: 'completed',
};
const record: Experience = {
  id: 'memory',
  title: 'Saved',
  note: 'original',
  outcome: 'note',
  recordedAt: '2026-10-02T00:00:00Z',
};
beforeEach(async () => {
  await flushRecordDrafts().catch(() => {});
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('datepack');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeStorage();
});
async function outing() {
  const pack = createDatePack({ title: 'Legacy outing' });
  pack.id = `document-${pack.plan.id}`;
  pack.plan.events.push(createEvent({ id: 'walk', title: '숲 걷기' }));
  pack.originalPlan = structuredClone(pack.plan);
  await savePack(pack);
  return pack;
}
it('restores every v3 field and activity by plan alias without creating a record', async () => {
  const pack = await outing();
  await saveAiFormDraft(`memory:${pack.plan.id}`, legacy);
  await closeStorage();
  const drafts = await restoreRecordDrafts(await listPacks());
  expect(drafts.get(`legacy:${pack.id}`)).toMatchObject({
    title: legacy.title,
    note: legacy.note,
    date: legacy.occurredOn,
    time: legacy.time,
    place: legacy.placeName,
    outcome: legacy.outcome,
    connection: {
      packId: pack.id,
      revision: pack.revision,
      eventId: 'walk',
      eventTitle: '숲 걷기',
    },
  });
  expect((await loadPack(pack.id))?.experiences).toEqual([]);
  expect(await loadAiFormDraft(`memory:${pack.plan.id}`)).toEqual(legacy);
});
it('AI answers use a separate key and cannot replace the legacy original', async () => {
  const pack = await outing();
  await saveAiFormDraft(`memory:${pack.id}`, legacy);
  await saveAiFormDraft(memoryAnswerDraftKey(pack.id), {
    requestId: 'request',
    experienceId: 'memory',
    note: 'AI reply',
  });
  const drafts = await restoreRecordDrafts(await listPacks());
  expect(drafts.get(`legacy:${pack.id}`)?.note).toBe(legacy.note);
  expect(await loadAiFormDraft(`memory:${pack.id}`)).toEqual(legacy);
});
it('does not import an old AI reply envelope as record input', async () => {
  const pack = await outing();
  await saveAiFormDraft(`memory:${pack.id}`, {
    requestId: 'request',
    experienceId: 'memory',
    note: 'partial answer',
  });
  expect(await restoreRecordDrafts(await listPacks())).toEqual(new Map());
});
it('keeps latest new text and edit identity/revision through restart', async () => {
  const pack = await saveExperience(record);
  const row = collectRecords([{ pack }])[0]!;
  const initial = { ...emptyRecordDraft(), title: 'First', note: 'unfinished' };
  const last = {
    ...initial,
    title: 'Latest',
    date: '2026-10-01',
    time: '16:00',
    place: 'Cafe',
    outcome: 'skipped' as const,
  };
  await Promise.all([
    persistRecordDraft('new', initial),
    persistRecordDraft('new', last),
    persistRecordDraft(editDraftKey(row), { ...last, original: row }),
  ]);
  await closeStorage();
  const drafts = await restoreRecordDrafts(await listPacks());
  expect(drafts.get('new')).toEqual(last);
  expect(drafts.get(editDraftKey(row))?.original).toEqual(row);
  expect((await loadPack(pack.id))?.experiences[0]?.note).toBe('original');
});
it('intentional save consumes legacy draft atomically and restart never imports it again', async () => {
  const pack = await outing();
  await saveAiFormDraft(`memory:${pack.id}`, legacy);
  const key = `legacy:${pack.id}`;
  await restoreRecordDrafts(await listPacks());
  await saveExperience(
    { ...record, title: legacy.title, note: legacy.note, eventId: legacy.eventId },
    { packId: pack.id, expectedRevision: pack.revision, recordDraftKey: key },
  );
  await closeStorage();
  expect((await restoreRecordDrafts(await listPacks())).has(key)).toBe(false);
  expect((await loadPack(pack.id))?.experiences[0]).toMatchObject({
    title: legacy.title,
    note: legacy.note,
    eventId: legacy.eventId,
  });
  expect(await loadAiFormDraft(`memory:${pack.id}`)).toEqual(legacy);
});
it('stale restored edits cannot overwrite records or consume the draft', async () => {
  const pack = await saveExperience(record);
  const row = collectRecords([{ pack }])[0]!;
  const key = editDraftKey(row);
  await persistRecordDraft(key, { ...emptyRecordDraft(), original: row, note: 'draft words' });
  await saveExperience(
    { ...record, note: 'elsewhere' },
    { packId: pack.id, expectedRevision: pack.revision },
  );
  await closeStorage();
  const restored = (await restoreRecordDrafts(await listPacks())).get(key)!;
  await expect(
    saveExperience(
      { ...record, note: restored.note },
      { packId: pack.id, expectedRevision: restored.original!.pack.revision, recordDraftKey: key },
    ),
  ).rejects.toThrow('revision-conflict');
  expect((await loadPack(pack.id))?.experiences[0]?.note).toBe('elsewhere');
  expect((await restoreRecordDrafts(await listPacks())).get(key)?.note).toBe('draft words');
});
it('failed draft consumption rolls back the record and retains input for retry', async () => {
  const draft = { ...emptyRecordDraft(), title: 'unsaved' };
  await persistRecordDraft('new', draft);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (this.name === 'meta' && key === 'record-form:new' && value === null)
      throw new DOMException('Disk full', 'QuotaExceededError');
    return put.call(this, value, key);
  });
  await expect(saveExperience(record, { recordDraftKey: 'new' })).rejects.toThrow('Disk full');
  expect(await listPacks()).toEqual([]);
  expect((await listRecordFormDrafts()).get('new')).toEqual(draft);
});
