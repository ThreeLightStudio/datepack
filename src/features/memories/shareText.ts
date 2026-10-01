import type { Experience } from '@datepack/core';

/** Build an ephemeral, text-only share from exactly the records the user picked. */
export function buildExperienceShareText(
  experiences: Experience[],
  selectedIds: Set<string>,
  noteIds: Set<string>,
  locale: 'ko' | 'en',
): string {
  const selected = experiences.filter((experience) => selectedIds.has(experience.id));
  return selected
    .map((experience) => {
      const outcome =
        locale === 'ko'
          ? { completed: '방문', skipped: '건너뜀', note: '순간' }[experience.outcome]
          : { completed: 'Visited', skipped: 'Skipped', note: 'Moment' }[experience.outcome];
      const date = experience.occurredOn
        ? new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
            dateStyle: 'medium',
          }).format(new Date(`${experience.occurredOn}T12:00:00`))
        : locale === 'ko'
          ? '날짜 미상'
          : 'Date unknown';
      const time =
        experience.timing?.kind === 'exact'
          ? ` · ${experience.timing.at.time}`
          : locale === 'ko'
            ? ' · 방문 시각 미상'
            : ' · time not recorded';
      const place = experience.placeSnapshot?.name ? ` · ${experience.placeSnapshot.name}` : '';
      const lines = [`${outcome}: ${experience.title ?? ''}${place} · ${date}${time}`];
      const note = experience.editedNote?.trim() || experience.note?.trim();
      if (noteIds.has(experience.id) && note) {
        lines.push(note);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}
