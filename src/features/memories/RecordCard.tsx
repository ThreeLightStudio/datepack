import { AssetImage } from '../../components/AssetImage';
import { formatDate, useLocale } from '../../i18n';
import { recordKey, type RecordSummary } from './recordLibrary';

export function RecordCard({ record, onOpen }: { record: RecordSummary; onOpen: () => void }) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const { experience, pack } = record;
  const date = experience.occurredOn
    ? formatDate(locale, experience.occurredOn)
    : new Date(experience.recordedAt).toLocaleDateString(ko ? 'ko-KR' : 'en-US');
  return (
    <button
      type="button"
      className="record-card"
      data-record-key={recordKey(record)}
      onClick={onOpen}
      aria-label={
        ko ? `${experience.title || date} 기록 열기` : `Open memory ${experience.title || date}`
      }
    >
      {experience.assetIds?.length ? (
        <div className="record-cover">
          <AssetImage
            packId={pack.id}
            assetId={experience.assetIds[0]}
            alt=""
            className="record-cover-img"
          />
          {experience.assetIds.length > 1 && (
            <span className="photo-count">
              {ko ? `사진 ${experience.assetIds.length}장` : `${experience.assetIds.length} photos`}
            </span>
          )}
        </div>
      ) : null}
      <div className="record-card-content">
        {experience.title && <h2>{experience.title}</h2>}
        {(experience.editedNote || experience.note) && (
          <p className="record-excerpt">{experience.editedNote || experience.note}</p>
        )}
        <p className="record-date">
          {experience.placeSnapshot?.name ? `${experience.placeSnapshot.name} · ` : ''}
          {date}
          {!experience.occurredOn && <span> · {ko ? '저장한 날짜' : 'Saved date'}</span>}
        </p>
        <p className="record-connection">
          {pack.kind === 'outing'
            ? pack.plan.title
            : ko
              ? '일정 없이 남긴 기록'
              : 'Independent memory'}
        </p>
      </div>
    </button>
  );
}
