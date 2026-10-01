import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readDatePack as readAnyDatePack } from '../src/read';

const EXAMPLE_URL = new URL(
  '../../../examples/classic-seoul-day-2026-09-28.datepack.json',
  import.meta.url,
);

describe('portable release example', () => {
  it('reads and validates the checked-in DatePack 3.0 file', async () => {
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
  });
});

async function readDatePack(file: Blob) {
  const result = await readAnyDatePack(file);
  if (result.pack.kind !== 'outing') throw new Error('Expected outing fixture');
  return { ...result, pack: result.pack };
}
