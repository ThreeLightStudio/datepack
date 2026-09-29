import { useRef, useState } from 'react';
import type { DateEventType, DatePackRuntimeState, DatePlan } from '@datepack/core';
import { DATE_EVENT_TYPES } from '@datepack/core';
import type { LiveContext } from '../../storage/indexedDb';
import { updateLiveContext, updatePlan } from '../../store/datepackStore';
import { Sheet } from '../../components/Sheet';
import { CheckIcon } from '../../components/icons';
import { eventTypeLabel, format, useLocale } from '../../i18n';
import {
  addNextActivity,
  isSettledNextEvent,
  promoteCandidateToNextActivity,
  selectableNextEvents,
} from './nextDestination';

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function CurrentContextSheet({
  plan,
  runtime,
  context,
  onClose,
}: {
  plan: DatePlan;
  runtime: DatePackRuntimeState | null;
  context: LiveContext | null;
  onClose: () => void;
}) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const initialEvent = selectableNextEvents(plan.events, runtime).find(
    (event) => event.id === context?.nextPlaceId,
  );
  const [place, setPlace] = useState(context?.place ?? '');
  const [activity, setActivity] = useState(context?.activity ?? '');
  const [nextSelection, setNextSelection] = useState(
    initialEvent ? `event:${initialEvent.id}` : '',
  );
  const [newActivity, setNewActivity] = useState(initialEvent ? '' : (context?.nextPlace ?? ''));
  const [newActivityType, setNewActivityType] = useState<DateEventType>('place');
  const [confirmedAt, setConfirmedAt] = useState(
    toLocalDateTime(context?.confirmedAt ?? new Date().toISOString()),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pendingDestinationRef = useRef<{ eventId: string; title: string } | null>(null);
  const selectedEvent = nextSelection.startsWith('event:')
    ? plan.events.find((event) => event.id === nextSelection.slice('event:'.length))
    : undefined;
  const selectedCandidate = nextSelection.startsWith('candidate:')
    ? plan.candidates?.find(
        (candidate) => candidate.id === nextSelection.slice('candidate:'.length),
      )
    : undefined;

  async function save() {
    if (!confirmedAt || Number.isNaN(new Date(confirmedAt).getTime())) {
      setError(ko ? '확인한 시각을 입력해주세요.' : 'Enter when you confirmed this update.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const pendingDestination = pendingDestinationRef.current;
      const destinationEventId = pendingDestination?.eventId ?? selectedEvent?.id;
      if (destinationEventId && isSettledNextEvent(runtime, destinationEventId)) {
        pendingDestinationRef.current = null;
        setNextSelection('');
        setNewActivity('');
        setError(
          ko
            ? '이미 완료하거나 건너뛴 일정이에요. 다른 목적지를 선택해주세요.'
            : 'That activity is already done or skipped. Choose another destination.',
        );
        return;
      }

      let nextPlaceId = pendingDestination?.eventId ?? selectedEvent?.id;
      let nextTitle = pendingDestination?.title ?? selectedEvent?.title;
      if (!pendingDestination && (selectedCandidate || newActivity.trim())) {
        let newEventId = '';
        let newEventTitle = '';
        const requestedEventId = selectedCandidate ? undefined : `next-${crypto.randomUUID()}`;
        const saved = await updatePlan(
          ko ? '다음 목적지를 일정에 추가' : 'Add next place to plan',
          (draft) => {
            const event = selectedCandidate
              ? promoteCandidateToNextActivity(draft, selectedCandidate.id)
              : addNextActivity(draft, newActivity, newActivityType, requestedEventId);
            if (!event) return draft;
            newEventId = event.id;
            newEventTitle = event.title;
            return draft;
          },
        );
        if (!saved) return;
        if (!newEventId) {
          setError(
            ko ? '선택한 후보를 찾지 못했어요.' : 'The selected idea is no longer available.',
          );
          return;
        }
        nextPlaceId = newEventId;
        nextTitle = newEventTitle;
        pendingDestinationRef.current = { eventId: newEventId, title: newEventTitle };
        setNextSelection(`event:${newEventId}`);
        setNewActivity('');
      }

      await updateLiveContext({
        planId: plan.id,
        updatedAt: new Date().toISOString(),
        place: place.trim() || undefined,
        activity: activity.trim() || undefined,
        nextPlaceId,
        nextPlace: nextTitle,
        confirmedAt: new Date(confirmedAt).toISOString(),
      });
      pendingDestinationRef.current = null;
      onClose();
    } catch {
      setError(
        pendingDestinationRef.current
          ? ko
            ? '활동은 일정에 추가됐어요. 다시 저장하면 상황과 연결돼요.'
            : 'The activity is in the plan. Retry to finish saving this update.'
          : ko
            ? '저장하지 못했어요. 다시 시도해주세요.'
            : 'Could not save. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

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
          <select
            value={nextSelection}
            onChange={(e) => {
              pendingDestinationRef.current = null;
              setNextSelection(e.target.value);
              setNewActivity('');
            }}
          >
            <option value="">{ko ? '아직 정하지 않음' : 'Not decided yet'}</option>
            <optgroup label={ko ? '남은 일정' : 'Planned activities'}>
              {selectableNextEvents(plan.events, runtime).map((event) => (
                <option key={event.id} value={`event:${event.id}`}>
                  {event.title}
                </option>
              ))}
            </optgroup>
            {(plan.candidates ?? []).some((candidate) => !candidate.excluded) && (
              <optgroup label={ko ? '저장한 후보' : 'Saved ideas'}>
                {(plan.candidates ?? [])
                  .filter((candidate) => !candidate.excluded)
                  .map((candidate) => (
                    <option key={candidate.id} value={`candidate:${candidate.id}`}>
                      {candidate.title}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="field">
          <span>{ko ? '새 활동을 일정에 추가' : 'Add a new activity to the plan'}</span>
          <input
            value={newActivity}
            onChange={(e) => {
              pendingDestinationRef.current = null;
              setNewActivity(e.target.value);
              if (e.target.value) setNextSelection('');
            }}
            placeholder={ko ? '예: 서점 들르기' : 'e.g. stop by a bookstore'}
          />
        </label>
        {newActivity.trim() && (
          <label className="field">
            <span>{ko ? '활동 종류' : 'Activity type'}</span>
            <select
              value={newActivityType}
              onChange={(e) => {
                pendingDestinationRef.current = null;
                setNewActivityType(e.target.value as DateEventType);
              }}
            >
              {DATE_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {eventTypeLabel(locale, type)}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedCandidate && (
          <p className="hint-text">
            {ko
              ? '저장하면 이 후보가 시간 미정 활동으로 일정에 추가돼요.'
              : 'Saving adds this idea to the plan as an unscheduled activity.'}
          </p>
        )}
        <label className="field">
          <span>{ko ? '확인한 시각' : 'Confirmed at'}</span>
          <input
            type="datetime-local"
            value={confirmedAt}
            required
            onChange={(e) => setConfirmedAt(e.target.value)}
          />
        </label>
        {selectedEvent && (
          <p className="sub-line">
            {ko ? `다음: ${selectedEvent.title}` : `Next: ${selectedEvent.title}`}
          </p>
        )}
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
            disabled={saving}
          >
            <CheckIcon width={16} height={16} />
            {ko ? '저장' : 'Save'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
