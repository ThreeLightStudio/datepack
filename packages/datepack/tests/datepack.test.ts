import { describe, expect, it } from 'vitest';
import { createDatePack, createEvent } from '../src/create';
import { readDatePack as readAnyDatePack, DatePackReadError } from '../src/read';
import { writeDatePack } from '../src/write';
import { validateDatePack, validatePlan } from '../src/validate';
import type { OutingDatePack, DatePackAsset } from '../src/types';
import { assetPath } from '../src/assets';

function makePack(): { pack: OutingDatePack; blob: Blob } {
  const pack = createDatePack({ title: '테스트 데이트', date: '2026-09-28' });
  pack.plan.events.push(
    createEvent({
      id: 'event-a',
      title: '성심당 본점',
      start: '10:00',
      end: '11:20',
      type: 'cafe',
    }),
    createEvent({
      id: 'event-b',
      title: '디아로마',
      start: '12:45',
      type: 'cafe',
      travelMinutes: 9,
    }),
  );
  const asset: DatePackAsset = {
    id: 'asset-1',
    filename: 'cafe.png',
    mimeType: 'image/png',
    path: assetPath('cafe.png'),
  };
  pack.assets.push(asset);
  pack.plan.events[0].assetIds = [asset.id];
  pack.plan.coverAssetId = asset.id;

  // 1×1 transparent PNG
  const bytes = Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
  return { pack, blob };
}

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('write → read roundtrip', () => {
  it('preserves plan, manifest, assets and blobs', async () => {
    const { pack, blob } = makePack();

    const written = await writeDatePack(pack, () => Promise.resolve(blob));
    expect(written.filename).toBe('datepack-2026-09-28.datepack.json');
    expect(written.missingAssetIds).toHaveLength(0);

    const read = await readDatePack(written.blob);
    expect(read.warnings).toHaveLength(0);
    expect(read.pack.plan.events.map((event) => event.timing)).toEqual(
      pack.plan.events.map((event) => event.timing),
    );
    expect(read.pack.plan.title).toBe(pack.plan.title);
    expect(read.pack.manifest.format).toBe('datepack');
    expect(read.pack.manifest.version).toBe('4.0');
    expect(read.pack.assets).toHaveLength(1);
    expect(read.pack.assets[0]).toMatchObject({ id: 'asset-1', mimeType: 'image/png' });

    const restored = read.blobs.get('asset-1');
    expect(restored).toBeDefined();
    expect(restored!.type).toBe('image/png');
    expect(restored!.size).toBe(blob.size);
  });

  it('round-trips a memory photo and keeps the event snapshot after its plan item is removed', async () => {
    const { pack, blob } = makePack();
    pack.experiences.push({
      id: 'memory-after-the-date',
      eventId: 'event-a',
      title: 'Found a quiet corner',
      placeSnapshot: { name: 'Old Cafe', mapQuery: 'Old Cafe Seoul' },
      outcome: 'completed',
      occurredOn: '2026-09-25',
      timing: { kind: 'exact', at: { dayOffset: 0, time: '14:20' } },
      recordedAt: '2026-09-29T09:15:00.000Z',
      note: 'We stayed until sunset.',
      assetIds: ['asset-1'],
    });
    pack.plan.events = pack.plan.events.filter((event) => event.id !== 'event-a');

    const written = await writeDatePack(pack, () => Promise.resolve(blob));
    const read = await readDatePack(written.blob);

    expect(read.pack.experiences[0]).toMatchObject({
      eventId: 'event-a',
      placeSnapshot: { name: 'Old Cafe', mapQuery: 'Old Cafe Seoul' },
      occurredOn: '2026-09-25',
      recordedAt: '2026-09-29T09:15:00.000Z',
      note: 'We stayed until sunset.',
      assetIds: ['asset-1'],
    });
    expect(read.pack.plan.events.some((event) => event.id === 'event-a')).toBe(false);
    expect(read.blobs.get('asset-1')?.size).toBe(blob.size);
  });

  it('reports missing blobs instead of failing', async () => {
    const { pack } = makePack();
    expect(validateDatePack(pack).ok).toBe(true);
    const written = await writeDatePack(pack, () => Promise.resolve(null));
    expect(written.missingAssetIds).toEqual(['asset-1']);
    // The file is still valid and readable; the asset registry stays without data.
    const read = await readDatePack(written.blob);
    expect(read.blobs.size).toBe(0);
  });

  it('rejects files that are not DatePacks', async () => {
    const notADatePack = new Blob(['hello world'], { type: 'text/plain' });
    await expect(readDatePack(notADatePack)).rejects.toBeInstanceOf(DatePackReadError);

    const validJson = new Blob([JSON.stringify({ hello: 'world' })], { type: 'application/json' });
    await expect(readDatePack(validJson)).rejects.toThrow(/format/);

    const written = await writeDatePack(makePack().pack, () => Promise.resolve(null));
    await expect(readDatePack(written.blob)).resolves.toBeDefined();
  });

  it('preserves unknown future versions without interpreting them', async () => {
    const fakeV3 = new Blob(
      [JSON.stringify({ format: 'datepack', version: '4.0', plan: makePack().pack.plan })],
      { type: 'application/json' },
    );
    const error = await readDatePack(fakeV3).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DatePackReadError);
    if (error instanceof DatePackReadError) expect(error.originalFile).toBe(fakeV3);
  });

  it('preserves newer minor versions of known majors', async () => {
    const { pack } = makePack();
    const doc = { format: 'datepack', version: '2.1', plan: pack.plan, assets: [] };
    const future = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    const error = await readDatePack(future).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DatePackReadError);
    if (error instanceof DatePackReadError) expect(error.originalFile).toBe(future);
  });

  it('rejects legacy v1 ZIP and v2/v3 JSON files without converting them', async () => {
    await expect(readDatePack(await legacyZip())).rejects.toBeInstanceOf(DatePackReadError);
    for (const version of ['2.0', '3.0']) {
      const file = new Blob([
        JSON.stringify({ format: 'datepack', version, plan: makePack().pack.plan, assets: [] }),
      ]);
      await expect(readDatePack(file)).rejects.toBeInstanceOf(DatePackReadError);
    }
  });

  it('keeps invalid legacy input available when conversion is blocked', async () => {
    const file = new Blob([
      JSON.stringify({
        format: 'datepack',
        version: '2.0',
        plan: {
          id: 'legacy',
          title: 'Broken reference',
          date: '2026-09-28',
          events: [
            {
              id: 'event-a',
              title: 'Cafe',
              type: 'cafe',
              start: '10:00',
              placeId: 'missing-place',
            },
          ],
          places: [],
        },
        assets: [],
      }),
    ]);
    const error = await readDatePack(file).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DatePackReadError);
    if (error instanceof DatePackReadError) expect(error.originalFile).toBe(file);
  });
});

async function legacyZip(): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const { pack, blob } = makePack();
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ ...pack.manifest, version: '1.0' }));
  const { events, ...plan } = pack.plan;
  zip.file(
    'plan.json',
    JSON.stringify({
      ...plan,
      events: events.map(
        ({ timing: _timing, order: _order, protectedFields: _protection, ...event }) => event,
      ),
    }),
  );
  zip.file('assets.json', JSON.stringify(pack.assets));
  zip.file('assets/cafe.png', await blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

describe('validation', () => {
  it('accepts the generated pack', () => {
    const { pack } = makePack();
    expect(validateDatePack(pack).ok).toBe(true);
    expect(validatePlan(pack.plan).ok).toBe(true);
  });

  it('flags bad dates, times and types with keyed (localizable) errors', () => {
    const result = validatePlan({
      id: 'p1',
      title: '',
      date: '2026-13-40',
      events: [
        { id: 'e1', title: 'x', start: '25:00', type: 'yoga' },
        { id: 'e1', title: 'y', start: '10:00', end: '9:99', type: 'cafe' },
      ],
    });
    expect(result.ok).toBe(false);
    const keys = result.errors.map((e) => e.key);
    expect(keys).toContain('err.plan.noTitle');
    expect(keys).toContain('err.plan.badDate');
    expect(keys).toContain('err.plan.dupId');
    expect(keys).toContain('err.plan.startInvalid');
    expect(keys).toContain('err.plan.endInvalid');
    expect(keys).toContain('err.plan.typeInvalid');
  });

  it('treats a missing event.type as an error (it would crash type-driven rendering)', () => {
    const result = validatePlan({
      id: 'p1',
      title: 'x',
      date: '2026-09-28',
      events: [{ id: 'e1', title: 'y', start: '10:00' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ key: 'err.plan.typeRequired', params: { index: 0 } });
  });

  it('rejects asset references without a registry entry', () => {
    const { pack } = makePack();
    pack.assets = [];
    const result = validateDatePack(pack);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({
      key: 'err.plan.brokenReference',
      params: { id: 'asset-1' },
    });
  });
});

async function readDatePack(file: Blob) {
  const result = await readAnyDatePack(file);
  if (result.pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return { ...result, pack: result.pack };
}
