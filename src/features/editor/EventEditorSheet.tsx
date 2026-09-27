import { useMemo, useRef, useState } from 'react';
import type { DateEvent, DateEventType, DatePlan } from '../../datepack/types';
import { DATE_EVENT_TYPES } from '../../datepack/types';
import { createEvent } from '../../datepack/create';
import {
  updatePlan,
  addEventAssets,
  removeAsset,
  showToast,
  undo,
} from '../../store/datepackStore';
import { isValidTime, normalizeTime, parseTime } from '../../utils/time';
import { AssetImage } from '../../components/AssetImage';
import { Sheet } from '../../components/Sheet';
import { eventTypeLabel, useLocale } from '../../i18n';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, PlusIcon, TrashIcon } from '../../components/icons';

type Props = {
  plan: DatePlan;
  /** Existing event to edit, or null to create a new one. */
  event: DateEvent | null;
  onClose: () => void;
};

function roundNowTo5(): string {
  const now = new Date();
  const minutes = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function EventEditorSheet({ plan, event, onClose }: Props) {
  const locale = useLocale();
  const isNew = event === null;
  const [title, setTitle] = useState(event?.title ?? '');
  const [start, setStart] = useState(event?.start ?? roundNowTo5());
  const [end, setEnd] = useState(event?.end ?? '');
  const [type, setType] = useState<DateEventType>(event?.type ?? 'place');
  const [placeName, setPlaceName] = useState(
    event?.placeId ? (plan.places?.find((p) => p.id === event.placeId)?.name ?? '') : '',
  );
  const [travelMinutes, setTravelMinutes] = useState(event?.travelMinutes?.toString() ?? '');
  const [note, setNote] = useState(event?.note ?? '');
  const [fixed, setFixed] = useState(event?.fixed ?? false);
  const [bTrigger, setBTrigger] = useState(event?.planB?.trigger ?? '');
  const [bTitle, setBTitle] = useState(event?.planB?.title ?? '');
  const [bNote, setBNote] = useState(event?.planB?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const assetIds = event?.assetIds ?? [];
  const placeOptions = useMemo(() => plan.places?.map((p) => p.name) ?? [], [plan.places]);
  const index = event ? plan.events.findIndex((e) => e.id === event.id) : -1;

  function save(): void {
    if (!title.trim()) {
      setError(locale === 'ko' ? '일정 이름을 입력해주세요.' : 'Give this stop a name.');
      return;
    }
    if (!isValidTime(start)) {
      setError(
        locale === 'ko'
          ? '시작 시간은 HH:mm 형식으로 입력해주세요.'
          : 'Start time must be in HH:mm format.',
      );
      return;
    }
    if (end && !isValidTime(end)) {
      setError(
        locale === 'ko'
          ? '종료 시간은 HH:mm 형식으로 입력해주세요.'
          : 'End time must be in HH:mm format.',
      );
      return;
    }
    if (end && isValidTime(end) && (parseTime(end) ?? 0) <= (parseTime(start) ?? 0)) {
      setError(
        locale === 'ko'
          ? '종료 시간이 시작보다 빠르거나 같아요. 시작 이후로 입력해주세요.'
          : "End can't be at or before the start.",
      );
      return;
    }

    // "9:30" is a valid time — store it canonically so string sorts stay correct.
    const normalizedStart = normalizeTime(start);
    const normalizedEnd = end && isValidTime(end) ? normalizeTime(end) : undefined;

    let travel: number | undefined;
    if (travelMinutes.trim()) {
      const parsed = Number(travelMinutes);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError(
          locale === 'ko'
            ? '이동 시간은 0 이상의 숫자로 입력해주세요.'
            : 'Travel time must be a number, 0 or more.',
        );
        return;
      }
      travel = Math.round(parsed);
    }

    updatePlan(
      locale === 'ko' ? (isNew ? '일정 추가' : '일정 수정') : isNew ? 'Add a stop' : 'Edit stop',
      (draft) => {
        // Resolve place: reuse existing place by name, or create one.
        let placeId: string | undefined;
        if (placeName.trim()) {
          const existing = draft.places?.find((p) => p.name === placeName.trim());
          if (existing) {
            placeId = existing.id;
          } else {
            const created = {
              id: `place-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              name: placeName.trim(),
              mapQuery: placeName.trim(),
            };
            draft.places = [...(draft.places ?? []), created];
            placeId = created.id;
          }
        }

        const planB =
          bTitle.trim() || bTrigger.trim() || bNote.trim()
            ? {
                trigger: bTrigger.trim() || undefined,
                title: bTitle.trim() || 'Plan B',
                note: bNote.trim() || undefined,
              }
            : undefined;

        const next: DateEvent = {
          ...(event ?? createEvent({ title: title.trim(), start: normalizedStart })),
          title: title.trim(),
          start: normalizedStart,
          end: normalizedEnd,
          type,
          placeId,
          note: note.trim() || undefined,
          travelMinutes: travel,
          fixed,
          planB,
        };

        if (isNew) {
          // Insert sorted by start time (numeric, not string comparison).
          const insertAt = draft.events.findIndex(
            (e) => (parseTime(e.start) ?? 0) > (parseTime(next.start) ?? 0),
          );
          if (insertAt === -1) draft.events.push(next);
          else draft.events.splice(insertAt, 0, next);
        } else {
          const i = draft.events.findIndex((e) => e.id === event!.id);
          draft.events[i] = next;
        }
        return draft;
      },
    );
    onClose();
  }

  function remove(): void {
    if (!event) return;
    const removedTitle = event.title;
    updatePlan(locale === 'ko' ? '일정 삭제' : 'Delete stop', (draft) => {
      draft.events = draft.events.filter((e) => e.id !== event.id);
      return draft;
    });
    onClose();
    showToast(
      locale === 'ko' ? `'${removedTitle}' 일정을 삭제했어요.` : `Deleted '${removedTitle}'.`,
      { label: locale === 'ko' ? '되돌리기' : 'Undo', onClick: () => undo() },
    );
  }

  function move(delta: -1 | 1): void {
    if (!event) return;
    updatePlan(locale === 'ko' ? '일정 순서 변경' : 'Reorder stops', (draft) => {
      const from = draft.events.findIndex((e) => e.id === event.id);
      const to = from + delta;
      if (to < 0 || to >= draft.events.length) return draft;
      const [item] = draft.events.splice(from, 1);
      draft.events.splice(to, 0, item);
      return draft;
    });
  }

  const L = locale === 'ko' ? koLabels : enLabels;

  return (
    <Sheet open title={isNew ? L.newTitle : L.editTitle} onClose={onClose}>
      <div className="form">
        <label className="field">
          <span>{L.name}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={L.namePh} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>{L.start}</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>{L.end}</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <div className="field">
          <span>{L.kind}</span>
          <div className="chip-row wrap">
            {DATE_EVENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip chip-btn ${type === t ? 'chip-selected' : ''}`}
                onClick={() => setType(t)}
              >
                {eventTypeLabel(locale, t)}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>{L.place}</span>
          <input
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            placeholder={L.placePh}
            list="place-options"
          />
          <datalist id="place-options">
            {placeOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>

        <div className="field-row">
          <label className="field">
            <span>{L.travel}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={travelMinutes}
              onChange={(e) => setTravelMinutes(e.target.value)}
              placeholder={L.travelPh}
            />
          </label>
          <label className="field checkbox-field">
            <span>{L.fixed}</span>
            <button
              type="button"
              className={`toggle ${fixed ? 'on' : ''}`}
              onClick={() => setFixed(!fixed)}
              aria-pressed={fixed}
            >
              <span className="toggle-knob" />
            </button>
          </label>
        </div>

        <label className="field">
          <span>{L.note}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={L.notePh}
          />
        </label>

        {!isNew && (
          <div className="field">
            <span>{L.photos}</span>
            <div className="thumb-row">
              {assetIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="thumb"
                  onClick={() => void removeAsset(id)}
                  aria-label={L.photoRemove}
                >
                  <AssetImage packId={plan.id} assetId={id} className="thumb-img" />
                  <span className="thumb-x">×</span>
                </button>
              ))}
              <button
                type="button"
                className="thumb thumb-add"
                onClick={() => fileRef.current?.click()}
              >
                <PlusIcon width={20} height={20} />
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files && event) void addEventAssets(event.id, e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}

        <div className="divider" />
        <p className="eyebrow">{L.planbEyebrow}</p>
        <label className="field">
          <span>{L.planbTrigger}</span>
          <input
            value={bTrigger}
            onChange={(e) => setBTrigger(e.target.value)}
            placeholder={L.planbTriggerPh}
          />
        </label>
        <label className="field">
          <span>{L.planbTitle}</span>
          <input
            value={bTitle}
            onChange={(e) => setBTitle(e.target.value)}
            placeholder={L.planbTitlePh}
          />
        </label>
        <label className="field">
          <span>{L.planbNote}</span>
          <textarea
            value={bNote}
            onChange={(e) => setBNote(e.target.value)}
            rows={2}
            placeholder={L.planbNotePh}
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="sheet-footer">
          {!isNew && (
            <>
              <button type="button" className="btn btn-danger-ghost" onClick={remove}>
                <TrashIcon width={16} height={16} /> {L.delete}
              </button>
              <button
                type="button"
                className="icon-btn framed"
                onClick={() => move(-1)}
                disabled={index <= 0}
                aria-label={L.moveUp}
              >
                <ArrowUpIcon width={16} height={16} />
              </button>
              <button
                type="button"
                className="icon-btn framed"
                onClick={() => move(1)}
                disabled={index === plan.events.length - 1}
                aria-label={L.moveDown}
              >
                <ArrowDownIcon width={16} height={16} />
              </button>
            </>
          )}
          <button type="button" className="btn btn-primary grow" onClick={save}>
            <CheckIcon width={16} height={16} /> {L.save}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

const koLabels = {
  newTitle: '일정 추가',
  editTitle: '일정 편집',
  name: '일정 이름',
  namePh: '예: 저녁 식사',
  start: '시작',
  end: '종료 (선택)',
  kind: '종류',
  place: '장소 (선택)',
  placePh: '예: 한강공원',
  travel: '이동 시간(분)',
  travelPh: '9',
  fixed: '고정 일정',
  note: '메모 (선택)',
  notePh: '예: 포장해서 가기',
  photos: '사진',
  photoRemove: '사진 삭제',
  planbEyebrow: 'Plan B (선택)',
  planbTrigger: '언제 발동하나요?',
  planbTriggerPh: '예: 줄이 너무 길 때',
  planbTitle: '그때 뭘 하나요?',
  planbTitlePh: '예: 지금은 건너뛰기',
  planbNote: '메모',
  planbNotePh: '예: 15:30에 다시 방문해요',
  delete: '삭제',
  moveUp: '위로 이동',
  moveDown: '아래로 이동',
  save: '저장',
};

const enLabels = {
  newTitle: 'Add a stop',
  editTitle: 'Edit stop',
  name: 'Stop name',
  namePh: 'e.g. Dinner',
  start: 'Start',
  end: 'End (optional)',
  kind: 'Kind',
  place: 'Place (optional)',
  placePh: 'e.g. Riverside park',
  travel: 'Travel time (min)',
  travelPh: '9',
  fixed: 'Locked for AI',
  note: 'Note (optional)',
  notePh: 'e.g. get it to go',
  photos: 'Photos',
  photoRemove: 'Remove photo',
  planbEyebrow: 'Plan B (optional)',
  planbTrigger: 'When does it kick in?',
  planbTriggerPh: 'e.g. the line is out the door',
  planbTitle: "What's plan B?",
  planbTitlePh: 'e.g. skip it for now',
  planbNote: 'Note',
  planbNotePh: 'e.g. swing back at 15:30',
  delete: 'Delete',
  moveUp: 'Move earlier',
  moveDown: 'Move later',
  save: 'Save',
};
