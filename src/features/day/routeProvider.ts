import { validCoordinate, type LocalCoordinate } from './location';

export type TravelMode = 'walking' | 'transit' | 'car' | 'taxi';
export const FOOT_ENDPOINT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors · FOSSGIS routing';
export type RouteEvidence = {
  id: string;
  provider: string;
  endpoint: string;
  mode: TravelMode;
  fromKey: string;
  toKey: string;
  coordinateDigest: string;
  fetchedAt: string;
  departureAt: string;
  durationSeconds: number;
  distanceMeters: number;
  basis: 'osm-static' | 'timetable' | 'realtime';
  attribution: string;
};
export type RouteLeg = {
  fromKey: string;
  toKey: string;
  from: LocalCoordinate;
  to: LocalCoordinate;
  departureAt: string;
  mode: TravelMode;
};
export type RouteReply = { ok: true; evidence: RouteEvidence } | { ok: false; reason: string };
export type RouteProvider = { fetchRoute(leg: RouteLeg): Promise<RouteReply> };
export type PublicRoutingPolicy = {
  publicContactEmail?: string;
  attributionVisible: boolean;
  fixMapLinkVisible: boolean;
  normalBrowserReferer: boolean;
  lightweightUseConfirmed: boolean;
};
// No real public contact email exists in this repository. This is a deliberate operational gate.
export const APP_ROUTING_POLICY: PublicRoutingPolicy = {
  attributionVisible: false,
  fixMapLinkVisible: false,
  normalBrowserReferer: false,
  lightweightUseConfirmed: false,
};
export function routingCapability(
  mode: TravelMode,
  policy = APP_ROUTING_POLICY,
): string | undefined {
  if (mode !== 'walking') return 'unsupported-mode';
  if (
    !policy.publicContactEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(policy.publicContactEmail) ||
    !policy.attributionVisible ||
    !policy.fixMapLinkVisible ||
    !policy.normalBrowserReferer ||
    !policy.lightweightUseConfirmed
  )
    return 'service-terms';
  return undefined;
}
// Full precision keys are memory-only and never sent to AI, device storage or export.
export function coordinateKey(from: LocalCoordinate, to: LocalCoordinate): string {
  return JSON.stringify([from.lat, from.lon, to.lat, to.lon]);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function parseFootResponse(value: unknown, leg: RouteLeg, fetchedAt: string): RouteReply {
  if (!record(value)) return { ok: false, reason: 'response-shape' };
  if (value.code === 'NoRoute') return { ok: false, reason: 'no-route' };
  if (
    value.code !== 'Ok' ||
    !Array.isArray(value.routes) ||
    !Array.isArray(value.waypoints) ||
    value.waypoints.length !== 2
  )
    return { ok: false, reason: 'response-shape' };
  if (
    value.waypoints.some(
      (point) =>
        !record(point) ||
        typeof point.distance !== 'number' ||
        !Number.isFinite(point.distance) ||
        point.distance < 0,
    )
  )
    return { ok: false, reason: 'response-shape' };
  if (value.waypoints.some((point) => (point as Record<string, number>).distance > 100))
    return { ok: false, reason: 'snap-too-far' };
  const route = value.routes[0];
  if (
    !record(route) ||
    typeof route.duration !== 'number' ||
    typeof route.distance !== 'number' ||
    !Number.isFinite(route.duration) ||
    !Number.isFinite(route.distance) ||
    route.duration < 0 ||
    route.distance < 0 ||
    (route.duration === 0 && (leg.from.lat !== leg.to.lat || leg.from.lon !== leg.to.lon))
  )
    return { ok: false, reason: 'response-shape' };
  return {
    ok: true,
    evidence: {
      id: crypto.randomUUID(),
      provider: 'fossgis-osrm-foot',
      endpoint: FOOT_ENDPOINT,
      mode: 'walking',
      fromKey: leg.fromKey,
      toKey: leg.toKey,
      coordinateDigest: coordinateKey(leg.from, leg.to),
      fetchedAt,
      departureAt: leg.departureAt,
      durationSeconds: route.duration,
      distanceMeters: route.distance,
      basis: 'osm-static',
      attribution: OSM_ATTRIBUTION,
    },
  };
}

export function createFootProvider(
  policy = APP_ROUTING_POLICY,
  io: typeof fetch = fetch,
): RouteProvider {
  // Queue per adapter; the app has exactly one singleton. No parallel public requests.
  let queue = Promise.resolve();
  let lastStarted = 0;
  return {
    async fetchRoute(leg) {
      const reason = routingCapability(leg.mode, policy);
      if (reason) return { ok: false, reason };
      if (
        !validCoordinate(leg.from) ||
        !validCoordinate(leg.to) ||
        !Number.isFinite(Date.parse(leg.departureAt))
      )
        return { ok: false, reason: 'place-unresolved' };
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const wait = Math.max(0, 1000 - (Date.now() - lastStarted));
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        lastStarted = Date.now();
        timer = setTimeout(() => controller.abort(), 10_000);
        const url = `${FOOT_ENDPOINT}/${leg.from.lon},${leg.from.lat};${leg.to.lon},${leg.to.lat}?overview=false&steps=false&alternatives=false`;
        // Fixed HTTPS host/path; no arbitrary URLs, credentials, proxy or silent car fallback.
        const response = await io(url, {
          credentials: 'omit',
          mode: 'cors',
          redirect: 'error',
          referrerPolicy: 'strict-origin-when-cross-origin',
          signal: controller.signal,
        });
        if (!response.ok)
          return { ok: false, reason: response.status === 429 ? 'rate-limit' : 'provider-error' };
        if (Number(response.headers.get('content-length')) > 100_000)
          return { ok: false, reason: 'response-shape' };
        const raw = await response.text();
        if (raw.length > 100_000) return { ok: false, reason: 'response-shape' };
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          return { ok: false, reason: 'response-shape' };
        }
        return parseFootResponse(value, leg, new Date().toISOString());
      } catch {
        return {
          ok: false,
          reason: controller.signal.aborted ? 'route-timeout' : 'cors-or-network',
        };
      } finally {
        if (timer) clearTimeout(timer);
        release();
      }
    },
  };
}
export const publicFootProvider = createFootProvider();

export type ResolvedPlace = {
  placeId: string;
  coordinate: LocalCoordinate;
  source: string;
  querySnapshot: string;
  resolvedAt: string;
  userConfirmed: boolean;
};
/** Public-venue resolver has no operationally approved provider yet. Search URLs are not coordinates. */
export async function resolvePlace(
  _publicVenueQuery: string,
): Promise<{ ok: false; reason: string }> {
  return { ok: false, reason: 'provider-disabled' };
}
