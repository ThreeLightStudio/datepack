import type { DatePackAsset } from './types';
import { createId } from '../utils/id';

export const ASSETS_DIR = 'assets/';

export const SUPPORTED_IMAGE_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
] as const;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
};

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
};

export function isImageMime(mime: string): boolean {
  return (SUPPORTED_IMAGE_MIME as readonly string[]).includes(mime);
}

export function mimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? '';
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return cleaned || 'image';
}

export function assetPath(filename: string): string {
  return `${ASSETS_DIR}${filename}`;
}

export function makeAsset(filename: string, mimeType: string): DatePackAsset {
  return {
    id: createId('asset'),
    filename: sanitizeFilename(filename),
    mimeType,
    path: assetPath(sanitizeFilename(filename)),
    createdAt: new Date().toISOString(),
  };
}

/** Pick files (from <input type="file">) into DatePack assets + blobs. */
export async function createAssetsFromFiles(
  files: FileList | File[],
): Promise<Array<{ asset: DatePackAsset; blob: Blob }>> {
  const out: Array<{ asset: DatePackAsset; blob: Blob }> = [];
  for (const file of Array.from(files)) {
    const mime = file.type || mimeFromFilename(file.name);
    const asset = makeAsset(file.name, mime);
    out.push({ asset, blob: file });
  }
  return out;
}

/** Ensure no two assets in a pack share a filename (ZIP paths must be unique). */
export function dedupeFilename(existing: DatePackAsset[], filename: string): string {
  const taken = new Set(existing.map((a) => a.filename));
  if (!taken.has(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let i = 1;
  while (taken.has(`${base}-${i}${ext}`)) i += 1;
  return `${base}-${i}${ext}`;
}

export function registerAsset(
  pack: { assets: DatePackAsset[] },
  asset: DatePackAsset,
): DatePackAsset {
  const filename = dedupeFilename(pack.assets, asset.filename);
  const registered: DatePackAsset = { ...asset, filename, path: assetPath(filename) };
  pack.assets.push(registered);
  return registered;
}
