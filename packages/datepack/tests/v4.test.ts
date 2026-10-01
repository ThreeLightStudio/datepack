import { describe, expect, it } from 'vitest';
import { createDatePack, createMemoriesPack } from '../src/create';
import { readDatePack } from '../src/read';
import { writeDatePack, datePackContentKey } from '../src/write';
import { validateDatePack } from '../src/validate';
import type { Experience } from '../src/types';

const photo = { id: 'photo', filename: 'photo.jpg', mimeType: 'image/jpeg' };
const record: Experience = {
  id: 'moment',
  outcome: 'note',
  recordedAt: '2026-10-01T03:00:00Z',
  occurredOn: '2026-09-25',
  assetIds: [photo.id],
};

describe('DatePack 4.0 portable documents', () => {
  it.each(['outing', 'memories'] as const)(
    'round trips %s including titleless photos, original text, experience date and binary bytes',
    async (kind) => {
      const pack =
        kind === 'outing'
          ? createDatePack({ title: 'Walk' })
          : createMemoriesPack([record], [photo]);
      if (kind === 'outing') {
        pack.experiences = [record];
        pack.assets = [photo];
      }
      pack.id = 'document-distinct-from-plan';
      pack.experiences[0] = {
        ...pack.experiences[0],
        note: 'Exact original\nSecond line',
        editedNote: 'Reviewed text',
      };
      const bytes = new Blob([new Uint8Array([0, 255, 1, 42])], { type: photo.mimeType });
      const written = await writeDatePack(pack, () => bytes);
      const wire = JSON.parse(await written.blob.text());
      expect(wire).toMatchObject({ id: pack.id, kind, version: '4.0', meta: pack.meta });
      expect(wire).not.toHaveProperty('baselinePlan');
      if (kind === 'memories') {
        expect(wire).not.toHaveProperty('plan');
        expect(wire).not.toHaveProperty('originalPlan');
      }
      const restored = await readDatePack(written.blob);
      expect(restored.pack.experiences).toEqual(pack.experiences);
      expect(restored.pack.experiences[0].title).toBeUndefined();
      expect(datePackContentKey(restored.pack)).toBe(datePackContentKey(pack));
      expect(new Uint8Array(await restored.blobs.get(photo.id)!.arrayBuffer())).toEqual(
        new Uint8Array(await bytes.arrayBuffer()),
      );
    },
  );

  it('accepts meaningful text without photos and rejects empty records or an empty collection', () => {
    expect(
      validateDatePack(createMemoriesPack([{ ...record, assetIds: [], note: 'A note' }])).ok,
    ).toBe(true);
    expect(
      validateDatePack(createMemoriesPack([{ ...record, assetIds: [], title: 'A title' }])).ok,
    ).toBe(true);
    expect(
      validateDatePack(createMemoriesPack([{ ...record, assetIds: [], note: '  ', title: '\n' }]))
        .ok,
    ).toBe(false);
    expect(validateDatePack(createMemoriesPack([])).ok).toBe(false);
  });

  it('rejects a plan wrapper and activity connection in standalone documents', () => {
    const memories = createMemoriesPack([record], [photo]);
    expect(validateDatePack({ ...memories, plan: createDatePack({ title: 'Fake' }).plan }).ok).toBe(
      false,
    );
    expect(
      validateDatePack({ ...memories, experiences: [{ ...record, eventId: 'invented' }] }).ok,
    ).toBe(false);
  });

  it.each(['1.0', '2.0', '3.0', '4.1', '5.0'])(
    'rejects unsupported %s files and retains original bytes',
    async (version) => {
      const file = new Blob([
        JSON.stringify({
          format: 'datepack',
          version,
          plan: createDatePack({ title: 'Old' }).plan,
        }),
      ]);
      const error = await readDatePack(file).catch((cause) => cause);
      expect(error.originalFile).toBe(file);
      expect(error.issues[0].key).toBe('err.read.unsupportedVersion');
    },
  );

  it('rejects malformed document collections without throwing from validation', () => {
    const pack = createDatePack({ title: 'Malformed' });
    for (const value of [
      null,
      {},
      { ...pack, assets: null },
      { ...pack, experiences: {} },
      { ...pack, meta: null },
      { ...pack, plan: { ...pack.plan, events: [null] } },
    ])
      expect(validateDatePack(value).ok).toBe(false);
  });
});
