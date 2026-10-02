import { todayISO } from '@datepack/core';
import { useStore, type SavedPackSummary } from '../../store/datepackStore';
import { CameraIcon, PlusIcon } from '../../components/icons';
import { formatDate, useLocale } from '../../i18n';
import { collectRecords, recordKey, type RecordKey } from '../memories/recordLibrary';
import { RecordCard } from '../memories/RecordCard';
import type { LibraryActivity } from './libraryActivity';

type Props = {
  onCreate: () => void;
  onPhoto: () => void;
  onOpenPlan: (id: string, today?: boolean) => void;
  onRecords: () => void;
  onRecord: (key: RecordKey) => void;
  onResume: (activity: LibraryActivity) => void;
};

export function HomeView({ onCreate, onPhoto, onOpenPlan, onRecords, onRecord, onResume }: Props) {
  const { savedDocuments, savedPacks, savedActivities } = useStore();
  const locale = useLocale();
  const ko = locale === 'ko';
  const records = collectRecords(savedDocuments).slice(0, 3);
  const continuing = savedActivities.filter((item) => item.request || item.continuing);
  const next = savedPacks
    .filter(({ pack }) => pack.plan.date && pack.plan.date >= todayISO())
    .sort((a, b) => a.pack.plan.date!.localeCompare(b.pack.plan.date!))[0];
  return (
    <div className="view home-view">
      <header className="view-head home-intro">
        <h1>{ko ? '나갈 계획, 남길 순간.' : 'Plans to make. Moments to keep.'}</h1>
        <p>
          {ko
            ? '혼자여도 함께여도, 계획 없이 사진부터 남겨도 좋아요.'
            : 'On your own or together. Start with a plan, or just a photo.'}
        </p>
      </header>
      {continuing.length > 0 && (
        <section className="home-continuation">
          <h2>{ko ? '이어 하기' : 'Pick up where you left off'}</h2>
          {continuing.map((activity) => (
            <div
              className="home-resume"
              key={activity.packId}
              role="group"
              aria-label={activity.title || (ko ? '남긴 순간' : 'Saved moment')}
            >
              <strong>{activity.title || (ko ? '남긴 순간' : 'Saved moment')}</strong>
              {activity.request && (
                <p className="hint-text">
                  {activity.request.kind === 'memory-edit'
                    ? ko
                      ? '기록 문장 다듬기'
                      : 'Memory wording'
                    : activity.request.kind === 'create'
                      ? ko
                        ? '새 계획'
                        : 'New plan'
                      : ko
                        ? '일정 변경'
                        : 'Replan'}{' '}
                  ·{' '}
                  {
                    {
                      ready: ko ? '요청 준비됨' : 'Request ready',
                      waiting: ko ? '답안 기다리는 중' : 'Waiting for reply',
                      draft: ko ? '답안 작성 중' : 'Reply in progress',
                      review: ko ? '적용 전 확인' : 'Review before applying',
                      stale: ko ? '새 요청 필요' : 'New request needed',
                      error: ko ? '답안 확인 필요' : 'Reply needs attention',
                      applied: '',
                      cancelled: '',
                    }[activity.request.status]
                  }
                </p>
              )}
              {activity.request && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => onResume(activity)}
                >
                  {ko ? 'AI 요청 이어가기' : 'Resume AI request'}
                </button>
              )}
              {activity.continuing && (
                <button
                  className="btn btn-soft"
                  type="button"
                  onClick={() => onOpenPlan(activity.packId, true)}
                >
                  {ko ? '외출 이어 보기' : 'Continue outing'}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <div className="home-actions">
        <button type="button" className="btn btn-primary" onClick={onPhoto}>
          <CameraIcon width={20} height={20} />
          {ko ? '사진 남기기' : 'Save photos'}
        </button>
        <button type="button" className="btn btn-soft" onClick={onCreate}>
          <PlusIcon width={20} height={20} />
          {ko ? '계획 만들기' : 'Make a plan'}
        </button>
      </div>
      <section className="home-section">
        <h2>{ko ? '다음 계획' : 'Next plan'}</h2>
        {next ? (
          <PlanSummary row={next} onOpen={() => onOpenPlan(next.pack.id)} />
        ) : (
          <p className="empty-inline">
            {ko ? '날짜가 정해진 다음 계획이 아직 없어요.' : 'No upcoming dated plan yet.'}
          </p>
        )}
      </section>
      <section className="home-section">
        <div className="section-head">
          <h2>{ko ? '최근 기록' : 'Recent memories'}</h2>
          <button type="button" className="text-action" onClick={onRecords}>
            {ko ? '모두 보기' : 'View all'}
          </button>
        </div>
        {records.length ? (
          <div className="record-list">
            {records.map((record) => (
              <RecordCard key={recordKey(record)} record={record} onOpen={() => onRecord(record)} />
            ))}
          </div>
        ) : (
          <p className="empty-inline">
            {ko
              ? '사진만 골라도 하나의 기록이 돼요. 설명과 일정은 나중에 추가하세요.'
              : 'A photo is enough. Add words or a plan whenever you like.'}
          </p>
        )}
      </section>
    </div>
  );
}

export function PlanSummary({ row, onOpen }: { row: SavedPackSummary; onOpen: () => void }) {
  const locale = useLocale();
  const ko = locale === 'ko';
  return (
    <button type="button" className="plan-summary" onClick={onOpen}>
      <strong>{row.pack.plan.title}</strong>
      <span>
        {row.pack.plan.date
          ? formatDate(locale, row.pack.plan.date)
          : ko
            ? '날짜 미정'
            : 'Date undecided'}{' '}
        · {ko ? `활동 ${row.pack.plan.events.length}개` : `${row.pack.plan.events.length} stops`}
      </span>
    </button>
  );
}
