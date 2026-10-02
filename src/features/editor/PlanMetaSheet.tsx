import { useRef, useState } from 'react';
import { useAiForm } from '../ai/useAiDraft';
import { DraftSaveError } from '../ai/RequestHelp';
import { initialOutingForm, outingBrief } from '../outing/conditions';
import { OutingFields } from '../outing/OutingFields';
import type { DatePlan } from '@datepack/core';
import { isValidDateISO, isValidTime } from '@datepack/core';
import type { PersonalJourney } from '../../storage/indexedDb';
import {
  getStoreState,
  updatePersonalJourney,
  updatePlan,
  useStore,
} from '../../store/datepackStore';
import { Sheet } from '../../components/Sheet';
import { CheckIcon } from '../../components/icons';
import { format, useLocale } from '../../i18n';

type Props = { plan: DatePlan; personalJourney?: PersonalJourney | null; onClose: () => void };

export function PlanMetaSheet({ plan, personalJourney, onClose }: Props) {
  const locale = useLocale();
  const { pack } = useStore();
  const documentId = pack?.id ?? plan.id;
  const ko = locale === 'ko';
  const editRevision = useRef(pack?.revision ?? 0);
  const form = useAiForm(`plan-meta:${documentId}:${editRevision.current}`, {
    ...initialOutingForm,
    title: plan.title,
    date: plan.date ?? '',
    memo: plan.memo ?? '',
    region: plan.outingConditions?.region ?? '',
    party: plan.outingConditions?.party ?? '',
    budget: plan.outingConditions?.budget?.amount.toString() ?? '',
    budgetBasis: plan.outingConditions?.budget?.basis ?? 'total',
    nearby: plan.outingConditions?.nearby ? 'yes' : '',
    singleStop: plan.outingConditions?.singleStop ? 'yes' : '',
    durationMinutes: plan.outingConditions?.durationMinutes?.toString() ?? '',
    startTime: plan.availableFrom?.time ?? '',
    endTime: plan.mustEndBy?.time ?? '',
    endDay: String(plan.mustEndBy?.dayOffset ?? 0),
    fromDay: String(plan.availableFrom?.dayOffset ?? 0),
    meetingName: plan.places?.find((p) => p.id === plan.meeting?.placeId)?.name ?? '',
    meetingNote: plan.meeting?.locationNote ?? '',
    meetingTime: plan.meeting?.timing?.kind === 'exact' ? plan.meeting.timing.start.time : '',
    journeyOrigin: personalJourney?.origin ?? '',
    journeyMode: personalJourney?.mode ?? '',
    journeyNote: personalJourney?.note ?? '',
    must: (plan.constraints?.must ?? []).join('\n'),
    prefer: (plan.constraints?.prefer ?? []).join('\n'),
    avoid: (plan.constraints?.avoid ?? []).join('\n'),
  });
  const {
    title,
    date,
    memo,
    startTime: availableFrom,
    endTime: mustEndBy,
    meetingName,
    meetingNote,
    meetingTime,
    journeyOrigin,
    journeyMode,
    journeyNote,
    must,
    prefer,
    avoid,
  } = form.value;
  const fromDay = Number(form.value.fromDay) as 0 | 1;
  const toDay = Number(form.value.endDay) as 0 | 1;
  const openedRevision = useRef(pack?.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const L = ko
    ? {
        title: '외출 정보',
        name: '외출 이름',
        date: '날짜 (선택)',
        memo: '메모',
        from: '외출 시작 시각 (선택)',
        until: '외출 마감 시간 (선택)',
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
        baseDay: '외출 날짜',
        save: '저장',
        err: '이름, 날짜, 시간을 확인해주세요.',
        privacy: format(locale, 'p3.journey.privacy'),
      }
    : {
        title: 'Outing details',
        name: 'Plan name',
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
        baseDay: 'Outing day',
        save: 'Save',
        err: 'Check the name, date, and times.',
        privacy: format(locale, 'p3.journey.privacy'),
      };
  const lines = (value: string) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  async function save() {
    if (busy) return;
    if (openedRevision.current !== pack?.revision) {
      setError(
        ko
          ? '계획이 바뀌었어요. 입력을 보관했어요. 다시 열어 최신 계획을 확인하세요.'
          : 'The plan changed. Input is kept. Reopen to review the latest plan.',
      );
      return;
    }
    let brief;
    try {
      brief = outingBrief({ ...form.value, startTime: '', endTime: '' });
    } catch {
      setError(ko ? '예산과 소요 시간을 확인해주세요.' : 'Check budget and duration.');
      return;
    }
    const startTime = availableFrom;
    const endTime = mustEndBy;
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
      (startMinutes !== null &&
        endMinutes !== null &&
        (endMinutes < startMinutes || endMinutes - startMinutes > 1440))
    ) {
      setError(L.err);
      return;
    }
    setBusy(true);
    try {
      const saved = await updatePlan(ko ? '외출 정보 수정' : 'Edit outing details', (draft) => {
        draft.outingConditions = brief.outingConditions;
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
        } else
          draft.meeting = meetingNote.trim() ? { locationNote: meetingNote.trim() } : undefined;
        return draft;
      });
      if (!saved) {
        setError(ko ? '저장하지 못했어요. 입력은 보관돼요.' : 'Could not save. Input is kept.');
        return;
      }
      openedRevision.current = getStoreState().pack?.revision;
      await updatePersonalJourney(
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
    } catch {
      setError(ko ? '저장하지 못했어요. 다시 시도하세요.' : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      title={L.title}
      onClose={onClose}
      restoreFocus={() => {
        const trigger = document.querySelector<HTMLElement>(
          `button[aria-label="${ko ? '외출 정보 편집' : 'Edit outing details'}"]`,
        );
        trigger?.focus({ preventScroll: true });
        return Boolean(trigger);
      }}
    >
      <div className="form">
        <label className="field">
          <span>{L.name}</span>
          <input autoFocus value={title} onChange={(e) => form.change('title', e.target.value)} />
        </label>
        <label className="field">
          <span>{L.date}</span>
          <input type="date" value={date} onChange={(e) => form.change('date', e.target.value)} />
        </label>
        <label className="field">
          <span>{L.memo}</span>
          <textarea rows={2} value={memo} onChange={(e) => form.change('memo', e.target.value)} />
        </label>
        <OutingFields
          value={{ ...form.value, startTime: '', endTime: '' }}
          change={form.change}
          disabled={busy}
          compact={false}
          includeDate={false}
          includeTimes={false}
        />
        <div className="divider" />
        <p className="eyebrow">{ko ? '가능한 시간대' : 'Time window'}</p>
        <div className="field-row">
          <label className="field">
            <span>{L.from}</span>
            <input
              type="time"
              value={availableFrom}
              onChange={(e) => form.change('startTime', e.target.value)}
            />
          </label>
          <label className="field">
            <span>{L.until}</span>
            <input
              type="time"
              value={mustEndBy}
              onChange={(e) => form.change('endTime', e.target.value)}
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>{ko ? '시작 날짜' : 'Start day'}</span>
            <select value={fromDay} onChange={(e) => form.change('fromDay', e.target.value)}>
              <option value={0}>{L.baseDay}</option>
              <option value={1}>{L.nextDay}</option>
            </select>
          </label>
          <label className="field">
            <span>{ko ? '마감 날짜' : 'Wrap-up day'}</span>
            <select value={toDay} onChange={(e) => form.change('endDay', e.target.value)}>
              <option value={0}>{L.baseDay}</option>
              <option value={1}>{L.nextDay}</option>
            </select>
          </label>
        </div>
        <div className="divider" />
        {form.value.party !== 'solo' && (
          <details>
            <summary>{ko ? '합류 정보 (선택)' : 'Meeting up (optional)'}</summary>
            <label className="field">
              <span>{L.first}</span>
              <input
                value={meetingName}
                onChange={(e) => form.change('meetingName', e.target.value)}
                placeholder={ko ? '예: 서울역 2번 출구' : 'e.g. North entrance'}
              />
            </label>
            <label className="field">
              <span>{L.meetNote}</span>
              <input
                value={meetingNote}
                onChange={(e) => form.change('meetingNote', e.target.value)}
              />
            </label>
            <label className="field">
              <span>{L.meetTime}</span>
              <input
                type="time"
                value={meetingTime}
                onChange={(e) => form.change('meetingTime', e.target.value)}
              />
            </label>
          </details>
        )}
        <div className="divider" />
        <p className="eyebrow">{L.journey}</p>
        <p className="hint-text">{L.privacy}</p>
        <label className="field">
          <span>{L.origin}</span>
          <input
            value={journeyOrigin}
            onChange={(e) => form.change('journeyOrigin', e.target.value)}
          />
        </label>
        <label className="field">
          <span>{L.mode}</span>
          <input value={journeyMode} onChange={(e) => form.change('journeyMode', e.target.value)} />
        </label>
        <label className="field">
          <span>{L.journeyNote}</span>
          <input value={journeyNote} onChange={(e) => form.change('journeyNote', e.target.value)} />
        </label>
        <div className="divider" />
        <p className="eyebrow">{ko ? '외출 약속' : 'Outing preferences'}</p>
        <label className="field">
          <span>{L.must}</span>
          <textarea rows={2} value={must} onChange={(e) => form.change('must', e.target.value)} />
        </label>
        <label className="field">
          <span>{L.prefer}</span>
          <textarea
            rows={2}
            value={prefer}
            onChange={(e) => form.change('prefer', e.target.value)}
          />
        </label>
        <label className="field">
          <span>{L.avoid}</span>
          <textarea rows={2} value={avoid} onChange={(e) => form.change('avoid', e.target.value)} />
        </label>
        {form.error && <DraftSaveError retry={form.retry} />}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-footer">
          <button
            type="button"
            className="btn btn-primary grow"
            onClick={() => void save()}
            disabled={busy}
          >
            <CheckIcon width={16} height={16} />
            {L.save}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
