import { useStore } from '../../store/datepackStore';
import { useLocale } from '../../i18n';
import { useNow } from '../../hooks/useNow';
import { computeDayContext } from '../day/dayRuntime';
import { resolveDayDestination } from '../day/nextDestination';
import { mapBridgeUrl } from '../../utils/mapBridge';
import { timingLabel } from './timingPresentation';

export function RequestResume({
  onResume,
  onToday,
}: {
  onResume: () => void;
  onToday: () => void;
}) {
  const { pack, runtime, pendingRequest: request, liveContext } = useStore();
  const ko = useLocale() === 'ko';
  const now = useNow(30_000);
  if (!pack || !request || request.planId !== pack.id || request.status === 'cancelled')
    return null;
  if (request.status === 'applied') {
    if (request.kind === 'memory-edit')
      return (
        <div className="ai-return" role="status">
          {ko
            ? '다듬은 문장을 원문과 함께 저장했어요.'
            : 'Edited wording saved alongside the original.'}
        </div>
      );
    // Use the same chosen event as Today, including a choice beyond the first upcoming stop.
    const ctx = computeDayContext(pack.plan, runtime, now);
    const { destination } = resolveDayDestination(
      ctx,
      liveContext?.planId === pack.id ? liveContext.nextPlaceId : undefined,
    );
    if (!destination)
      return (
        <div className="ai-return" role="status">
          {ko
            ? '계획을 저장했어요. 다음 목적지는 아직 정해지지 않았어요.'
            : 'Plan saved. No next destination is set.'}
        </div>
      );
    const place = pack.plan.places?.find((p) => p.id === destination.event.placeId);
    return (
      <div className="ai-return">
        <strong>
          {ko ? '다음 목적지' : 'Next destination'} · {destination.event.title}
        </strong>
        <p className="hint-text">
          {timingLabel(destination.event.timing, ko ? 'ko' : 'en')} ·{' '}
          {destination.startMinutes === null
            ? ko
              ? '출발 시각은 아직 미정이에요.'
              : 'Departure time is still unset.'
            : ko
              ? '예정 시각이에요. 출발 시각과 이동 경로는 확인이 필요해요.'
              : 'This is the planned time. Confirm departure time and the route.'}
        </p>
        <div className="action-row">
          <button type="button" className="btn btn-soft" onClick={onToday}>
            {ko ? '지금 화면에서 보기' : 'View in Today'}
          </button>
          {place && (
            <a
              className="btn btn-ghost"
              href={mapBridgeUrl(place.mapQuery || place.name)}
              target="_blank"
              rel="noreferrer"
            >
              {ko ? '목적지 지도 열기' : 'Open destination map'}
            </a>
          )}
        </div>
      </div>
    );
  }
  const label =
    request.kind === 'create'
      ? ko
        ? '새 계획'
        : 'New plan'
      : request.kind === 'memory-edit'
        ? ko
          ? '기록 다듬기'
          : 'Memory wording'
        : ko
          ? '일정 변경'
          : 'Replan';
  const states = {
    draft: ko ? '답안 작성 중' : 'Reply in progress',
    ready: ko ? 'AI에 보낼 요청 준비됨' : 'Request ready',
    waiting: ko ? 'AI 답안 기다리는 중' : 'Waiting for AI reply',
    review: ko ? '적용 전 확인' : 'Review before applying',
    stale: ko ? '상황이 바뀜 · 새 요청 필요' : 'Context changed · new request needed',
    error: ko ? '답안 확인 필요' : 'Reply needs attention',
    applied: '',
    cancelled: '',
  };
  return (
    <div className="ai-return" role="status">
      <strong>
        {label} · {states[request.status]}
      </strong>
      <p className="hint-text">
        {ko
          ? '요청과 작성한 답안이 이 기기에 남아 있어요.'
          : 'Your request and reply are kept on this device.'}
      </p>
      <button type="button" className="btn btn-soft" onClick={onResume}>
        {ko ? 'AI 요청 이어가기' : 'Resume AI request'}
      </button>
    </div>
  );
}
