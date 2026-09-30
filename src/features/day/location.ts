export const LOCATION_TTL_MS = 5 * 60_000;
export const MAX_ACCURACY_METERS = 100;
export type LocalCoordinate = { lat: number; lon: number; accuracyMeters?: number };
export type LocationObservation = {
  source: 'gps' | 'manual';
  observedAt: string;
  coarseLabel: string;
  coordinate?: LocalCoordinate;
};
export type CoarseObservation = Omit<LocationObservation, 'coordinate'>;
export type LocationAttempt = {
  attemptedAt: string;
  status: 'success' | 'denied' | 'timeout' | 'unavailable' | 'offline' | 'unsupported';
  observation?: LocationObservation;
  lastKnown?: CoarseObservation;
};
export type CoarseLocationAttempt = Omit<LocationAttempt, 'observation'> & {
  observation?: CoarseObservation;
};

// Precise coordinates have no persistence or portable-file representation.
const observations = new Map<string, LocationObservation>();
export function setLocalObservation(planId: string, observation?: LocationObservation): void {
  if (observation) observations.set(planId, observation);
  else observations.delete(planId);
}
export function getLocalObservation(planId: string): LocationObservation | undefined {
  return observations.get(planId);
}
export function clearLocalObservations(): void {
  observations.clear();
}
export function validCoordinate(point: LocalCoordinate): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}
export function observationReason(
  observation: LocationObservation | undefined,
  now: number,
): string | undefined {
  if (!observation?.coordinate || !validCoordinate(observation.coordinate))
    return 'place-unresolved';
  const age = now - Date.parse(observation.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > LOCATION_TTL_MS) return 'location-stale';
  if (
    observation.source === 'gps' &&
    (!Number.isFinite(observation.coordinate.accuracyMeters) ||
      observation.coordinate.accuracyMeters! < 0 ||
      observation.coordinate.accuracyMeters! > MAX_ACCURACY_METERS)
  )
    return 'location-inaccurate';
  return undefined;
}
export function toCoarseContext(attempt: LocationAttempt): CoarseLocationAttempt {
  const coarse = (o: CoarseObservation): CoarseObservation => ({
    source: o.source,
    observedAt: o.observedAt,
    coarseLabel: o.coarseLabel,
  });
  return {
    attemptedAt: attempt.attemptedAt,
    status: attempt.status,
    ...(attempt.observation ? { observation: coarse(attempt.observation) } : {}),
    ...(attempt.lastKnown ? { lastKnown: coarse(attempt.lastKnown) } : {}),
  };
}

/** Consent is checked before touching the browser API. Never watchPosition. */
export async function acquireLocation(
  consent: boolean,
  options: {
    geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
    online?: boolean;
    now?: () => number;
    lastKnown?: CoarseObservation;
  } = {},
): Promise<LocationAttempt> {
  const now = options.now ?? Date.now;
  const attemptedAt = new Date(now()).toISOString();
  const fail = (status: LocationAttempt['status']): LocationAttempt => ({
    attemptedAt,
    status,
    ...(options.lastKnown ? { lastKnown: options.lastKnown } : {}),
  });
  if (!consent) return fail('denied');
  if (!(options.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false)))
    return fail('offline');
  const geo =
    options.geolocation ?? (typeof navigator === 'undefined' ? undefined : navigator.geolocation);
  if (!geo) return fail('unsupported');
  return new Promise((resolve) => {
    let finished = false;
    const done = (attempt: LocationAttempt) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(attempt);
    };
    const timer = setTimeout(() => done(fail('timeout')), 10_000);
    try {
      geo.getCurrentPosition(
        (position) => {
          const coordinate = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          };
          if (!validCoordinate(coordinate) || !Number.isFinite(position.timestamp)) {
            done(fail('unavailable'));
            return;
          }
          done({
            attemptedAt,
            status: 'success',
            observation: {
              source: 'gps',
              observedAt: new Date(position.timestamp).toISOString(),
              // No reverse service is operationally enabled. Do not pretend raw GPS is an area name.
              coarseLabel: '',
              coordinate,
            },
            ...(options.lastKnown ? { lastKnown: options.lastKnown } : {}),
          });
        },
        (error) =>
          done(fail(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable')),
        { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 },
      );
    } catch {
      done(fail('unavailable'));
    }
  });
}
