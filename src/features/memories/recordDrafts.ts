import type { DatePack, Experience } from '@datepack/core';
import {
  listRecordFormDrafts,
  loadAiFormDraft,
  saveRecordFormDraft,
} from '../../storage/indexedDb';
import { recordKey, type RecordSummary } from './recordLibrary';

export type RecordDraft = {
  original?: RecordSummary;
  connection?: {
    packId: string;
    revision: number;
    title: string;
    eventId?: string;
    eventTitle?: string;
  };
  title: string;
  note: string;
  date: string;
  time: string;
  place: string;
  outcome: Experience['outcome'];
  assetIds: string[];
};
export const emptyRecordDraft = (): RecordDraft => ({
  title: '',
  note: '',
  date: '',
  time: '',
  place: '',
  outcome: 'note',
  assetIds: [],
});
export const editDraftKey = (row: RecordSummary): string => `edit:${recordKey(row)}`;
export const hasRecordInput = (draft: RecordDraft): boolean =>
  !!(
    draft.title ||
    draft.note ||
    draft.date ||
    draft.time ||
    draft.place ||
    draft.connection ||
    draft.assetIds.length ||
    draft.outcome !== 'note'
  );

// Keep writes ordered, including the flush before a record transaction consumes the draft.
let writes: Promise<void> = Promise.resolve();
export function persistRecordDraft(key: string, draft: RecordDraft): Promise<void> {
  const snapshot = structuredClone(draft);
  const next = writes.catch(() => {}).then(() => saveRecordFormDraft(key, snapshot));
  writes = next;
  return next;
}
export async function flushRecordDrafts(): Promise<void> {
  await writes;
}

/** Import v3 input once, by storage document identity (plan ID may be different). */
export async function restoreRecordDrafts(
  documents: Array<{ pack: DatePack }>,
): Promise<Map<string, RecordDraft>> {
  await writes.catch(() => {});
  const stored = await listRecordFormDrafts();
  await Promise.all(
    documents.map(async ({ pack }) => {
      if (pack.kind !== 'outing') return;
      const key = `legacy:${pack.id}`;
      if (stored.has(key)) return;
      const aliases = [...new Set([pack.id, pack.plan.id])];
      for (const id of aliases) {
        const value = await loadAiFormDraft(`memory:${id}`);
        if (!value || typeof value !== 'object' || !('title' in value) || 'requestId' in value)
          continue;
        const legacy = value as Record<string, unknown>;
        const text = (field: string) =>
          typeof legacy[field] === 'string' ? (legacy[field] as string) : '';
        const event = pack.plan.events.find((item) => item.id === text('eventId'));
        const draft: RecordDraft = {
          ...emptyRecordDraft(),
          title: text('title'),
          note: text('note'),
          date: text('occurredOn'),
          time: text('time'),
          place: text('placeName'),
          outcome: ['completed', 'skipped', 'note'].includes(text('outcome'))
            ? (text('outcome') as Experience['outcome'])
            : 'note',
        };
        if (!hasRecordInput(draft) && !text('eventId')) continue;
        draft.connection = {
          packId: pack.id,
          revision: pack.revision,
          title: pack.plan.title,
          ...(text('eventId')
            ? { eventId: text('eventId'), eventTitle: event?.title ?? text('eventId') }
            : {}),
        };
        await persistRecordDraft(key, draft);
        stored.set(key, draft);
        break;
      }
    }),
  );
  return new Map(
    [...stored].flatMap(([key, value]) =>
      value && typeof value === 'object' && 'title' in value && 'assetIds' in value
        ? [[key, value as RecordDraft]]
        : [],
    ),
  );
}
