import type { DatePack, DatePlan } from './types';
import { parseManifest, DATEPACK_FORMAT, parseFormatVersion } from './schema';
import { validateDatePack } from './validate';
import { localizeIssues, type DatePackIssue } from './i18n/core';

export class DatePackReadError extends Error {
  readonly issues: DatePackIssue[];
  readonly originalFile?: Blob;
  constructor(issues: DatePackIssue[], originalFile?: Blob) {
    super(localizeIssues('ko', issues).join(' '));
    this.name = 'DatePackReadError';
    this.issues = issues;
    this.originalFile = originalFile;
  }
}
export type ReadResult = { pack: DatePack; blobs: Map<string, Blob>; warnings: DatePackIssue[] };

/** Only portable 4.0 JSON files are supported. Local conversion is a separate API. */
export async function readDatePack(file: Blob): Promise<ReadResult> {
  let doc: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(await file.text());
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
    doc = raw as Record<string, unknown>;
  } catch {
    throw new DatePackReadError([{ key: 'err.read.invalidContent' }], file);
  }
  if (doc.format !== DATEPACK_FORMAT)
    throw new DatePackReadError(
      [{ key: 'err.read.formatWrong', params: { value: String(doc.format) } }],
      file,
    );
  const version = parseFormatVersion(doc.version);
  if (version?.major !== 4 || version.minor !== 0)
    throw new DatePackReadError(
      [{ key: 'err.read.unsupportedVersion', params: { value: String(doc.version) } }],
      file,
    );
  const manifest = parseManifest(doc);
  if (!manifest.ok) throw new DatePackReadError(manifest.errors, file);
  const pack = {
    id: doc.id,
    kind: doc.kind,
    meta: doc.meta,
    manifest: manifest.manifest,
    ...('plan' in doc ? { plan: doc.plan } : {}),
    ...('originalPlan' in doc ? { originalPlan: doc.originalPlan } : {}),
    experiences: doc.experiences,
    revision: doc.revision,
    assets: doc.assets,
  } as DatePack;
  const validation = validateDatePack(pack);
  if (!validation.ok)
    throw new DatePackReadError([{ key: 'err.read.invalidContent' }, ...validation.errors], file);
  const blobs = new Map<string, Blob>();
  for (const asset of pack.assets) {
    if (asset.data === undefined) continue;
    if (typeof asset.data !== 'string' || !/^data:[^,]*;base64,/.test(asset.data))
      throw new DatePackReadError([{ key: 'err.read.badAssets' }], file);
    try {
      const blob = await (await fetch(asset.data)).blob();
      blobs.set(asset.id, blob);
    } catch {
      throw new DatePackReadError([{ key: 'err.read.badAssets' }], file);
    }
    delete asset.data;
  }
  if (pack.kind === 'outing') {
    pack.plan = withCompatibilityAliases(pack.plan);
    pack.originalPlan = withCompatibilityAliases(pack.originalPlan);
  }
  return { pack, blobs, warnings: [...manifest.warnings, ...validation.warnings] };
}

function withCompatibilityAliases(plan: DatePlan): DatePlan {
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
      ...(['time', 'place', 'content', 'delete', 'order'].every((field) =>
        event.protectedFields?.includes(field as NonNullable<typeof event.protectedFields>[number]),
      )
        ? { fixed: true }
        : {}),
      ...(event.placeId && travelByPlace.get(event.placeId) !== undefined
        ? { travelMinutes: travelByPlace.get(event.placeId) }
        : {}),
    })),
  };
}
