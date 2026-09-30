import type { ImpactResult } from './routeImpact';
import type { CoarseLocationAttempt } from './location';

const reasons: Record<string, [string, string]> = {
  'service-terms': [
    '공개 경로 서비스의 이용 조건을 아직 충족하지 못했어요.',
    'Public routing service requirements are not yet met.',
  ],
  'provider-disabled': ['사용 가능한 경로 서비스가 없어요.', 'No routing service is enabled.'],
  'unsupported-mode': ['이 이동 수단은 검증할 수 없어요.', 'This travel mode cannot be verified.'],
  'place-unresolved': ['장소 좌표를 확인하지 못했어요.', 'Venue coordinates are not confirmed.'],
  'location-stale': [
    '현재 위치를 확인한 지 5분이 지났어요.',
    'The location observation is over five minutes old.',
  ],
  'location-inaccurate': [
    '위치 오차가 커서 출발점을 확인할 수 없어요.',
    'Location accuracy is too low to confirm the starting point.',
  ],
  'duration-unknown': ['활동에 머무를 시간이 미정이에요.', 'Activity duration is unset.'],
  'missing-leg': [
    '일부 이동 구간의 경로 근거가 없어요.',
    'Some travel legs have no route evidence.',
  ],
  'evidence-stale': [
    '경로 근거가 오래됐거나 현재 동선과 달라요.',
    'Route evidence is stale or does not match this journey.',
  ],
  'anchor-late': [
    '이 동선으로는 정해진 시작 시각에 도착할 수 없어요.',
    'This journey cannot meet a scheduled start time.',
  ],
  'end-late': ['이 동선은 정해진 종료 시각을 넘겨요.', 'This journey exceeds the end deadline.'],
  'date-unknown': [
    '날짜가 미정이라 동선을 검증할 수 없어요.',
    'A date is needed to verify this journey.',
  ],
  'date-mismatch': [
    '오늘의 위치로 다른 날짜의 출발점을 검증할 수 없어요.',
    'Today’s location cannot confirm a starting point on another date.',
  ],
  'time-unknown': ['출발 시각이 미정이에요.', 'Departure time is unset.'],
  'protected-field': [
    '보호한 일정의 내용을 바꿀 수 없어요.',
    'Protected activity fields cannot change.',
  ],
  'protected-order': [
    '보호한 일정 앞뒤의 순서를 바꿀 수 없어요.',
    'The order around a protected activity cannot change.',
  ],
  'scope-mismatch': [
    '요청 범위 밖의 일정이 바뀌었어요.',
    'An activity outside this request scope changed.',
  ],
  'snapshot-stale': [
    '미리보기 이후 상황이 바뀌었어요. 다시 확인해주세요.',
    'The situation changed after preview. Review it again.',
  ],
  'cors-or-network': [
    '경로 서비스에 연결하지 못했어요.',
    'Could not connect to the routing service.',
  ],
  'route-timeout': ['경로 조회 시간이 초과됐어요.', 'The route request timed out.'],
  'rate-limit': [
    '경로 서비스가 잠시 요청을 제한했어요.',
    'The routing service temporarily limited requests.',
  ],
  'no-route': ['서비스에서 경로를 찾지 못했어요.', 'The service could not find a route.'],
  'snap-too-far': [
    '서비스가 선택한 출발점이나 도착점의 오차가 커요.',
    'The service snapped an endpoint too far from the selected place.',
  ],
  'response-shape': ['경로 응답을 확인할 수 없어요.', 'The route response could not be validated.'],
};
export function impactMessage(result: ImpactResult, locale: 'ko' | 'en'): string {
  const ko = locale === 'ko';
  if (result.reasonCodes.includes('no-route-impact'))
    return ko ? '동선에 영향 없는 변경이에요.' : 'This change does not affect the journey.';
  const status =
    result.status === 'verified'
      ? ko
        ? '도보 경로 확인'
        : 'Walking route verified'
      : result.status === 'impossible'
        ? ko
          ? '적용 불가'
          : 'Cannot apply'
        : ko
          ? '동선 미확인'
          : 'Journey unverified';
  const detail = result.reasonCodes
    .map(
      (r) =>
        reasons[r]?.[ko ? 0 : 1] ??
        (ko ? '경로 근거를 확인하지 못했어요.' : 'Route evidence could not be confirmed.'),
    )
    .join(' ');
  return `${status} · ${detail} ${
    result.status === 'verified'
      ? ko
        ? '정시 도착이나 현장 운영을 보장하지 않아요. 대중교통 비교는 미확인이에요.'
        : 'Arrival time and venue availability are not guaranteed. Transit comparison is unverified.'
      : ko
        ? '검증 가능한 다른 후보를 확인하거나 기존 일정을 유지해주세요.'
        : 'Check another verifiable option or keep the current plan.'
  }`;
}
export function locationMessage(attempt: CoarseLocationAttempt, locale: 'ko' | 'en'): string {
  const ko = locale === 'ko';
  if (attempt.observation?.source === 'manual')
    return `${ko ? '직접 확인' : 'Manually confirmed'}: ${attempt.observation.coarseLabel} (${new Date(attempt.observation.observedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}).`;
  const status: Record<CoarseLocationAttempt['status'], [string, string]> = {
    success: [
      '위치 조회 완료 · 지역 이름은 직접 확인해주세요.',
      'Location captured · confirm the area name manually.',
    ],
    denied: ['위치 권한을 허용하지 않았어요.', 'Location permission was not granted.'],
    timeout: ['위치 조회 시간이 초과됐어요.', 'Location lookup timed out.'],
    unavailable: ['현재 위치를 조회하지 못했어요.', 'Current location could not be obtained.'],
    offline: [
      '오프라인이라 위치 조회를 건너뛰었어요.',
      'Location lookup was skipped while offline.',
    ],
    unsupported: [
      '이 브라우저는 위치 조회를 지원하지 않아요.',
      'This browser does not support location lookup.',
    ],
  };
  const known = attempt.observation?.coarseLabel ? attempt.observation : attempt.lastKnown;
  const last = known?.coarseLabel
    ? ` ${ko ? '마지막 확인' : 'Last observed'}: ${known.coarseLabel} (${new Date(known.observedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}).`
    : '';
  return `${status[attempt.status][ko ? 0 : 1]}${last}`;
}
