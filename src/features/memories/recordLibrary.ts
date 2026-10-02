import { isImageMime, mimeFromFilename, type DatePack, type Experience } from '@datepack/core';

export type RecordKey = { packId: string; experienceId: string };
export type RecordSummary = RecordKey & { pack: DatePack; experience: Experience };
export const recordKey = (record: RecordKey): string => `${record.packId}:${record.experienceId}`;

/** Metadata only: photo bodies are resolved by visible AssetImage instances. */
export function collectRecords(documents: Array<{ pack: DatePack }>): RecordSummary[] {
  return documents
    .flatMap(({ pack }) =>
      pack.experiences.map((experience) => ({
        packId: pack.id,
        experienceId: experience.id,
        pack,
        experience,
      })),
    )
    .sort((a, b) => b.experience.recordedAt.localeCompare(a.experience.recordedAt));
}

export function photoProblem(
  file: Pick<File, 'name' | 'type' | 'size'>,
): 'heic' | 'unsupported' | 'empty' | null {
  // Some native pickers convert HEIC to JPEG while keeping the original name.
  // The composer additionally requires a successful image decode before saving.
  if (isImageMime(file.type)) return file.size ? null : 'empty';
  if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) return 'heic';
  if (!isImageMime(file.type || mimeFromFilename(file.name))) return 'unsupported';
  return file.size ? null : 'empty';
}

/** Reordering assetIds is the portable representative-photo choice. */
export function withCover(ids: string[], coverId: string): string[] {
  return ids.includes(coverId) ? [coverId, ...ids.filter((id) => id !== coverId)] : ids;
}
