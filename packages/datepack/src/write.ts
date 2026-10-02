import type { DatePack, DatePlan } from './types';
import { DATEPACK_FORMAT, DATEPACK_FORMAT_VERSION, PACKAGE_VERSION } from './schema';
import { validateDatePack } from './validate';
import type { DatePackIssue } from './i18n/core';

export class DatePackWriteError extends Error {
  readonly issues: DatePackIssue[];

  constructor(issues: DatePackIssue[]) {
    super(`Invalid DatePack: ${issues.map((issue) => issue.key).join(', ')}`);
    this.name = 'DatePackWriteError';
    this.issues = issues;
  }
}

export type WriteResult = {
  blob: Blob;
  filename: string;
  /** Assets whose blob could not be loaded (kept as registry entries without image data). */
  missingAssetIds: string[];
};

export type BlobLoader = (
  assetId: string,
) => Blob | null | undefined | Promise<Blob | null | undefined>;

const BASE64_CHUNK = 0x8000;

/** Blob → "data:<mime>;base64,…" (chunked btoa to stay under argument limits). */
async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  const mime = blob.type || fallbackMime || 'application/octet-stream';
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Build the .datepack.json file (format 4.0) — one portable JSON document.
 * Each asset carries its image inline as a base64 data URL. Runs fully in the
 * browser.
 */
export async function writeDatePack(pack: DatePack, loadBlob: BlobLoader): Promise<WriteResult> {
  const validation = validateDatePack(pack);
  if (!validation.ok) throw new DatePackWriteError(validation.errors);
  const now = new Date().toISOString();
  const missingAssetIds: string[] = [];

  const assets = [];
  for (const asset of pack.assets) {
    const base = {
      id: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      createdAt: asset.createdAt,
    };
    const blob = await loadBlob(asset.id);
    if (!blob) {
      missingAssetIds.push(asset.id);
      assets.push(base);
      continue;
    }
    assets.push({ ...base, data: await blobToDataUrl(blob, asset.mimeType) });
  }

  const doc = {
    format: DATEPACK_FORMAT,
    version: DATEPACK_FORMAT_VERSION,
    createdAt: pack.manifest.createdAt ?? now,
    updatedAt: pack.manifest.updatedAt ?? now,
    generator: pack.manifest.generator ?? `datepack-web ${PACKAGE_VERSION}`,
    id: pack.id,
    kind: pack.kind,
    meta: pack.meta,
    ...(pack.kind === 'outing'
      ? { plan: serializablePlan(pack.plan), originalPlan: serializablePlan(pack.originalPlan) }
      : {}),
    experiences: pack.experiences,
    revision: pack.revision,
    assets,
  };

  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  return { blob, filename: exportFilename(pack), missingAssetIds };
}

/** Drop in-memory v1/v2 compatibility aliases before they reach the portable file. */
function serializablePlan(plan: DatePlan): DatePlan {
  return {
    ...plan,
    events: plan.events.map((event) => {
      const {
        start: _start,
        end: _end,
        fixed: _fixed,
        travelMinutes: _travel,
        ...portableEvent
      } = event;
      return portableEvent;
    }),
  };
}

/** "classic-seoul-day-2026-09-28.datepack.json" style name; falls back to "datepack-<date>". */
export function exportFilename(
  pack: DatePack | { plan: Pick<DatePlan, 'title' | 'date'> },
): string {
  const title = pack.plan?.title ?? ('meta' in pack ? pack.meta.title : undefined) ?? 'memories';
  const asciiWords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('-');
  const slug = asciiWords || 'datepack';
  return `${slug}-${pack.plan?.date ?? 'undated'}.datepack.json`;
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

/** Stable content comparison across file round trips and runtime compatibility aliases. */
export function datePackContentKey(pack: DatePack): string {
  const value = {
    ...pack,
    ...(pack.kind === 'outing'
      ? { plan: serializablePlan(pack.plan), originalPlan: serializablePlan(pack.originalPlan) }
      : {}),
    assets: pack.assets.map(({ path: _path, data: _data, ...asset }) => asset),
  };
  function sorted(raw: unknown): unknown {
    if (Array.isArray(raw)) return raw.map(sorted);
    if (raw && typeof raw === 'object')
      return Object.fromEntries(
        Object.entries(raw)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, sorted(item)]),
      );
    return raw;
  }
  return JSON.stringify(sorted(value));
}
