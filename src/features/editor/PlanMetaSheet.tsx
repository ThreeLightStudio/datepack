import { useRef, useState } from 'react';
import type { DatePlan, LocalPoint } from '@datepack/core';
import { isValidDateISO, isValidTime } from '@datepack/core';
import type { PersonalJourney } from '../../storage/indexedDb';
import { updatePersonalJourney, updatePlan, useStore } from '../../store/datepackStore';
import { Sheet } from '../../components/Sheet';
import { CheckIcon } from '../../components/icons';
import { format, useLocale } from '../../i18n';

type Props = { plan: DatePlan; personalJourney?: PersonalJourney | null; onClose: () => void };
const hhmm = (point?: LocalPoint) => point?.time ?? '';

export function PlanMetaSheet({ plan, personalJourney, onClose }: Props) {
  const locale = useLocale();
  const { pack } = useStore();
  const documentId = pack?.id ?? plan.id;
  const ko = locale === 'ko';
  const [title, setTitle] = useState(plan.title);
  const [date, setDate] = useState(plan.date ?? '');
  const [memo, setMemo] = useState(plan.memo ?? '');
  const [availableFrom, setAvailableFrom] = useState(hhmm(plan.availableFrom));
  const availableFromRef = useRef<HTMLInputElement>(null);
  const [fromDay, setFromDay] = useState<0 | 1>(plan.availableFrom?.dayOffset ?? 0);
  const [mustEndBy, setMustEndBy] = useState(hhmm(plan.mustEndBy));
  const mustEndByRef = useRef<HTMLInputElement>(null);
  const [toDay, setToDay] = useState<0 | 1>(plan.mustEndBy?.dayOffset ?? 0);
  const [meetingName, setMeetingName] = useState(
    plan.meeting?.placeId
      ? (plan.places?.find((p) => p.id === plan.meeting?.placeId)?.name ?? '')
      : '',
  );
  const [meetingNote, setMeetingNote] = useState(plan.meeting?.locationNote ?? '');
  const [meetingTime, setMeetingTime] = useState(
    plan.meeting?.timing?.kind === 'exact' ? plan.meeting.timing.start.time : '',
  );
  const [journeyOrigin, setJourneyOrigin] = useState(personalJourney?.origin ?? '');
  const [journeyMode, setJourneyMode] = useState(personalJourney?.mode ?? '');
  const [journeyNote, setJourneyNote] = useState(personalJourney?.note ?? '');
  const [must, setMust] = useState((plan.constraints?.must ?? []).join('\n'));
  const [prefer, setPrefer] = useState((plan.constraints?.prefer ?? []).join('\n'));
  const [avoid, setAvoid] = useState((plan.constraints?.avoid ?? []).join('\n'));
  const [error, setError] = useState('');
  const L = ko
    ? {
        title: '데이트 정보',
        name: '데이트 이름',
        date: '날짜 (선택)',
        memo: '메모',
        from: '만날 수 있는 시간',
        until: '데이트 마감 시간 (선택)',
        first: '만나는 장소',
        meetNote: '지점·만남 메모',
        meetTime: '만남 시간 (선택)',
        journey: '내 이동 메모 · 이 기기에만 저장',
        origin: '출발지 (선택)',
        mode: '이동 방법',
        journeyNote: '예상 시간이나 참고 메모',
        must: '꼭 지킬 것 · 줄마다 하나',
        prefer: '하고 싶은 것',
        avoid: '피하고 싶은 것',
        nextDay: '다음 날',
        baseDay: '데이트 날짜',
        save: '저장',
        err: '이름, 날짜, 시간을 확인해주세요.',
        privacy: format(locale, 'p3.journey.privacy'),
      }
    : {
        title: 'Date details',
        name: 'Date name',
        date: 'Date (optional)',
        memo: 'Note',
        from: 'Available from',
        until: 'Must wrap by (optional)',
        first: 'Meet at',
        meetNote: 'Meeting point details',
        meetTime: 'Meeting time (optional)',
        journey: 'My travel · saved on this device',
        origin: 'Starting place (optional)',
        mode: 'How I’ll get there',
        journeyNote: 'Travel estimate or note',
        must: 'Must keep · one per line',
        prefer: 'Would like to do',
        avoid: 'Would rather skip',
        nextDay: 'Next day',
        baseDay: 'Date day',
        save: 'Save',
        err: 'Check the name, date, and times.',
        privacy: format(locale, 'p3.journey.privacy'),
      };
  const lines = (value: string) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  function save() {
    const startTime = availableFromRef.current ? availableFromRef.current.value : availableFrom;
    const endTime = mustEndByRef.current ? mustEndByRef.current.value : mustEndBy;
    const startMinutes = startTime
      ? fromDay * 1440 + Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3))
      : null;
    const endMinutes = endTime
      ? toDay * 1440 + Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3))
      : null;
    if (
      !title.trim() ||
      (date && !isValidDateISO(date)) ||
      (startTime && !isValidTime(startTime)) ||
      (endTime && !isValidTime(endTime)) ||
      (meetingTime && !isValidTime(meetingTime)) ||
      (startMinutes !== null && endMinutes !== null && endMinutes < startMinutes)
    ) {
      setError(L.err);
      return;
    }
    updatePlan(ko ? '데이트 정보 수정' : 'Edit date details', (draft) => {
      draft.title = title.trim();
      draft.date = date || undefined;
      draft.memo = memo.trim() || undefined;
      draft.availableFrom = startTime ? { time: startTime, dayOffset: fromDay } : undefined;
      draft.mustEndBy = endTime ? { time: endTime, dayOffset: toDay } : undefined;
      draft.constraints = { must: lines(must), prefer: lines(prefer), avoid: lines(avoid) };
      if (meetingName.trim()) {
        let place = draft.places?.find((p) => p.name === meetingName.trim());
        if (!place) {
          place = {
            id: `place-${crypto.randomUUID()}`,
            name: meetingName.trim(),
            mapQuery: meetingName.trim(),
          };
          draft.places = [...(draft.places ?? []), place];
        }
        draft.meeting = {
          placeId: place.id,
          locationNote: meetingNote.trim() || undefined,
          timing: meetingTime
            ? { kind: 'exact', start: { time: meetingTime, dayOffset: 0 } }
            : undefined,
        };
      } else draft.meeting = meetingNote.trim() ? { locationNote: meetingNote.trim() } : undefined;
      return draft;
    });
    void updatePersonalJourney(
      journeyOrigin.trim() || journeyMode.trim() || journeyNote.trim()
        ? {
            planId: documentId,
            updatedAt: new Date().toISOString(),
            origin: journeyOrigin.trim() || undefined,
            mode: journeyMode.trim() || undefined,
            note: journeyNote.trim() || undefined,
          }
        : undefined,
    );
    onClose();
  }
  return (
    <Sheet open title={L.title} onClose={onClose}>
      <div className="form">
        <label className="field">
          <span>{L.name}</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.date}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.memo}</span>
          <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <div className="divider" />
        <p className="eyebrow">{ko ? '가능한 시간대' : 'Time window'}</p>
        <div className="field-row">
          <label className="field">
            <span>{L.from}</span>
            <input
              ref={availableFromRef}
              type="time"
              value={availableFrom}
              onChange={(e) => setAvailableFrom(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{L.until}</span>
            <input
              ref={mustEndByRef}
              type="time"
              value={mustEndBy}
              onChange={(e) => setMustEndBy(e.target.value)}
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>{ko ? '시작 날짜' : 'Start day'}</span>
            <select value={fromDay} onChange={(e) => setFromDay(Number(e.target.value) as 0 | 1)}>
              <option value={0}>{L.baseDay}</option>
              <option value={1}>{L.nextDay}</option>
            </select>
          </label>
          <label className="field">
            <span>{ko ? '마감 날짜' : 'Wrap-up day'}</span>
            <select value={toDay} onChange={(e) => setToDay(Number(e.target.value) as 0 | 1)}>
              <option value={0}>{L.baseDay}</option>
              <option value={1}>{L.nextDay}</option>
            </select>
          </label>
        </div>
        <div className="divider" />
        <p className="eyebrow">{ko ? '합류' : 'Meeting up'}</p>
        <label className="field">
          <span>{L.first}</span>
          <input
            value={meetingName}
            onChange={(e) => setMeetingName(e.target.value)}
            placeholder={ko ? '예: 서울역 2번 출구' : 'e.g. North entrance'}
          />
        </label>
        <label className="field">
          <span>{L.meetNote}</span>
          <input value={meetingNote} onChange={(e) => setMeetingNote(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.meetTime}</span>
          <input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
        </label>
        <div className="divider" />
        <p className="eyebrow">{L.journey}</p>
        <p className="hint-text">{L.privacy}</p>
        <label className="field">
          <span>{L.origin}</span>
          <input value={journeyOrigin} onChange={(e) => setJourneyOrigin(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.mode}</span>
          <input value={journeyMode} onChange={(e) => setJourneyMode(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.journeyNote}</span>
          <input value={journeyNote} onChange={(e) => setJourneyNote(e.target.value)} />
        </label>
        <div className="divider" />
        <p className="eyebrow">{ko ? '데이트 약속' : 'Date preferences'}</p>
        <label className="field">
          <span>{L.must}</span>
          <textarea rows={2} value={must} onChange={(e) => setMust(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.prefer}</span>
          <textarea rows={2} value={prefer} onChange={(e) => setPrefer(e.target.value)} />
        </label>
        <label className="field">
          <span>{L.avoid}</span>
          <textarea rows={2} value={avoid} onChange={(e) => setAvoid(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-footer">
          <button type="button" className="btn btn-primary grow" onClick={save}>
            <CheckIcon width={16} height={16} />
            {L.save}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
