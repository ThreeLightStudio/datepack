import JSZip from 'jszip';
import type { DatePack } from './types';
import { DATEPACK_ENTRY } from './schema';
import { ASSETS_DIR } from './assets';

export type WriteResult = {
  blob: Blob;
  filename: string;
  /** Assets whose blob could not be loaded (skipped from the ZIP). */
  missingAssetIds: string[];
};

export type BlobLoader = (
  assetId: string,
) => Blob | null | undefined | Promise<Blob | null | undefined>;

/**
 * Build the .datepack ZIP (manifest.json + plan.json + assets.json + assets/*).
 * Runs fully in the browser.
 */
export async function writeDatePack(pack: DatePack, loadBlob: BlobLoader): Promise<WriteResult> {
  const zip = new JSZip();
  const now = new Date().toISOString();

  zip.file(
    'manifest.json',
    JSON.stringify({ ...pack.manifest, entry: DATEPACK_ENTRY, updatedAt: now }, null, 2),
  );
  zip.file('plan.json', JSON.stringify(pack.plan, null, 2));
  zip.file('assets.json', JSON.stringify(pack.assets, null, 2));

  const missingAssetIds: string[] = [];
  for (const asset of pack.assets) {
    const blob = await loadBlob(asset.id);
    if (!blob) {
      missingAssetIds.push(asset.id);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    zip.file(asset.path || `${ASSETS_DIR}${asset.filename}`, bytes);
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, filename: exportFilename(pack), missingAssetIds };
}

/** "classic-seoul-day-2026-09-28.datepack" style name; falls back to "datepack-<date>". */
export function exportFilename(pack: { plan: Pick<DatePack['plan'], 'title' | 'date'> }): string {
  const asciiWords = pack.plan.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('-');
  const slug = asciiWords || 'datepack';
  return `${slug}-${pack.plan.date}.datepack`;
}

/** Trigger a browser download for a generated blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
