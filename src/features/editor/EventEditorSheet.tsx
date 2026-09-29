import { useMemo, useRef, useState } from 'react';
import type {
  DateEvent,
  DateEventType,
  DatePlan,
  EventTiming,
  Importance,
  LocalPoint,
  ProtectedField,
} from '@datepack/core';
import {
  createEvent,
  DATE_EVENT_TYPES,
  isValidTime,
  localPointMinutes,
  normalizeTime,
} from '@datepack/core';
import {
  addEventAssets,
  removeAsset,
  showToast,
  undo,
  updatePlan,
} from '../../store/datepackStore';
import { AssetImage } from '../../components/AssetImage';
import { Sheet } from '../../components/Sheet';
import { eventTypeLabel, format, useLocale } from '../../i18n';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, PlusIcon, TrashIcon } from '../../components/icons';

type Props = { plan: DatePlan; event: DateEvent | null; onClose: () => void };
type TimingMode = EventTiming['kind'];
const point = (time: string, dayOffset: 0 | 1): LocalPoint => ({ time, dayOffset });

export function EventEditorSheet({ plan, event, onClose }: Props) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const [title, setTitle] = useState(event?.title ?? '');
  const [type, setType] = useState<DateEventType>(event?.type ?? 'place');
  const [timingMode, setTimingMode] = useState<TimingMode>(event?.timing.kind ?? 'unscheduled');
  const [start, setStart] = useState(
    event?.timing.kind === 'exact'
      ? event.timing.start.time
      : event?.timing.kind === 'window'
        ? event.timing.earliestStart.time
        : '',
  );
  const [end, setEnd] = useState(
    event?.timing.kind === 'exact' ? (event.timing.end?.time ?? '') : '',
  );
  const [latest, setLatest] = useState(
    event?.timing.kind === 'window' ? event.timing.latestStart.time : '',
  );
  const [latestDay, setLatestDay] = useState<0 | 1>(
    event?.timing.kind === 'window' ? event.timing.latestStart.dayOffset : 0,
  );
  const [startDay, setStartDay] = useState<0 | 1>(
    event?.timing.kind === 'exact'
      ? event.timing.start.dayOffset
      : event?.timing.kind === 'window'
        ? event.timing.earliestStart.dayOffset
        : 0,
  );
  const [endDay, setEndDay] = useState<0 | 1>(
    event?.timing.kind === 'exact' ? (event.timing.end?.dayOffset ?? 0) : 0,
  );
  const [label, setLabel] = useState(
    event?.timing.kind === 'unscheduled' ? (event.timing.label ?? '') : '',
  );
  const [placeName, setPlaceName] = useState(
    event?.placeId ? (plan.places?.find((p) => p.id === event.placeId)?.name ?? '') : '',
  );
  const [note, setNote] = useState(event?.note ?? '');
  const [importance, setImportance] = useState<Importance>(event?.importance ?? 'normal');
  const [protectedFields, setProtectedFields] = useState<ProtectedField[]>(
    event?.protectedFields ?? [],
  );
  const [bTrigger, setBTrigger] = useState(event?.planB?.trigger ?? '');
  const [bTitle, setBTitle] = useState(event?.planB?.title ?? '');
  const [bNote, setBNote] = useState(event?.planB?.note ?? '');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const latestRef = useRef<HTMLInputElement>(null);
  const startDayRef = useRef<HTMLSelectElement>(null);
  const endDayRef = useRef<HTMLSelectElement>(null);
  const latestDayRef = useRef<HTMLSelectElement>(null);
  const places = useMemo(() => plan.places ?? [], [plan.places]);
  const index = plan.events.findIndex((item) => item.id === event?.id);
  const L = ko
    ? {
        add: '활동 추가',
        edit: '활동 편집',
        name: '이름',
        type: '종류',
        timing: '시간 정하기',
        exact: '정확한 시간',
        window: '시작 가능 시간대',
        unscheduled: '아직 미정',
        start: '시작',
        end: '종료 (선택)',
        latest: '늦어도 이때 시작',
        day: '다음 날',
        label: '시간 메모',
        labelPh: '예: 점심 이후',
        place: '장소',
        note: '메모',
        importance: '중요도',
        core: '꼭 하고 싶어요',
        normal: '보통',
        optional: '여유 있으면',
        protect: 'AI 변경 보호',
        protections: {
          time: '시간',
          place: '장소',
          content: '내용',
          delete: '삭제',
          order: '순서',
        },
        planB: 'Plan B',
        trigger: '언제 바꿀까요?',
        bTitle: '대신 할 일',
        bNote: '메모',
        save: '저장',
        remove: '삭제',
        up: '앞으로 이동',
        down: '뒤로 이동',
        invalid: '시간을 확인해주세요. 종료는 시작 뒤에 있어야 해요.',
        dayHelp: '시간이 자정을 넘으면 다음 날을 선택하세요.',
        outsideWindow: '데이트 가능 시간대를 벗어난 일정이에요.',
      }
    : {
        add: 'Add activity',
        edit: 'Edit activity',
        name: 'Name',
        type: 'Type',
        timing: 'Timing',
        exact: 'Exact time',
        window: 'Start window',
        unscheduled: 'Unscheduled',
        start: 'Start',
        end: 'End (optional)',
        latest: 'Latest start',
        day: 'Next day',
        label: 'Timing note',
        labelPh: 'e.g. after lunch',
        place: 'Place',
        note: 'Note',
        importance: 'Importance',
        core: 'Want to keep',
        normal: 'Flexible',
        optional: 'If there’s time',
        protect: 'Protect from AI changes',
        protections: {
          time: 'Time',
          place: 'Place',
          content: 'Details',
          delete: 'Removal',
          order: 'Order',
        },
        planB: 'Plan B',
        trigger: 'When to switch?',
        bTitle: 'Alternative',
        bNote: 'Note',
        save: 'Save',
        remove: 'Delete',
        up: 'Move earlier',
        down: 'Move later',
        invalid: 'Check the times. The end must be after the start.',
        dayHelp: 'Choose next day when a time crosses midnight.',
        outsideWindow: 'This activity falls outside the date’s available time.',
      };

  function save() {
    const startValue = startRef.current ? startRef.current.value : start;
    const endValue = endRef.current ? endRef.current.value : end;
    const latestValue = latestRef.current ? latestRef.current.value : latest;
    const startOffset = (startDayRef.current ? Number(startDayRef.current.value) : startDay) as
      | 0
      | 1;
    const endOffset = (endDayRef.current ? Number(endDayRef.current.value) : endDay) as 0 | 1;
    const latestOffset = (latestDayRef.current ? Number(latestDayRef.current.value) : latestDay) as
      | 0
      | 1;
    if (!title.trim()) return setError(ko ? '이름을 입력해주세요.' : 'Give this activity a name.');
    const valid =
      timingMode === 'unscheduled' ||
      (isValidTime(startValue) &&
        (timingMode !== 'window' || isValidTime(latestValue)) &&
        (timingMode !== 'exact' || !endValue || isValidTime(endValue)));
    const timing: EventTiming =
      timingMode === 'unscheduled'
        ? { kind: 'unscheduled', ...(label.trim() ? { label: label.trim() } : {}) }
        : timingMode === 'window'
          ? {
              kind: 'window',
              earliestStart: point(normalizeTime(startValue), startOffset),
              latestStart: point(normalizeTime(latestValue), latestOffset),
            }
          : {
              kind: 'exact',
              start: point(normalizeTime(startValue), startOffset),
              ...(endValue ? { end: point(normalizeTime(endValue), endOffset) } : {}),
            };
    const startMins =
      timing.kind === 'exact'
        ? timing.start.dayOffset * 1440 +
          Number(startValue.slice(0, 2)) * 60 +
          Number(startValue.slice(3))
        : 0;
    const endMins =
      timing.kind === 'exact' && endValue
        ? endOffset * 1440 + Number(endValue.slice(0, 2)) * 60 + Number(endValue.slice(3))
        : Infinity;
    const latestMins =
      latestOffset * 1440 + Number(latestValue.slice(0, 2)) * 60 + Number(latestValue.slice(3));
    if (!valid || endMins <= startMins || (timingMode === 'window' && latestMins < startMins))
      return setError(L.invalid);
    const timedStart =
      timing.kind === 'exact'
        ? localPointMinutes(timing.start)!
        : timing.kind === 'window'
          ? localPointMinutes(timing.earliestStart)!
          : null;
    const timedLatest =
      timing.kind === 'exact'
        ? localPointMinutes(timing.end ?? timing.start)!
        : timing.kind === 'window'
          ? localPointMinutes(timing.latestStart)!
          : null;
    const availableFrom = plan.availableFrom ? localPointMinutes(plan.availableFrom)! : null;
    const mustEndBy = plan.mustEndBy ? localPointMinutes(plan.mustEndBy)! : null;
    if (
      (timedStart !== null && availableFrom !== null && timedStart < availableFrom) ||
      (timedLatest !== null && mustEndBy !== null && timedLatest > mustEndBy)
    )
      return setError(L.outsideWindow);
    let placeId: string | undefined;
    updatePlan(
      ko ? (event ? '활동 수정' : '활동 추가') : event ? 'Edit activity' : 'Add activity',
      (draft) => {
        if (placeName.trim()) {
          let place = draft.places?.find((p) => p.name === placeName.trim());
          if (!place) {
            place = {
              id: `place-${crypto.randomUUID()}`,
              name: placeName.trim(),
              mapQuery: placeName.trim(),
            };
            draft.places = [...(draft.places ?? []), place];
          }
          placeId = place.id;
        }
        const next = createEvent({
          ...(event ?? {}),
          title: title.trim(),
          type,
          timing,
          placeId,
          note: note.trim() || undefined,
          importance,
          protectedFields,
          planB: bTitle.trim()
            ? {
                trigger: bTrigger.trim() || undefined,
                title: bTitle.trim(),
                note: bNote.trim() || undefined,
              }
            : undefined,
          order: event?.order ?? draft.events.length,
        });
        if (event) draft.events = draft.events.map((item) => (item.id === event.id ? next : item));
        else draft.events.push(next);
        draft.events.sort((a, b) => a.order - b.order);
        return draft;
      },
    );
    onClose();
  }

  function move(delta: -1 | 1) {
    if (!event) return;
    updatePlan(ko ? '활동 순서 변경' : 'Reorder activities', (draft) => {
      const ordered = [...draft.events].sort((a, b) => a.order - b.order);
      const from = ordered.findIndex((item) => item.id === event.id),
        to = from + delta;
      if (to < 0 || to >= ordered.length) return draft;
      const [item] = ordered.splice(from, 1);
      ordered.splice(to, 0, item);
      draft.events = ordered.map((activity, order) => ({ ...activity, order }));
      return draft;
    });
  }

  function remove() {
    if (!event) return;
    updatePlan(ko ? '활동 삭제' : 'Delete activity', (draft) => {
      draft.events = draft.events
        .filter((item) => item.id !== event.id)
        .map((item, order) => ({ ...item, order }));
      return draft;
    });
    onClose();
    showToast(ko ? `‘${event.title}’ 삭제됨` : `Deleted “${event.title}”`, {
      label: ko ? '되돌리기' : 'Undo',
      onClick: () => undo(),
    });
  }

  const checkbox = (field: ProtectedField) => (
    <label className="check-row" key={field}>
      <input
        type="checkbox"
        checked={protectedFields.includes(field)}
        onChange={(e) =>
          setProtectedFields((value) =>
            e.target.checked ? [...value, field] : value.filter((x) => x !== field),
          )
        }
      />
      {L.protections[field]}
    </label>
  );
  return (
    <Sheet open title={event ? L.edit : L.add} onClose={onClose}>
      <div className="form">
        <label className="field">
          <span>{L.name}</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field">
          <span>{L.type}</span>
          <div className="chip-row wrap">
            {DATE_EVENT_TYPES.map((value) => (
              <button
                type="button"
                key={value}
                className={`chip chip-btn${type === value ? ' chip-selected' : ''}`}
                aria-pressed={type === value}
                onClick={() => setType(value)}
              >
                {eventTypeLabel(locale, value)}
              </button>
            ))}
          </div>
        </div>
        <fieldset className="fieldset">
          <legend>{L.timing}</legend>
          <div className="chip-row wrap">
            {(['exact', 'window', 'unscheduled'] as TimingMode[]).map((value) => (
              <button
                type="button"
                key={value}
                className={`chip chip-btn${timingMode === value ? ' chip-selected' : ''}`}
                aria-pressed={timingMode === value}
                onClick={() => setTimingMode(value)}
              >
                {value === 'unscheduled'
                  ? format(locale, 'p3.editor.timing.unscheduled')
                  : L[value]}
              </button>
            ))}
          </div>
        </fieldset>
        {timingMode !== 'unscheduled' ? (
          <>
            <div className="field-row">
              <label className="field">
                <span>
                  {timingMode === 'window' ? (ko ? '가장 이른 시작' : 'Earliest start') : L.start}
                </span>
                <input
                  ref={startRef}
                  type="time"
                  defaultValue={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </label>
              {timingMode === 'exact' ? (
                <label className="field">
                  <span>{L.end}</span>
                  <input
                    ref={endRef}
                    type="time"
                    defaultValue={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              ) : (
                <label className="field">
                  <span>{L.latest}</span>
                  <input
                    ref={latestRef}
                    type="time"
                    defaultValue={latest}
                    onChange={(e) => setLatest(e.target.value)}
                    required
                  />
                </label>
              )}
            </div>
            <div className="field-row">
              <label className="field">
                <span>{ko ? '시작 날짜' : 'Start day'}</span>
                <select
                  ref={startDayRef}
                  defaultValue={startDay}
                  onChange={(e) => setStartDay(Number(e.target.value) as 0 | 1)}
                >
                  <option value={0}>{ko ? '데이트 날짜' : 'Date day'}</option>
                  <option value={1}>{L.day}</option>
                </select>
              </label>
              {timingMode === 'exact' && (
                <label className="field">
                  <span>{ko ? '종료 날짜' : 'End day'}</span>
                  <select
                    ref={endDayRef}
                    defaultValue={endDay}
                    onChange={(e) => setEndDay(Number(e.target.value) as 0 | 1)}
                  >
                    <option value={0}>{ko ? '데이트 날짜' : 'Date day'}</option>
                    <option value={1}>{L.day}</option>
                  </select>
                </label>
              )}
              {timingMode === 'window' && (
                <label className="field">
                  <span>{ko ? '늦어도 시작하는 날짜' : 'Latest start day'}</span>
                  <select
                    ref={latestDayRef}
                    defaultValue={latestDay}
                    onChange={(e) => setLatestDay(Number(e.target.value) as 0 | 1)}
                  >
                    <option value={0}>{ko ? '데이트 날짜' : 'Date day'}</option>
                    <option value={1}>{L.day}</option>
                  </select>
                </label>
              )}
            </div>
            <p className="hint-text">{L.dayHelp}</p>
          </>
        ) : (
          <label className="field">
            <span>{L.label}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={L.labelPh}
            />
          </label>
        )}
        <label className="field">
          <span>{L.place}</span>
          <input
            list="plan-places"
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
          />
          <datalist id="plan-places">
            {places.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>{L.note}</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <fieldset className="fieldset">
          <legend>{format(locale, 'p3.editor.core')}</legend>
          <div className="chip-row wrap">
            {(['core', 'normal', 'optional'] as Importance[]).map((value) => (
              <button
                type="button"
                key={value}
                className={`chip chip-btn${importance === value ? ' chip-selected' : ''}`}
                aria-pressed={importance === value}
                onClick={() => setImportance(value)}
              >
                {format(
                  locale,
                  `p3.editor.${value}` as
                    | 'p3.editor.core'
                    | 'p3.editor.normal'
                    | 'p3.editor.optional',
                )}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend>{format(locale, 'p3.editor.protected')}</legend>
          <div className="check-grid">
            {(['time', 'place', 'content', 'delete', 'order'] as ProtectedField[]).map(checkbox)}
          </div>
        </fieldset>
        <div className="divider" />
        <p className="eyebrow">{L.planB}</p>
        <label className="field">
          <span>{L.trigger}</span>
          <input value={bTrigger} onChange={(e) => setBTrigger(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.bTitle}</span>
          <input value={bTitle} onChange={(e) => setBTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.bNote}</span>
          <textarea rows={2} value={bNote} onChange={(e) => setBNote(e.target.value)} />
        </label>
        {event && (
          <div className="field">
            <span>{ko ? '사진' : 'Photos'}</span>
            <div className="thumb-row">
              {(event.assetIds ?? []).map((id) => (
                <button
                  key={id}
                  type="button"
                  className="thumb"
                  onClick={() => void removeAsset(id)}
                  aria-label={ko ? '사진 삭제' : 'Remove photo'}
                >
                  <AssetImage packId={plan.id} assetId={id} className="thumb-img" alt="" />
                </button>
              ))}
              <button
                type="button"
                className="thumb thumb-add"
                onClick={() => fileRef.current?.click()}
                aria-label={ko ? '사진 추가' : 'Add photo'}
              >
                <PlusIcon width={20} height={20} />
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files && event) void addEventAssets(event.id, e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-footer">
          {event && (
            <>
              <button type="button" className="btn btn-danger-ghost" onClick={remove}>
                <TrashIcon width={16} height={16} />
                {L.remove}
              </button>
              <button
                type="button"
                className="icon-btn framed"
                onClick={() => move(-1)}
                disabled={index <= 0}
                aria-label={L.up}
              >
                <ArrowUpIcon width={16} height={16} />
              </button>
              <button
                type="button"
                className="icon-btn framed"
                onClick={() => move(1)}
                disabled={index < 0 || index >= plan.events.length - 1}
                aria-label={L.down}
              >
                <ArrowDownIcon width={16} height={16} />
              </button>
            </>
          )}
          <button type="button" className="btn btn-primary grow" onClick={save}>
            <CheckIcon width={16} height={16} />
            {L.save}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
