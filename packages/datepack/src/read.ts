import JSZip from 'jszip';
import type { DatePack, DatePackAsset, LegacyDatePack } from './types';
import { parseManifest, DATEPACK_FORMAT, parseFormatVersion } from './schema';
import { validateDatePack, validatePlan } from './validate';
import { ASSETS_DIR, mimeFromFilename } from './assets';
import { localizeIssues, type DatePackIssue } from './i18n/core';
import { isLegacyDatePlan, isV3DatePlan, migrateLegacyDatePack } from './migration';

export class DatePackReadError extends Error {
  /** Structured, localizable issues — the UI renders these per locale. */
  readonly issues: DatePackIssue[];
  /** Original bytes remain available for unsupported future formats and safe re-export. */
  readonly originalFile?: Blob;

  constructor(issues: DatePackIssue[], originalFile?: Blob) {
    // message stays a readable Korean fallback for logs/console; the UI uses `issues`.
    super(localizeIssues('ko', issues).join(' '));
    this.name = 'DatePackReadError';
    this.issues = issues;
    this.originalFile = originalFile;
  }
}

export type ReadResult = {
  pack: DatePack;
  /** asset id → blob */
  blobs: Map<string, Blob>;
  warnings: DatePackIssue[];
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
    if (doc.format === DATEPACK_FORMAT) return readJsonContainer(doc, file);
    // Valid JSON but not a DatePack — clearer than falling through to the ZIP error.
    throw new DatePackReadError([
      { key: 'err.read.formatWrong', params: { value: String(doc.format ?? 'json') } },
    ]);
  }
  return readLegacyZip(file);
}

async function readJsonContainer(
  doc: Record<string, unknown>,
  originalFile: Blob,
): Promise<ReadResult> {
  const version = parseFormatVersion(doc.version);
  if (isUnsupportedFutureVersion(version)) throw unsupportedVersionError(version!, originalFile);
  const manifestResult = parseManifest(doc);
  if (!manifestResult.ok) throw new DatePackReadError(manifestResult.errors);

  const planRaw = doc.plan;
  if (!isRecord(planRaw)) throw new DatePackReadError([{ key: 'err.read.noEntry' }]);

  const assetList: DatePackAsset[] = [];

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
      assetList.push(asset);
      const data = typeof raw.data === 'string' ? raw.data : '';
      if (!data.startsWith('data:')) continue; // exported without image data
      try {
        blobs.set(id, await (await fetch(data)).blob());
      } catch {
        // Undecodable data URL: keep the registry entry without a blob.
      }
    }
  }

  let pack: DatePack;
  if (
    version?.major === 3 &&
    isV3DatePlan(planRaw) &&
    isV3DatePlan(doc.baselinePlan) &&
    Array.isArray(doc.experiences) &&
    typeof doc.revision === 'number' &&
    Number.isSafeInteger(doc.revision) &&
    doc.revision >= 0
  ) {
    pack = {
      manifest: manifestResult.manifest,
      plan: withCompatibilityAliases(planRaw),
      baselinePlan: withCompatibilityAliases(doc.baselinePlan),
      experiences: doc.experiences as DatePack['experiences'],
      revision: doc.revision,
      assets: assetList,
    };
  } else if ((version?.major === 1 || version?.major === 2) && isLegacyDatePlan(planRaw)) {
    const legacyValidation = validatePlan(planRaw);
    if (!legacyValidation.ok)
      throw new DatePackReadError(
        [{ key: 'err.read.invalidContent' }, ...legacyValidation.errors],
        originalFile,
      );
    const migrated = migrateLegacyDatePack({
      manifest: manifestResult.manifest,
      plan: planRaw,
      assets: assetList,
    } as LegacyDatePack);
    pack = migrated.pack;
  } else {
    throw new DatePackReadError([{ key: 'err.read.invalidContent' }], originalFile);
  }

  const validation = validateDatePack(pack);
  if (!validation.ok) {
    throw new DatePackReadError(
      [{ key: 'err.read.invalidContent' }, ...validation.errors],
      originalFile,
    );
  }

  const warnings = [...manifestResult.warnings, ...validation.warnings];
  return { pack, blobs, warnings };
}

function withCompatibilityAliases(plan: DatePack['plan']): DatePack['plan'] {
  const travelByPlace = new Map(
    (plan.sharedTravel ?? [])
      .filter((t) => t.toPlaceId)
      .map((t) => [t.toPlaceId!, t.estimatedMinutes]),
  );
  return {
    ...plan,
    events: plan.events.map((event) => ({
      ...event,
      ...(event.timing.kind === 'exact'
        ? {
            start: event.timing.start.time,
            ...(event.timing.end ? { end: event.timing.end.time } : {}),
          }
        : {}),
      ...(hasFullProtection(event) ? { fixed: true } : {}),
      ...(event.placeId && travelByPlace.get(event.placeId) !== undefined
        ? { travelMinutes: travelByPlace.get(event.placeId) }
        : {}),
    })),
  };
}

function hasFullProtection(event: DatePack['plan']['events'][number]): boolean {
  return ['time', 'place', 'content', 'delete', 'order'].every((field) =>
    event.protectedFields?.includes(field as NonNullable<typeof event.protectedFields>[number]),
  );
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
  const legacyVersion =
    isRecord(manifestRaw) && typeof manifestRaw.version !== 'undefined'
      ? parseFormatVersion(manifestRaw.version)
      : null;
  if (isUnsupportedFutureVersion(legacyVersion))
    throw unsupportedVersionError(legacyVersion!, file);
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

  const legacyPack = {
    manifest: manifestResult.manifest,
    plan: planRaw as DatePack['plan'],
    assets: [] as DatePackAsset[],
  };

  const assetsIndexFile = zip.file('assets.json');
  if (assetsIndexFile) {
    try {
      const list = JSON.parse(await assetsIndexFile.async('string')) as DatePackAsset[];
      if (Array.isArray(list)) legacyPack.assets = list;
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
    const declared = legacyPack.assets.find((a) => a.path === path);
    const mime = declared?.mimeType ?? mimeFromFilename(path);
    const assetId = declared?.id ?? path.slice(ASSETS_DIR.length);
    blobs.set(assetId, new Blob([bytes as unknown as BlobPart], { type: mime }));
    if (!declared) {
      legacyPack.assets.push({
        id: assetId,
        filename: path.slice(ASSETS_DIR.length),
        mimeType: mime,
        path,
      });
    }
  }

  if (!isLegacyDatePlan(legacyPack.plan))
    throw new DatePackReadError([{ key: 'err.read.invalidContent' }]);
  const legacyValidation = validatePlan(legacyPack.plan);
  if (!legacyValidation.ok)
    throw new DatePackReadError(
      [{ key: 'err.read.invalidContent' }, ...legacyValidation.errors],
      file,
    );
  const pack = migrateLegacyDatePack(legacyPack as LegacyDatePack).pack;
  const validation = validateDatePack(pack);
  if (!validation.ok) {
    throw new DatePackReadError([{ key: 'err.read.invalidContent' }, ...validation.errors], file);
  }

  const warnings = [...manifestResult.warnings, ...validation.warnings];
  return { pack, blobs, warnings };
}

function isUnsupportedFutureVersion(version: ReturnType<typeof parseFormatVersion>): boolean {
  return (
    !!version && (version.major > 3 || ([1, 2, 3].includes(version.major) && version.minor > 0))
  );
}

function unsupportedVersionError(
  version: NonNullable<ReturnType<typeof parseFormatVersion>>,
  file: Blob,
): DatePackReadError {
  return new DatePackReadError(
    [{ key: 'err.read.unsupportedVersion', params: { value: version.raw } }],
    file,
  );
}
