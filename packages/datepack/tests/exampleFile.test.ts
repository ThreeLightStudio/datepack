import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { writeDatePack } from '../src/write';
import { readDatePack as readAnyDatePack } from '../src/read';

const EXAMPLE_URL = new URL(
  '../../../examples/classic-seoul-day-2026-09-28.datepack.json',
  import.meta.url,
);

describe('portable release example', () => {
  it('round-trips the title-free standalone photo example with its binary', async () => {
    const source = await readFile(
      new URL('../../../examples/independent-photos.datepack.json', import.meta.url),
      'utf8',
    );
    const result = await readAnyDatePack(new Blob([source], { type: 'application/json' }));
    expect(result.warnings).toEqual([]);
    expect(result.pack.kind).toBe('memories');
    expect(result.pack).not.toHaveProperty('plan');
    expect(result.pack).not.toHaveProperty('originalPlan');
    expect(result.pack.experiences[0]).not.toHaveProperty('title');
    const exported = await writeDatePack(result.pack, async (id) => result.blobs.get(id) ?? null);
    const restored = await readAnyDatePack(exported.blob);
    expect(restored.pack.experiences).toEqual(result.pack.experiences);
    expect(await restored.blobs.get('asset-cafe-photo')?.arrayBuffer()).toEqual(
      await result.blobs.get('asset-cafe-photo')?.arrayBuffer(),
    );
  });
  it('reads and validates the checked-in DatePack 4.0 outing file', async () => {
    const source = await readFile(EXAMPLE_URL, 'utf8');
    const wire = JSON.parse(source);
    expect(wire).not.toHaveProperty('manifest');
    expect(wire).toMatchObject({
      format: 'datepack',
      version: '4.0',
      plan: { id: 'plan-classic-seoul-day' },
      originalPlan: { id: 'plan-classic-seoul-day' },
      revision: 0,
      assets: [{ id: 'asset-cafe-photo', data: expect.stringMatching(/^data:image\/png;base64,/) }],
    });

    const result = await readDatePack(new Blob([source], { type: 'application/json' }));
    expect(result.warnings).toEqual([]);
    expect(result.pack.manifest).toMatchObject({ format: 'datepack', version: '4.0' });
    expect(result.pack.plan.events[0]?.id).toBe('event-coffee-together');
    expect(result.blobs.get('asset-cafe-photo')?.type).toBe('image/png');
    expect(wire.generator).toBe('datepack-core 0.4.0');
  });
});

async function readDatePack(file: Blob) {
  const result = await readAnyDatePack(file);
  if (result.pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return { ...result, pack: result.pack };
}
