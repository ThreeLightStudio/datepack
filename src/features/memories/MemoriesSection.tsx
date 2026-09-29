import { useRef, useState, type FormEvent } from 'react';
import { createAssetsFromFiles, registerAsset, type Experience } from '@datepack/core';
import { useStore, updateExperiences, showToast } from '../../store/datepackStore';
import { useLocale, formatDate } from '../../i18n';
import { AssetImage } from '../../components/AssetImage';
import { buildExperienceShareText } from './shareText';

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('clipboard-unavailable');
}

export function MemoriesSection() {
  const locale = useLocale();
  const ko = locale === 'ko';
  const { pack } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [eventId, setEventId] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [occurredOn, setOccurredOn] = useState(pack?.plan.date ?? '');
  const [time, setTime] = useState('');
  const [outcome, setOutcome] = useState<Experience['outcome']>('note');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [noteIds, setNoteIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  if (!pack) return null;
  const activePack = pack;
  const experiences = activePack.experiences;

  const updateSet = (
    setter: (value: Set<string>) => void,
    current: Set<string>,
    id: string,
    checked: boolean,
  ) => {
    const next = new Set(current);
    if (checked) next.add(id);
    else next.delete(id);
    setter(next);
  };

  const shareText = buildExperienceShareText(experiences, selectedIds, noteIds, locale);
  const resetForm = () => {
    setTitle('');
    setEventId('');
    setPlaceName('');
    setTime('');
    setOutcome('note');
    setNote('');
    setFiles([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  async function saveExperience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const created = await createAssetsFromFiles(files);
      const nextPack = structuredClone(activePack);
      const registered: Array<{ asset: (typeof nextPack.assets)[number]; blob: Blob }> = [];
      for (const item of created) {
        registered.push({ asset: registerAsset(nextPack, item.asset), blob: item.blob });
      }
      const event = nextPack.plan.events.find((item) => item.id === eventId);
      const plannedPlace = event?.placeId
        ? nextPack.plan.places?.find((item) => item.id === event.placeId)
        : undefined;
      const placeSnapshotName = placeName.trim() || plannedPlace?.name;
      const experience: Experience = {
        id: crypto.randomUUID(),
        ...(event ? { eventId: event.id } : {}),
        title: title.trim(),
        ...(placeSnapshotName
          ? {
              placeSnapshot: {
                name: placeSnapshotName,
                ...((plannedPlace?.name === placeSnapshotName && plannedPlace.mapQuery) ||
                !plannedPlace
                  ? { mapQuery: plannedPlace?.mapQuery ?? placeSnapshotName }
                  : {}),
              },
            }
          : {}),
        outcome,
        recordedAt: new Date().toISOString(),
        ...(occurredOn ? { occurredOn } : {}),
        ...(time ? { timing: { kind: 'exact', at: { dayOffset: 0, time } } } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(registered.length ? { assetIds: registered.map(({ asset }) => asset.id) } : {}),
        source: { kind: 'user' },
      };
      const saved = await updateExperiences(
        [...activePack.experiences, experience],
        nextPack.assets,
        registered,
        activePack.revision,
      );
      if (saved) {
        resetForm();
        showToast(ko ? '추억을 이 DatePack에 저장했어요.' : 'Memory saved to this DatePack.');
      }
    } catch (error) {
      console.error('[datepack] memory save failed', error);
      showToast(
        ko
          ? '추억을 저장하지 못했어요. 입력은 그대로 남아 있어요.'
          : 'Could not save this memory. Your draft is still here.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function copySelected() {
    if (!shareText) return;
    try {
      await copyText(shareText);
      showToast(ko ? '선택한 기록을 복사했어요.' : 'Selected memories copied.');
    } catch {
      showToast(
        ko
          ? '복사하지 못했어요. 브라우저 권한을 확인해주세요.'
          : 'Could not copy. Check your browser permissions.',
      );
    }
  }

  async function shareSelected() {
    if (!shareText) return;
    if (!navigator.share) {
      await copySelected();
      return;
    }
    try {
      await navigator.share({ title: activePack.plan.title, text: shareText });
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        showToast(
          ko
            ? '공유를 열지 못했어요. 복사를 이용해보세요.'
            : 'Could not open sharing. Try copying instead.',
        );
      }
    }
  }

  return (
    <section className="details-section memories-section" aria-labelledby="memories-title">
      <div className="section-head">
        <h2 id="memories-title">{ko ? '함께한 순간' : 'The moments you shared'}</h2>
      </div>
      <p className="hint-text">
        {ko
          ? '계획을 완료하지 않아도 사진과 메모를 남길 수 있어요. 방문 날짜와 기록한 시각은 따로 보관돼요.'
          : 'Save a photo or note without completing the plan. The visit date and the time you saved it are kept separately.'}
      </p>

      <form className="form memory-form" onSubmit={(event) => void saveExperience(event)}>
        <label className="field">
          <span>{ko ? '기억할 순간' : 'What do you want to remember?'}</span>
          <input
            required
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="field-row memory-fields-row">
          <label className="field">
            <span>{ko ? '계획에서 고르기 (선택)' : 'Link to a planned stop (optional)'}</span>
            <select
              value={eventId}
              onChange={(event) => {
                setEventId(event.target.value);
                const planned = activePack.plan.events.find(
                  (item) => item.id === event.target.value,
                );
                if (planned) {
                  if (!title.trim()) setTitle(planned.title);
                  const plannedPlace = planned.placeId
                    ? activePack.plan.places?.find((item) => item.id === planned.placeId)
                    : undefined;
                  if (plannedPlace) setPlaceName(plannedPlace.name);
                }
              }}
            >
              <option value="">{ko ? '계획에 없던 순간' : 'A moment outside the plan'}</option>
              {activePack.plan.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{ko ? '기록 종류' : 'Type of memory'}</span>
            <select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as Experience['outcome'])}
            >
              <option value="note">{ko ? '순간' : 'Moment'}</option>
              <option value="completed">{ko ? '방문' : 'Visited'}</option>
              <option value="skipped">{ko ? '건너뜀' : 'Skipped'}</option>
            </select>
          </label>
        </div>
        <div className="field-row memory-fields-row">
          <label className="field">
            <span>{ko ? '방문한 날짜 (선택)' : 'Date of visit (optional)'}</span>
            <input
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{ko ? '방문 시각 (선택)' : 'Time of visit (optional)'}</span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{ko ? '장소 (선택)' : 'Place (optional)'}</span>
          <input
            maxLength={160}
            value={placeName}
            onChange={(event) => setPlaceName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{ko ? '짧은 메모 (선택)' : 'A short note (optional)'}</span>
          <textarea
            rows={2}
            maxLength={1200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="memory-photo-row">
          <button type="button" className="btn btn-soft" onClick={() => fileRef.current?.click()}>
            {ko ? '사진 고르기' : 'Choose photos'}
          </button>
          <span className="hint-text">
            {files.length
              ? ko
                ? `${files.length}장 선택됨`
                : `${files.length} selected`
              : ko
                ? '사진은 이 파일 안에 보관돼요.'
                : 'Photos stay inside this DatePack.'}
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          hidden
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        <button type="submit" className="btn btn-primary" disabled={!title.trim() || saving}>
          {saving ? (ko ? '저장 중…' : 'Saving…') : ko ? '추억 저장' : 'Save memory'}
        </button>
      </form>

      {experiences.length > 0 ? (
        <>
          <fieldset className="memory-list">
            <legend>{ko ? '공유할 기록 선택' : 'Choose memories to share'}</legend>
            {experiences.map((experience) => {
              const date = experience.occurredOn
                ? formatDate(locale, experience.occurredOn)
                : ko
                  ? '날짜 미상'
                  : 'Date unknown';
              const recorded = new Intl.DateTimeFormat(ko ? 'ko-KR' : 'en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(experience.recordedAt));
              const checked = selectedIds.has(experience.id);
              const noteChecked = noteIds.has(experience.id);
              return (
                <article className="memory-card" key={experience.id}>
                  <label className="memory-select">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        updateSet(setSelectedIds, selectedIds, experience.id, event.target.checked)
                      }
                    />
                    <span>
                      <strong>{experience.title}</strong>
                      <span className="memory-kind">
                        {experience.outcome === 'completed'
                          ? ko
                            ? '방문'
                            : 'Visited'
                          : experience.outcome === 'skipped'
                            ? ko
                              ? '건너뜀'
                              : 'Skipped'
                            : ko
                              ? '순간'
                              : 'Moment'}
                      </span>
                      <span className="memory-meta">
                        {experience.placeSnapshot?.name
                          ? `${experience.placeSnapshot.name} · `
                          : ''}
                        {date}
                        {experience.timing?.kind === 'exact'
                          ? ` · ${experience.timing.at.time}`
                          : ` · ${ko ? '방문 시각 미상' : 'time not recorded'}`}
                      </span>
                    </span>
                  </label>
                  {experience.note && (
                    <label className="memory-note-share">
                      <input
                        type="checkbox"
                        checked={noteChecked}
                        disabled={!checked}
                        onChange={(event) =>
                          updateSet(setNoteIds, noteIds, experience.id, event.target.checked)
                        }
                      />
                      {ko ? '공유 텍스트에 메모 포함' : 'Include note in shared text'}
                    </label>
                  )}
                  <p className="memory-recorded">
                    {ko ? '기록한 시각' : 'Recorded'} · {recorded}
                  </p>
                  {experience.note && <p className="memory-note">{experience.note}</p>}
                  {experience.assetIds?.length ? (
                    <div className="memory-photos" aria-label={ko ? '추억 사진' : 'Memory photos'}>
                      {experience.assetIds.map((assetId) => (
                        <AssetImage
                          key={assetId}
                          packId={pack.plan.id}
                          assetId={assetId}
                          className="memory-photo"
                          alt={ko ? `${experience.title} 사진` : `Photo for ${experience.title}`}
                        />
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </fieldset>
          <div className="action-row memory-share-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!shareText}
              onClick={() => void copySelected()}
            >
              {ko ? '선택한 기록 복사' : 'Copy selected'}
            </button>
            <button
              type="button"
              className="btn btn-soft"
              disabled={!shareText}
              onClick={() => void shareSelected()}
            >
              {ko ? '공유…' : 'Share…'}
            </button>
          </div>
          <p className="hint-text">
            {ko
              ? '공유되는 텍스트는 보관본을 바꾸지 않아요. 사진은 공유에 첨부되지 않고 DatePack 파일에 남아요.'
              : 'Sharing creates a separate text copy and never changes your archive. Photos stay in the DatePack and are not attached.'}
          </p>
        </>
      ) : (
        <p className="memory-empty">{ko ? '아직 남긴 추억이 없어요.' : 'No memories saved yet.'}</p>
      )}
    </section>
  );
}
