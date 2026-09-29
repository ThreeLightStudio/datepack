import { useState } from 'react';
import type { DatePlan } from '@datepack/core';
import type { LiveContext } from '../../storage/indexedDb';
import { updateLiveContext } from '../../store/datepackStore';
import { Sheet } from '../../components/Sheet';
import { CheckIcon } from '../../components/icons';
import { format, useLocale } from '../../i18n';

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function CurrentContextSheet({
  plan,
  context,
  onClose,
}: {
  plan: DatePlan;
  context: LiveContext | null;
  onClose: () => void;
}) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const [place, setPlace] = useState(context?.place ?? '');
  const [activity, setActivity] = useState(context?.activity ?? '');
  const [next, setNext] = useState(context?.nextPlaceId ?? '');
  const [nextPlace, setNextPlace] = useState(context?.nextPlace ?? '');
  const [confirmedAt, setConfirmedAt] = useState(
    toLocalDateTime(context?.confirmedAt ?? new Date().toISOString()),
  );
  const selectedNext = plan.events.find((event) => event.id === next);
  return (
    <Sheet open title={format(locale, 'p3.day.context')} onClose={onClose}>
      <div className="form">
        <p className="hint-text">
          {ko
            ? '지난 일정은 방문·건너뜀으로 바꾸지 않아요. 아는 현재 상황과 다음 선택만 기록해요.'
            : 'Earlier plans stay unconfirmed. Add only what you know about now and what you chose next.'}
        </p>
        <label className="field">
          <span>{ko ? '지금 있는 곳 (선택)' : 'Where you are (optional)'}</span>
          <input
            autoFocus
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder={ko ? '예: 계획에 없던 카페' : 'e.g. a café you found'}
          />
        </label>
        <label className="field">
          <span>{ko ? '하고 있는 일 (선택)' : 'What you’re doing (optional)'}</span>
          <input value={activity} onChange={(e) => setActivity(e.target.value)} />
        </label>
        <label className="field">
          <span>{ko ? '이미 정한 다음 목적지' : 'Next place you chose'}</span>
          <select value={next} onChange={(e) => setNext(e.target.value)}>
            <option value="">{ko ? '아직 정하지 않음' : 'Not decided yet'}</option>
            {plan.events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{ko ? '직접 입력한 다음 장소 (선택)' : 'Another next place (optional)'}</span>
          <input
            value={nextPlace}
            onChange={(e) => {
              setNextPlace(e.target.value);
              if (e.target.value) setNext('');
            }}
            placeholder={ko ? '예: 서점' : 'e.g. bookstore'}
          />
        </label>
        <label className="field">
          <span>{ko ? '확인한 시각' : 'Confirmed at'}</span>
          <input
            type="datetime-local"
            value={confirmedAt}
            required
            onChange={(e) => setConfirmedAt(e.target.value)}
          />
        </label>
        {selectedNext && (
          <p className="sub-line">
            {ko ? `다음: ${selectedNext.title}` : `Next: ${selectedNext.title}`}
          </p>
        )}
        <div className="sheet-footer">
          <button
            type="button"
            className="btn btn-primary grow"
            onClick={() => {
              void updateLiveContext({
                planId: plan.id,
                updatedAt: new Date().toISOString(),
                place: place.trim() || undefined,
                activity: activity.trim() || undefined,
                nextPlaceId: next || undefined,
                nextPlace: nextPlace.trim() || undefined,
                confirmedAt: new Date(confirmedAt).toISOString(),
              });
              onClose();
            }}
          >
            <CheckIcon width={16} height={16} />
            {ko ? '저장' : 'Save'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
