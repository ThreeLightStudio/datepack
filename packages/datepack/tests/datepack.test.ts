import { describe, expect, it } from 'vitest';
import { createDatePack, createEvent } from '../src/create';
import { readDatePack, DatePackReadError } from '../src/read';
import { writeDatePack } from '../src/write';
import { validateDatePack, validatePlan } from '../src/validate';
import type { DatePack, DatePackAsset } from '../src/types';
import { assetPath } from '../src/assets';

function makePack(): { pack: DatePack; blob: Blob } {
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
    expect(read.pack.manifest.version).toBe('3.0');
    expect(read.pack.assets).toHaveLength(1);
    expect(read.pack.assets[0]).toMatchObject({ id: 'asset-1', mimeType: 'image/png' });

    const restored = read.blobs.get('asset-1');
    expect(restored).toBeDefined();
    expect(restored!.type).toBe('image/png');
    expect(restored!.size).toBe(blob.size);
  });

  it('reports missing blobs instead of failing', async () => {
    const { pack } = makePack();
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

  it('still reads legacy v1.0 ZIP packs', async () => {
    const read = await readDatePack(await legacyZip());
    expect(read.pack.manifest.version).toBe('3.0');
    expect(read.pack.plan.title).toBe('테스트 데이트');
    expect(read.pack.assets).toHaveLength(1);
    const restored = read.blobs.get('asset-1');
    expect(restored).toBeDefined();
    expect(restored!.type).toBe('image/png');
  });

  it('converts legacy v2 JSON to a stable v3 shape', async () => {
    const { pack } = makePack();
    const doc = {
      format: 'datepack',
      version: '2.0',
      plan: {
        id: pack.plan.id,
        title: pack.plan.title,
        date: pack.plan.date,
        events: pack.plan.events.map((event) => ({
          id: event.id,
          title: event.title,
          type: event.type,
          start: event.start,
          end: event.end,
          assetIds: event.assetIds,
        })),
        places: [],
      },
      assets: [],
    };
    const file = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    const first = await readDatePack(file);
    const second = await readDatePack(file);
    expect(first.pack).toEqual(second.pack);
    expect(first.pack.manifest.version).toBe('3.0');
    expect(first.pack.plan.events[0].timing).toEqual({
      kind: 'exact',
      start: { dayOffset: 0, time: '10:00' },
      end: { dayOffset: 0, time: '11:20' },
    });
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

  it('warns about missing assets', () => {
    const { pack } = makePack();
    pack.assets = [];
    const result = validateDatePack(pack);
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toMatchObject({
      key: 'err.plan.assetMissing',
      params: { id: 'asset-1' },
    });
  });
});
