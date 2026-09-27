import JSZip from 'jszip';
import type { DatePack, DatePackAsset } from './types';
import { parseManifest, DATEPACK_FORMAT } from './schema';
import { validateDatePack } from './validate';
import { ASSETS_DIR, mimeFromFilename } from './assets';
import type { I18nIssue } from '../i18n/core';
import { localizeAll } from '../i18n/core';

export class DatePackReadError extends Error {
  /** Structured, localizable issues — the UI renders these per locale. */
  readonly issues: I18nIssue[];

  constructor(issues: I18nIssue[]) {
    // message stays a readable Korean fallback for logs/console; the UI uses `issues`.
    super(localizeAll('ko', issues).join(' '));
    this.name = 'DatePackReadError';
    this.issues = issues;
  }
}

export type ReadResult = {
  pack: DatePack;
  /** asset id → blob */
  blobs: Map<string, Blob>;
  warnings: I18nIssue[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * .datepack.json (format 2.0) = one JSON document:
 * { format, version, createdAt, updatedAt, generator, plan, assets }
 * where each asset carries its image as a base64 "data:…" URL.
 *
 * .datepack (format 1.0, legacy) = ZIP {
 *   manifest.json   — format/version/entry
 *   plan.json       — DatePlan
 *   assets.json     — DatePackAsset[] registry (id, filename, mimeType, path)
 *   assets/<file>   — binary blobs
 * }
 * Everything is parsed in the browser; no server involved.
 */
export async function readDatePack(file: Blob): Promise<ReadResult> {
  let doc: unknown = null;
  try {
    doc = JSON.parse(await file.text());
  } catch {
    doc = null;
  }
  if (isRecord(doc)) {
    if (doc.format === DATEPACK_FORMAT) return readJsonContainer(doc);
    // Valid JSON but not a DatePack — clearer than falling through to the ZIP error.
    throw new DatePackReadError([
      { key: 'err.read.formatWrong', params: { value: String(doc.format ?? 'json') } },
    ]);
  }
  return readLegacyZip(file);
}

async function readJsonContainer(doc: Record<string, unknown>): Promise<ReadResult> {
  const manifestResult = parseManifest(doc);
  if (!manifestResult.ok) throw new DatePackReadError(manifestResult.errors);

  const planRaw = doc.plan;
  if (!isRecord(planRaw)) throw new DatePackReadError([{ key: 'err.read.noEntry' }]);

  const pack: DatePack = {
    manifest: manifestResult.manifest,
    plan: planRaw as unknown as DatePack['plan'],
    assets: [],
  };

  const blobs = new Map<string, Blob>();
  if (Array.isArray(doc.assets)) {
    for (const raw of doc.assets) {
      if (!isRecord(raw)) continue;
      const id = typeof raw.id === 'string' ? raw.id : '';
      if (!id) continue;
      const asset: DatePackAsset = {
        id,
        filename: typeof raw.filename === 'string' ? raw.filename : id,
        mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : 'application/octet-stream',
        ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
      };
      pack.assets.push(asset);
      const data = typeof raw.data === 'string' ? raw.data : '';
      if (!data.startsWith('data:')) continue; // exported without image data
      try {
        blobs.set(id, await (await fetch(data)).blob());
      } catch {
        // Undecodable data URL: keep the registry entry without a blob.
      }
    }
  }

  const validation = validateDatePack(pack);
  if (!validation.ok) {
    throw new DatePackReadError([{ key: 'err.read.invalidContent' }, ...validation.errors]);
  }

  const warnings = [...manifestResult.warnings, ...validation.warnings];
  return { pack, blobs, warnings };
}

async function readLegacyZip(file: Blob): Promise<ReadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new DatePackReadError([{ key: 'err.read.badZip' }]);
  }

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new DatePackReadError([{ key: 'err.read.noManifest' }]);
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(await manifestFile.async('string'));
  } catch {
    throw new DatePackReadError([{ key: 'err.read.badManifest' }]);
  }
  const manifestResult = parseManifest(manifestRaw);
  if (!manifestResult.ok) throw new DatePackReadError(manifestResult.errors);

  const planFile = zip.file(manifestResult.manifest.entry);
  if (!planFile) throw new DatePackReadError([{ key: 'err.read.noEntry' }]);
  let planRaw: unknown;
  try {
    planRaw = JSON.parse(await planFile.async('string'));
  } catch {
    throw new DatePackReadError([{ key: 'err.read.badPlan' }]);
  }

  const pack: DatePack = {
    manifest: manifestResult.manifest,
    plan: planRaw as DatePack['plan'],
    assets: [],
  };

  const assetsIndexFile = zip.file('assets.json');
  if (assetsIndexFile) {
    try {
      const list = JSON.parse(await assetsIndexFile.async('string')) as DatePackAsset[];
      if (Array.isArray(list)) pack.assets = list;
    } catch {
      throw new DatePackReadError([{ key: 'err.read.badAssets' }]);
    }
  }

  // Extract every file under assets/. Entries missing from the registry get
  // registered by filename so hand-made packs still open.
  const blobs = new Map<string, Blob>();
  const assetEntries = new Map<string, JSZip.JSZipObject>();
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.startsWith(ASSETS_DIR)) {
      assetEntries.set(relativePath, zipEntry);
    }
  });
  for (const [path, zipEntry] of assetEntries) {
    const bytes = await zipEntry.async('uint8array');
    const declared = pack.assets.find((a) => a.path === path);
    const mime = declared?.mimeType ?? mimeFromFilename(path);
    const assetId = declared?.id ?? path.slice(ASSETS_DIR.length);
    blobs.set(assetId, new Blob([bytes as unknown as BlobPart], { type: mime }));
    if (!declared) {
      pack.assets.push({
        id: assetId,
        filename: path.slice(ASSETS_DIR.length),
        mimeType: mime,
        path,
      });
    }
  }

  const validation = validateDatePack(pack);
  if (!validation.ok) {
    throw new DatePackReadError([{ key: 'err.read.invalidContent' }, ...validation.errors]);
  }

  const warnings = [...manifestResult.warnings, ...validation.warnings];
  return { pack, blobs, warnings };
}
