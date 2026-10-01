import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createAssetsFromFiles, createId, registerAsset, type Experience } from '@datepack/core';
import {
  connectRecord,
  deleteRecord,
  exportPackById,
  getStoreState,
  refreshLibrary,
  saveRecord,
  showToast,
  switchPack,
  useStore,
} from '../../store/datepackStore';
import { AssetImage } from '../../components/AssetImage';
import { Sheet } from '../../components/Sheet';
import { CameraIcon, NoteIcon } from '../../components/icons';
import { formatDate, useLocale } from '../../i18n';
import { copyRequestText } from '../ai/clipboard';
import { buildExperienceShareText } from './shareText';
import {
  collectRecords,
  photoProblem,
  recordKey,
  withCover,
  type RecordKey,
  type RecordSummary,
} from './recordLibrary';
import { RecordCard } from './RecordCard';

export type RecordHubHandle = {
  choosePhotos: () => void;
  newText: () => void;
  openRecord: (key: RecordKey) => void;
  resumeAi: (key: RecordKey) => void;
};
type Panel =
  | 'preview'
  | 'saved'
  | 'detail'
  | 'edit'
  | 'link'
  | 'share'
  | 'viewer'
  | 'delete'
  | null;
type Draft = {
  original?: RecordSummary;
  title: string;
  note: string;
  date: string;
  time: string;
  place: string;
  outcome: Experience['outcome'];
  assetIds: string[];
};
const emptyDraft = (): Draft => ({
  title: '',
  note: '',
  date: '',
  time: '',
  place: '',
  outcome: 'note',
  assetIds: [],
});
const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.heic,.heif';

export function RecordHub({
  visible,
  ref,
  onOpenTask,
  onOpenAi,
}: {
  visible: boolean;
  ref: Ref<RecordHubHandle>;
  onOpenTask: () => void;
  onOpenAi: (key: RecordKey) => void;
}) {
  const { savedDocuments, savedPacks } = useStore();
  const locale = useLocale();
  const ko = locale === 'ko';
  const records = collectRecords(savedDocuments);
  const fileRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const restoreRecordFocus = useRef(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [target, setTarget] = useState<RecordKey | null>(null);
  const record = target ? records.find((row) => recordKey(row) === recordKey(target)) : undefined;
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const [readyPhotos, setReadyPhotos] = useState<Set<File>>(() => new Set());
  const editFileDrafts = useRef(new Map<string, File[]>());
  const newFiles = useRef<File[]>([]);
  const files = panel === 'edit' ? editFiles : photoFiles;
  const setFiles = panel === 'edit' ? setEditFiles : setPhotoFiles;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const editDrafts = useRef(new Map<string, Draft>());
  const newDraft = useRef<Draft>(emptyDraft());
  const [editingPhotos, setEditingPhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latestRecord, setLatestRecord] = useState<RecordSummary | null>(null);
  const [linkPlanId, setLinkPlanId] = useState('');
  const [linkRevision, setLinkRevision] = useState(0);
  const [linkEventId, setLinkEventId] = useState('');
  const [linkStep, setLinkStep] = useState<'plan' | 'activity'>('plan');
  const [linkSource, setLinkSource] = useState<RecordSummary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [includeNotes, setIncludeNotes] = useState(true);
  const [viewerId, setViewerId] = useState('');
  const [limit, setLimit] = useState(24);

  function open(next: Panel) {
    setError('');
    setPanel(next);
  }
  function openRecord(key: RecordKey) {
    restoreRecordFocus.current = true;
    setTarget(key);
    open('detail');
  }
  function close() {
    if (lock.current) return;
    if (panel === 'edit') {
      if (draft.original) {
        editDrafts.current.set(recordKey(draft.original), draft);
        editFileDrafts.current.set(recordKey(draft.original), editFiles);
      } else {
        newDraft.current = draft;
        newFiles.current = editFiles;
      }
    }
    setPanel(null);
  }
  function beginEdit(row?: RecordSummary) {
    setConflict(false);
    setLatestRecord(null);
    if (!row) restoreRecordFocus.current = false;
    setEditFiles(row ? (editFileDrafts.current.get(recordKey(row)) ?? []) : newFiles.current);
    setEditingPhotos(false);
    const e = row?.experience;
    setDraft(
      row
        ? (editDrafts.current.get(recordKey(row)) ?? {
            original: row,
            title: e?.title ?? '',
            note: e?.note ?? '',
            date: e?.occurredOn ?? '',
            time: e?.timing?.kind === 'exact' ? e.timing.at.time : '',
            place: e?.placeSnapshot?.name ?? '',
            outcome: e?.outcome ?? 'note',
            assetIds: [...(e?.assetIds ?? [])],
          })
        : newDraft.current,
    );
    open('edit');
  }
  useImperativeHandle(ref, () => ({
    choosePhotos: () => {
      restoreRecordFocus.current = false;
      setEditingPhotos(false);
      fileRef.current?.click();
    },
    newText: () => {
      restoreRecordFocus.current = false;
      beginEdit();
    },
    openRecord,
    resumeAi: (key) => {
      restoreRecordFocus.current = true;
      setTarget(key);
      setPanel(null);
      onOpenAi(key);
    },
  }));

  const problem = files.some((file) => photoProblem(file) || !readyPhotos.has(file));
  function markReady(file: File) {
    setReadyPhotos((before) => new Set(before).add(file));
  }
  const meaningful =
    draft.assetIds.length > 0 || files.length > 0 || draft.title.trim() || draft.note.trim();
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((before) => ({ ...before, [key]: value }));
  }

  async function persist(photoOnly = false, occurrence?: { date: string; time: string }) {
    if (lock.current || problem || (!photoOnly && !meaningful) || (photoOnly && !files.length))
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const original = photoOnly ? undefined : draft.original;
      const registry = { assets: [...(original?.pack.assets ?? [])] };
      const created = await createAssetsFromFiles(files);
      const writes = created.map(({ asset, blob }) => ({
        asset: registerAsset(registry, asset),
        blob,
      }));
      const assetIds = [
        ...(photoOnly ? [] : draft.assetIds),
        ...writes.map(({ asset }) => asset.id),
      ];
      const note = photoOnly
        ? undefined
        : draft.note === original?.experience.note
          ? draft.note
          : draft.note.trim() || undefined;
      const occurredOn = occurrence?.date ?? draft.date;
      const time = occurrence?.time ?? draft.time;
      const experience: Experience = {
        ...original?.experience,
        id: original?.experience.id ?? createId('experience'),
        recordedAt: original?.experience.recordedAt ?? new Date().toISOString(),
        title: photoOnly ? undefined : draft.title.trim() || undefined,
        note,
        // An old edit of different words must not masquerade as an edit of the new original.
        editedNote:
          note === original?.experience.note ? original?.experience.editedNote : undefined,
        occurredOn: photoOnly ? undefined : occurredOn || undefined,
        timing:
          !photoOnly && time
            ? {
                kind: 'exact',
                at: {
                  dayOffset:
                    original?.experience.timing?.kind === 'exact'
                      ? original.experience.timing.at.dayOffset
                      : 0,
                  time,
                },
              }
            : original?.experience.timing?.kind !== 'exact'
              ? original?.experience.timing
              : undefined,
        placeSnapshot:
          !photoOnly && draft.place.trim()
            ? draft.place.trim() === original?.experience.placeSnapshot?.name
              ? original.experience.placeSnapshot
              : { name: draft.place.trim() }
            : undefined,
        outcome: photoOnly ? 'note' : draft.outcome,
        assetIds: assetIds.length ? assetIds : undefined,
        source: original?.experience.source ?? { kind: 'user' },
      };
      const saved = await saveRecord(experience, {
        ...(original ? { packId: original.packId, expectedRevision: original.pack.revision } : {}),
        assetWrites: writes,
      });
      setTarget({ packId: saved.id, experienceId: experience.id });
      setFiles([]);
      if (original) {
        editDrafts.current.delete(recordKey(original));
        editFileDrafts.current.delete(recordKey(original));
      } else if (!photoOnly) {
        newDraft.current = emptyDraft();
        newFiles.current = [];
      }
      setDraft(emptyDraft());
      setPanel(original ? 'detail' : 'saved');
    } catch (reason) {
      setConflict(reason instanceof Error && reason.message.includes('revision-conflict'));
      setError(
        ko
          ? '저장하지 못했어요. 사진과 입력은 그대로예요. 저장 공간과 최신 기록을 확인하고 다시 시도하세요.'
          : 'Could not save. Your photos and words are kept. Check storage and the latest memory, then retry.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function compareLatest() {
    if (!draft.original || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await refreshLibrary();
      const latest = collectRecords(getStoreState().savedDocuments).find(
        (row) => recordKey(row) === recordKey(draft.original!),
      );
      if (!latest) {
        setError(
          ko
            ? '기록이 이동되거나 삭제됐어요. 입력은 유지했어요. 기록 목록에서 최신 기록을 확인해주세요.'
            : 'This memory moved or was deleted. Your input is kept. Check the memory list.',
        );
        return;
      }
      setLatestRecord(latest);
    } catch {
      setError(
        ko
          ? '최신 기록을 불러오지 못했어요. 입력은 그대로예요. 다시 시도하세요.'
          : 'Could not load the latest memory. Your input is kept. Try again.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function beginLink(row: RecordSummary) {
    setLinkSource(row);
    setLinkPlanId('');
    setLinkEventId('');
    setLinkStep('plan');
    open('link');
  }
  async function move(unlink = false) {
    if (!linkSource || lock.current || (!unlink && !linkPlanId)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await connectRecord(
        linkSource.packId,
        linkSource.pack.revision,
        linkSource.experienceId,
        unlink
          ? undefined
          : {
              packId: linkPlanId,
              expectedRevision: linkRevision,
              ...(linkEventId ? { eventId: linkEventId } : {}),
            },
      );
      setTarget({ packId: saved.id, experienceId: linkSource.experienceId });
      setPanel('detail');
    } catch {
      try {
        await refreshLibrary();
        const latest = collectRecords(getStoreState().savedDocuments).find(
          (row) => recordKey(row) === recordKey(linkSource),
        );
        if (latest) setLinkSource(latest);
      } catch {
        /* Keep the current source and choices when storage is unavailable. */
      }
      setLinkStep('plan');
      setError(
        ko
          ? '연결하지 못했어요. 기록과 사진은 그대로예요. 최신 계획을 다시 선택해주세요.'
          : 'Could not change the link. Your memory and photos are kept. Select the latest plan again.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function beginShare(row?: RecordSummary) {
    setSelected(new Set(row ? [recordKey(row)] : []));
    open('share');
  }
  const shareText = records
    .filter((row) => selected.has(recordKey(row)))
    .map(({ experience }) =>
      buildExperienceShareText(
        [experience],
        new Set([experience.id]),
        new Set(includeNotes ? [experience.id] : []),
        locale,
      ),
    )
    .join('\n\n');
  async function share(copy = false) {
    try {
      if (!copy && navigator.share)
        await navigator.share({ title: ko ? '남긴 순간' : 'Saved moments', text: shareText });
      else if (await copyRequestText(shareText))
        showToast(ko ? '선택한 기록을 복사했어요.' : 'Selected memories copied.');
      else
        setError(
          ko
            ? '복사하지 못했어요. 아래 내용을 선택해 복사하세요.'
            : 'Copy failed. Select the text below to copy it.',
        );
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError'))
        setError(
          ko ? '공유를 열지 못했어요. 복사를 이용하세요.' : 'Could not open sharing. Try copying.',
        );
    }
  }
  async function remove() {
    if (!record || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await deleteRecord(record.packId, record.pack.revision, record.experienceId);
      setTarget(null);
      setPanel(null);
    } catch {
      setError(
        ko ? '삭제하지 못했어요. 기록은 그대로예요.' : 'Could not delete. Your memory is kept.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function openAi() {
    if (!record) return;
    try {
      await switchPack(record.packId);
      setPanel(null);
      onOpenAi({ packId: record.packId, experienceId: record.experienceId });
    } catch {
      setError(
        ko ? '기록을 열지 못했어요. 다시 시도해주세요.' : 'Could not open this memory. Try again.',
      );
    }
  }

  const titles: Record<Exclude<Panel, null>, string> = {
    preview: ko ? '사진 확인' : 'Review photos',
    saved: ko ? '기록을 저장했어요' : 'Memory saved',
    detail: ko ? '남긴 순간' : 'Saved moment',
    edit: ko ? '설명 추가·편집' : 'Add or edit words',
    link: ko ? '일정 연결' : 'Link to a plan',
    share: ko ? '기록 공유' : 'Share memories',
    viewer: ko ? '사진 크게 보기' : 'View photo',
    delete: ko ? '기록 삭제' : 'Delete memory',
  };
  const linkPlan = savedPacks.find(({ pack }) => pack.id === linkPlanId)?.pack;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (!picked.length) return;
          if (editingPhotos) setEditFiles((before) => [...before, ...picked]);
          else setPhotoFiles((before) => [...before, ...picked]);
          setError('');
          if (!editingPhotos) setPanel('preview');
        }}
      />
      {visible && (
        <div className="view records-view">
          <header className="view-head">
            <h1 className="plan-title">{ko ? '남긴 순간' : 'Saved moments'}</h1>
            <p className="hint-text">
              {ko
                ? '계획에 연결한 기록도, 사진만 남긴 기록도 여기 있어요.'
                : 'Photos on their own and memories linked to plans, all here.'}
            </p>
          </header>
          <div className="action-row record-create-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                restoreRecordFocus.current = false;
                setEditingPhotos(false);
                fileRef.current?.click();
              }}
            >
              <CameraIcon width={18} height={18} />
              {ko ? '사진 남기기' : 'Save photos'}
            </button>
            <button type="button" className="btn btn-soft" onClick={() => beginEdit()}>
              <NoteIcon width={18} height={18} />
              {ko ? '글만 남기기' : 'Write a note'}
            </button>
          </div>
          {photoFiles.length > 0 && panel !== 'edit' && (
            <button type="button" className="draft-resume" onClick={() => open('preview')}>
              {ko
                ? `선택한 사진 ${photoFiles.length}장 이어 저장하기`
                : `Continue with ${photoFiles.length} selected photos`}
            </button>
          )}
          {records.length > 0 ? (
            <>
              <div className="section-head">
                <p className="hint-text">
                  {ko ? `${records.length}개의 기록` : `${records.length} memories`}
                </p>
                <button type="button" className="text-action" onClick={() => beginShare()}>
                  {ko ? '공유' : 'Share'}
                </button>
              </div>
              <div className="record-list">
                {records.slice(0, limit).map((row) => (
                  <RecordCard key={recordKey(row)} record={row} onOpen={() => openRecord(row)} />
                ))}
              </div>
              {records.length > limit && (
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => setLimit((before) => before + 24)}
                >
                  {ko ? '기록 더 보기' : 'More memories'}
                </button>
              )}
            </>
          ) : (
            <p className="empty-inline">
              {ko
                ? '사진만으로 첫 기록을 남겨보세요. 제목이나 일정은 없어도 돼요.'
                : 'Save your first photos. No title or plan needed.'}
            </p>
          )}
        </div>
      )}

      {
        <Sheet
          open={panel !== null}
          title={panel ? titles[panel] : ''}
          onClose={close}
          restoreFocus={() => {
            if (!restoreRecordFocus.current || !target) return false;
            const card = document.querySelector<HTMLElement>(
              `[data-record-key="${CSS.escape(recordKey(target))}"]`,
            );
            if (!card) return false;
            card.focus({ preventScroll: true });
            return true;
          }}
        >
          <div className="record-sheet-content">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {panel === 'preview' && (
              <>
                <p className="hint-text">
                  {ko
                    ? '선택한 사진을 하나의 기록으로 저장해요. 설명과 일정 연결은 나중에 해도 돼요.'
                    : 'Save these photos as one memory. Add words or link a plan later.'}
                </p>
                <PhotoSelection
                  files={files}
                  onReady={markReady}
                  onRemove={(index) => setFiles((before) => before.filter((_, i) => i !== index))}
                  disabled={busy}
                />
                <p className="hint-text">
                  {ko
                    ? 'JPEG, PNG, WebP, GIF, SVG 지원. HEIC 원본은 JPEG로 변환한 후 선택하세요.'
                    : 'JPEG, PNG, WebP, GIF and SVG supported. Convert original HEIC photos to JPEG first.'}
                </p>
                <div className="action-row">
                  <button
                    type="button"
                    className="btn btn-soft"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    {ko ? '사진 더 고르기' : 'Add photos'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || problem || !files.length}
                    onClick={() => void persist(true)}
                  >
                    {busy ? (ko ? '저장 중…' : 'Saving…') : ko ? '사진 저장' : 'Save photos'}
                  </button>
                </div>
              </>
            )}
            {(panel === 'saved' || panel === 'detail') && record && (
              <>
                {panel === 'saved' && (
                  <p className="save-confirmation" role="status">
                    {ko
                      ? '사진과 기록이 이 기기에 저장됐어요.'
                      : 'Your photos and memory are saved on this device.'}
                  </p>
                )}
                <RecordPhotos
                  record={record}
                  onView={(id) => {
                    setViewerId(id);
                    open('viewer');
                  }}
                />
                {record.experience.title && (
                  <h3 className="record-detail-title">{record.experience.title}</h3>
                )}
                {(record.experience.editedNote || record.experience.note) && (
                  <p className="memory-note">
                    {record.experience.editedNote || record.experience.note}
                  </p>
                )}
                {record.experience.editedNote && (
                  <details className="wording-comparison">
                    <summary>
                      {ko ? '원문·AI 편집문 비교' : 'Compare original and AI wording'}
                    </summary>
                    <h3>{ko ? '원문' : 'Original'}</h3>
                    <p className="memory-note">{record.experience.note}</p>
                    <h3>{ko ? 'AI 편집문' : 'AI wording'}</h3>
                    <p className="memory-note">{record.experience.editedNote}</p>
                  </details>
                )}
                <p className="hint-text">
                  {record.experience.occurredOn
                    ? `${ko ? '경험한 날짜' : 'Experienced'} · ${formatDate(locale, record.experience.occurredOn)}`
                    : ko
                      ? '경험한 날짜는 나중에 추가할 수 있어요.'
                      : 'You can add the experience date later.'}
                  {record.experience.timing?.kind === 'exact'
                    ? ` · ${record.experience.timing.at.time}`
                    : ''}
                </p>
                <p className="hint-text">
                  {ko ? '기록한 시각' : 'Recorded'} ·{' '}
                  {new Date(record.experience.recordedAt).toLocaleString(ko ? 'ko-KR' : 'en-US')}
                </p>
                {record.experience.placeSnapshot?.name && (
                  <p>{record.experience.placeSnapshot.name}</p>
                )}
                <p className="record-connection">
                  {record.pack.kind === 'outing'
                    ? `${record.pack.plan.title}${record.experience.eventId ? ` · ${record.pack.plan.events.find((event) => event.id === record.experience.eventId)?.title ?? ''}` : ''}`
                    : ko
                      ? '일정 없이 남긴 기록'
                      : 'Independent memory'}
                </p>
                <div className="action-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => beginEdit(record)}
                  >
                    {ko ? '설명 추가·편집' : 'Add or edit words'}
                  </button>
                  <button type="button" className="btn btn-soft" onClick={() => beginLink(record)}>
                    {ko ? '일정 연결' : 'Link to a plan'}
                  </button>
                </div>
                {panel === 'saved' ? (
                  <button type="button" className="btn btn-ghost" onClick={close}>
                    {ko ? '완료' : 'Done'}
                  </button>
                ) : (
                  <>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn btn-soft"
                        onClick={() => beginShare(record)}
                      >
                        {ko ? '공유' : 'Share'}
                      </button>
                      {record.experience.note?.trim() && (
                        <button
                          type="button"
                          className="btn btn-soft"
                          onClick={() => void openAi()}
                        >
                          {ko ? 'AI로 문장 다듬기' : 'Polish text with AI'}
                        </button>
                      )}
                    </div>
                    <p className="hint-text">
                      {record.pack.kind === 'outing'
                        ? ko
                          ? '파일로 내려받으면 연결된 계획 전체와 사진·기록이 포함돼요.'
                          : 'The file includes the whole linked plan, photos and memories.'
                        : ko
                          ? '파일로 내려받으면 이 문서의 사진과 모든 기록이 포함돼요.'
                          : 'The file includes all photos and memories in this document.'}
                    </p>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          void exportPackById(record.packId).catch(() =>
                            setError(
                              ko
                                ? '파일을 만들지 못했어요. 다시 시도하세요.'
                                : 'Could not create the file. Try again.',
                            ),
                          )
                        }
                      >
                        {ko ? '파일 내려받기' : 'Download file'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost danger"
                        onClick={() => open('delete')}
                      >
                        {ko ? '기록 삭제' : 'Delete memory'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {panel === 'edit' && (
              <form
                className="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget);
                  const occurrence = {
                    date: String(fields.get('experience-date') ?? ''),
                    time: String(fields.get('experience-time') ?? ''),
                  };
                  setDraft((before) => ({ ...before, ...occurrence }));
                  void persist(false, occurrence);
                }}
              >
                {!draft.assetIds.length && !files.length && (
                  <p className="hint-text">
                    {ko
                      ? '사진 없이 남길 때는 제목이나 메모를 적어주세요.'
                      : 'To save without photos, add a title or note.'}
                  </p>
                )}
                {conflict && (
                  <div className="record-conflict">
                    <p className="hint-text">
                      {ko
                        ? '이 기록이 다른 곳에서 바뀌었어요. 최신 내용을 확인한 뒤 입력한 설명으로 이어 편집할 수 있어요.'
                        : 'This memory changed elsewhere. Review the latest version, then continue with your words.'}
                    </p>
                    <button
                      type="button"
                      className="btn btn-soft"
                      disabled={busy}
                      onClick={() => void compareLatest()}
                    >
                      {ko ? '최신 기록 불러와 비교' : 'Load latest memory to compare'}
                    </button>
                    {latestRecord && (
                      <>
                        <h3>{ko ? '최신 기록' : 'Latest memory'}</h3>
                        <p>{latestRecord.experience.title}</p>
                        <p className="memory-note">
                          {latestRecord.experience.note || (ko ? '메모 없음' : 'No note')}
                        </p>
                        <p className="hint-text">
                          {latestRecord.experience.occurredOn ||
                            (ko ? '경험한 날짜 미정' : 'Experience date unset')}{' '}
                          ·{' '}
                          {ko
                            ? `사진 ${latestRecord.experience.assetIds?.length ?? 0}장`
                            : `${latestRecord.experience.assetIds?.length ?? 0} photos`}
                        </p>
                        <p className="hint-text">
                          {ko
                            ? '현재 입력한 설명은 유지하고, 사진은 최신 기록 기준으로 다시 불러와요. 저장 버튼으로 변경을 확정하세요.'
                            : 'Keep your entered words and reload the latest photos. Use Save memory to confirm your changes.'}
                        </p>
                        <button
                          type="button"
                          className="btn btn-soft"
                          onClick={() => {
                            setDraft((before) => ({
                              ...before,
                              original: latestRecord,
                              assetIds: [...(latestRecord.experience.assetIds ?? [])],
                            }));
                            setConflict(false);
                            setLatestRecord(null);
                            setError('');
                          }}
                        >
                          {ko ? '현재 설명으로 이어 편집' : 'Continue with my words'}
                        </button>
                      </>
                    )}
                  </div>
                )}
                <label className="field">
                  <span>{ko ? '제목 (선택)' : 'Title (optional)'}</span>
                  <input
                    maxLength={160}
                    value={draft.title}
                    onChange={(event) => change('title', event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="field">
                  <span>{ko ? '메모 (선택)' : 'Note (optional)'}</span>
                  <textarea
                    rows={3}
                    maxLength={1200}
                    value={draft.note}
                    onChange={(event) => change('note', event.target.value)}
                    disabled={busy}
                  />
                </label>
                {draft.original?.experience.editedNote && (
                  <p className="hint-text">
                    {ko
                      ? '원문 메모를 바꾸면 이전 AI 편집문은 지워져요.'
                      : 'Changing the original note clears its previous AI wording.'}
                  </p>
                )}
                <div className="field-row">
                  <label className="field">
                    <span>{ko ? '경험한 날짜 (선택)' : 'Experience date (optional)'}</span>
                    <input
                      type="date"
                      name="experience-date"
                      value={draft.date}
                      onChange={(event) => change('date', event.target.value)}
                      onInput={(event) => change('date', event.currentTarget.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span>{ko ? '시각 (선택)' : 'Time (optional)'}</span>
                    <input
                      type="time"
                      name="experience-time"
                      value={draft.time}
                      onChange={(event) => change('time', event.target.value)}
                      onInput={(event) => change('time', event.currentTarget.value)}
                      disabled={busy}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>{ko ? '장소 (선택)' : 'Place (optional)'}</span>
                  <input
                    maxLength={160}
                    value={draft.place}
                    onChange={(event) => change('place', event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="field">
                  <span>{ko ? '기록 종류' : 'Memory type'}</span>
                  <select
                    value={draft.outcome}
                    onChange={(event) =>
                      change('outcome', event.target.value as Experience['outcome'])
                    }
                    disabled={busy}
                  >
                    <option value="note">{ko ? '순간' : 'Moment'}</option>
                    <option value="completed">{ko ? '방문 확인' : 'Confirmed visit'}</option>
                    <option value="skipped">{ko ? '건너뜀' : 'Skipped'}</option>
                  </select>
                </label>
                {draft.original && (
                  <div className="photo-selection">
                    {draft.assetIds.map((id, index) => (
                      <div className="photo-choice" key={id}>
                        <AssetImage
                          packId={draft.original!.packId}
                          assetId={id}
                          className="photo-preview"
                          alt={ko ? `사진 ${index + 1}` : `Photo ${index + 1}`}
                        />
                        <button
                          type="button"
                          className="text-action"
                          disabled={busy || index === 0}
                          onClick={() => change('assetIds', withCover(draft.assetIds, id))}
                        >
                          {index === 0
                            ? ko
                              ? '대표 사진'
                              : 'Cover photo'
                            : ko
                              ? '대표로 선택'
                              : 'Use as cover'}
                        </button>
                        <button
                          type="button"
                          className="text-action"
                          disabled={busy}
                          onClick={() =>
                            change(
                              'assetIds',
                              draft.assetIds.filter((assetId) => assetId !== id),
                            )
                          }
                        >
                          {ko ? '사진 제외' : 'Remove photo'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <PhotoSelection
                  files={files}
                  onReady={markReady}
                  disabled={busy}
                  onRemove={(index) => setFiles((before) => before.filter((_, i) => i !== index))}
                />
                <button
                  type="button"
                  className="btn btn-soft"
                  disabled={busy}
                  onClick={() => {
                    setEditingPhotos(true);
                    fileRef.current?.click();
                  }}
                >
                  {ko ? '사진 추가' : 'Add photos'}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || problem || !meaningful || conflict}
                >
                  {busy ? (ko ? '저장 중…' : 'Saving…') : ko ? '기록 저장' : 'Save memory'}
                </button>
              </form>
            )}
            {panel === 'link' && (
              <>
                {linkStep === 'plan' ? (
                  <>
                    <p className="hint-text">
                      {ko
                        ? '연결할 계획을 고르세요. 다음 단계에서 활동을 고르거나 계획에만 연결할 수 있어요.'
                        : 'Choose a plan. Next, pick a stop or link to the plan only.'}
                    </p>
                    {savedPacks.map(({ pack }) => (
                      <button
                        type="button"
                        className="plan-summary"
                        key={pack.id}
                        disabled={busy}
                        onClick={() => {
                          setLinkPlanId(pack.id);
                          setLinkRevision(pack.revision);
                          setLinkEventId('');
                          setLinkStep('activity');
                          setError('');
                        }}
                      >
                        <strong>{pack.plan.title}</strong>
                        <span>
                          {pack.plan.date
                            ? formatDate(locale, pack.plan.date)
                            : ko
                              ? '날짜 미정'
                              : 'Date undecided'}
                        </span>
                      </button>
                    ))}
                    {!savedPacks.length && (
                      <p className="empty-inline">
                        {ko
                          ? '연결할 계획이 아직 없어요. 기록은 일정 없이 안전하게 남아 있어요.'
                          : 'No plan to link yet. Your independent memory is safely saved.'}
                      </p>
                    )}
                    {linkSource?.pack.kind === 'outing' && (
                      <button
                        type="button"
                        className="btn btn-soft"
                        disabled={busy}
                        onClick={() => void move(true)}
                      >
                        {ko
                          ? '연결 해제 · 일정 없이 남기기'
                          : 'Unlink · keep as independent memory'}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="text-action"
                      disabled={busy}
                      onClick={() => setLinkStep('plan')}
                    >
                      {ko ? '계획 다시 선택' : 'Choose another plan'}
                    </button>
                    <h3>{linkPlan?.plan.title}</h3>
                    <label className="field">
                      <span>{ko ? '활동 (선택)' : 'Stop (optional)'}</span>
                      <select
                        value={linkEventId}
                        onChange={(event) => setLinkEventId(event.target.value)}
                        disabled={busy}
                      >
                        <option value="">{ko ? '계획에만 연결' : 'Link to plan only'}</option>
                        {linkPlan?.plan.events.map((event) => (
                          <option key={event.id} value={event.id}>
                            {event.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="hint-text">
                      {ko
                        ? '사진·원문·경험한 날짜는 그대로 유지돼요. 연결만 바뀌어요.'
                        : 'Photos, original words and experience date are kept. Only the connection changes.'}
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !linkPlan}
                      onClick={() => void move()}
                    >
                      {busy ? (ko ? '연결 중…' : 'Linking…') : ko ? '연결 저장' : 'Save link'}
                    </button>
                  </>
                )}
              </>
            )}
            {panel === 'share' && (
              <>
                <p className="hint-text">
                  {ko
                    ? '선택한 기록의 글만 공유해요. 사진을 포함하려면 기록에서 파일로 내려받으세요.'
                    : 'Share text from selected memories. To include photos, download a file from the memory.'}
                </p>
                <fieldset className="record-share-list">
                  <legend>{ko ? '공유할 기록 선택' : 'Choose memories'}</legend>
                  {records.map((row) => (
                    <label className="record-share-option" key={recordKey(row)}>
                      <input
                        type="checkbox"
                        checked={selected.has(recordKey(row))}
                        onChange={(event) =>
                          setSelected((before) => {
                            const next = new Set(before);
                            if (event.target.checked) next.add(recordKey(row));
                            else next.delete(recordKey(row));
                            return next;
                          })
                        }
                      />
                      <span>
                        {row.experience.title ||
                          new Date(row.experience.recordedAt).toLocaleDateString(
                            ko ? 'ko-KR' : 'en-US',
                          )}
                        <small>
                          {row.pack.kind === 'outing'
                            ? row.pack.plan.title
                            : ko
                              ? '일정 없이 남긴 기록'
                              : 'Independent memory'}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <label className="record-share-option">
                  <input
                    type="checkbox"
                    checked={includeNotes}
                    onChange={(event) => setIncludeNotes(event.target.checked)}
                  />
                  {ko
                    ? '메모 포함 (AI 편집문이 있으면 편집문 사용)'
                    : 'Include notes (use AI wording when saved)'}
                </label>
                <div className="action-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!shareText}
                    onClick={() => void share()}
                  >
                    {ko ? '선택한 기록 공유' : 'Share selected'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-soft"
                    disabled={!shareText}
                    onClick={() => void share(true)}
                  >
                    {ko ? '글 복사' : 'Copy text'}
                  </button>
                </div>
                {shareText && (
                  <details>
                    <summary>{ko ? '공유할 글 보기' : 'Preview shared text'}</summary>
                    <pre className="share-preview">{shareText}</pre>
                  </details>
                )}
              </>
            )}
            {panel === 'viewer' && record && (
              <>
                <AssetImage
                  key={`${record.packId}:${viewerId}`}
                  packId={record.packId}
                  assetId={viewerId}
                  className="record-photo-large"
                  alt={ko ? '기록 사진' : 'Memory photo'}
                />
                <button type="button" className="btn btn-ghost" onClick={() => open('detail')}>
                  {ko ? '같은 기록으로 돌아가기' : 'Back to this memory'}
                </button>
              </>
            )}
            {panel === 'delete' && (
              <>
                <p>
                  {ko
                    ? '이 기록과 다른 곳에서 쓰이지 않는 사진을 삭제할까요? 되돌릴 수 없어요. 연결된 계획은 유지돼요.'
                    : 'Delete this memory and photos not used elsewhere? This cannot be undone. The linked plan is kept.'}
                </p>
                <div className="action-row">
                  <button
                    type="button"
                    className="btn btn-soft"
                    disabled={busy}
                    onClick={() => open('detail')}
                  >
                    {ko ? '취소' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary danger"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    {busy
                      ? ko
                        ? '삭제 중…'
                        : 'Deleting…'
                      : ko
                        ? '기록 삭제 확인'
                        : 'Confirm deletion'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Sheet>
      }
    </>
  );
}

function RecordPhotos({ record, onView }: { record: RecordSummary; onView: (id: string) => void }) {
  const ko = useLocale() === 'ko';
  return (
    <div className="record-detail-photos">
      {record.experience.assetIds?.map((id, index) => (
        <button
          type="button"
          key={`${record.packId}:${id}`}
          onClick={() => onView(id)}
          aria-label={ko ? `사진 ${index + 1} 크게 보기` : `View photo ${index + 1}`}
        >
          <AssetImage packId={record.packId} assetId={id} className="record-detail-photo" alt="" />
        </button>
      ))}
    </div>
  );
}
function PhotoSelection({
  files,
  onRemove,
  onReady,
  disabled,
}: {
  files: File[];
  onRemove: (index: number) => void;
  onReady: (file: File) => void;
  disabled: boolean;
}) {
  return (
    <div className="photo-selection">
      {files.map((file, index) => (
        <SelectedPhoto
          key={`${file.name}:${file.lastModified}:${index}`}
          file={file}
          onReady={() => onReady(file)}
          onRemove={() => onRemove(index)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
function SelectedPhoto({
  file,
  onRemove,
  onReady,
  disabled,
}: {
  file: File;
  onRemove: () => void;
  onReady: () => void;
  disabled: boolean;
}) {
  const ko = useLocale() === 'ko';
  const [url, setUrl] = useState('');
  const [broken, setBroken] = useState(false);
  const problem = photoProblem(file);
  useEffect(() => {
    if (problem) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    setBroken(false);
    return () => URL.revokeObjectURL(next);
  }, [file, problem]);
  return (
    <figure className="photo-choice">
      {!problem && url && !broken && (
        <img
          src={url}
          className="photo-preview"
          alt={file.name}
          onLoad={onReady}
          onError={() => setBroken(true)}
        />
      )}
      <figcaption>{file.name}</figcaption>
      {(problem || broken) && (
        <p className="form-error">
          {problem === 'heic'
            ? ko
              ? 'HEIC 원본은 지원하지 않아요. JPEG로 변환한 후 다시 선택하세요.'
              : 'Original HEIC is not supported. Convert to JPEG and choose again.'
            : problem === 'empty'
              ? ko
                ? '빈 파일이에요. 다른 사진을 선택하세요.'
                : 'This file is empty. Choose another photo.'
              : broken
                ? ko
                  ? '미리보기를 표시하지 못했어요. 파일을 확인하거나 제외하세요.'
                  : 'Preview unavailable. Check this file or remove it.'
                : ko
                  ? '지원하지 않는 사진 형식이에요. 이 파일을 제외하고 다시 선택하세요.'
                  : 'Unsupported image format. Remove this file and choose another.'}
        </p>
      )}
      <button type="button" className="text-action" disabled={disabled} onClick={onRemove}>
        {ko ? '사진 제외' : 'Remove photo'}
      </button>
    </figure>
  );
}
