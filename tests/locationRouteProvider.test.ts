import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireLocation, observationReason, toCoarseContext } from '../src/features/day/location';
import {
  createFootProvider,
  parseFootResponse,
  routingCapability,
  resolvePlace,
  FOOT_ENDPOINT,
  type PublicRoutingPolicy,
  type RouteLeg,
} from '../src/features/day/routeProvider';
import { buildAiPrompt } from '../src/features/ai/promptBuilder';

afterEach(() => vi.useRealTimers());
const leg: RouteLeg = {
  fromKey: 'origin',
  toKey: 'cafe',
  from: { lat: 37.56, lon: 126.98 },
  to: { lat: 37.57, lon: 126.99 },
  departureAt: '2026-10-01T07:40:00Z',
  mode: 'walking',
};
const body = {
  code: 'Ok',
  routes: [{ duration: 600, distance: 800 }],
  waypoints: [{ distance: 10 }, { distance: 20 }],
};
// Test-only policy fixture. The production policy has no email and stays disabled.
const policy: PublicRoutingPolicy = {
  publicContactEmail: 'fixture@example.test',
  attributionVisible: true,
  fixMapLinkVisible: true,
  normalBrowserReferer: true,
  lightweightUseConfirmed: true,
};

describe('one-shot location with privacy boundaries', () => {
  it('never requests GPS without consent or while offline', async () => {
    const getCurrentPosition = vi.fn();
    expect((await acquireLocation(false, { geolocation: { getCurrentPosition } })).status).toBe(
      'denied',
    );
    expect(
      (await acquireLocation(true, { geolocation: { getCurrentPosition }, online: false })).status,
    ).toBe('offline');
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect((await acquireLocation(true)).status).toBe('unsupported');
  });
  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('keeps the observation time on failure %s', async (code, status) => {
    const lastKnown = {
      source: 'manual' as const,
      coarseLabel: 'Myeongdong',
      observedAt: '2026-10-01T07:40:00Z',
    };
    const result = await acquireLocation(true, {
      online: true,
      lastKnown,
      geolocation: {
        getCurrentPosition: (_success, fail) => fail!({ code } as GeolocationPositionError),
      },
    });
    expect(result).toMatchObject({ status, lastKnown });
    expect(result.observation).toBeUndefined();
  });
  it('requests maximumAge zero once, strips precision and distrusts inaccurate or stale observations', async () => {
    const now = Date.now();
    const getCurrentPosition = vi.fn((success, _fail, options) => {
      expect(options).toEqual({ maximumAge: 0, timeout: 10_000, enableHighAccuracy: false });
      success({
        timestamp: now,
        coords: { latitude: 37.563214, longitude: 126.987654, accuracy: 150 },
      });
    });
    const result = await acquireLocation(true, {
      online: true,
      geolocation: { getCurrentPosition },
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(observationReason(result.observation, now)).toBe('location-inaccurate');
    expect(observationReason(result.observation, now + 300_001)).toBe('location-stale');
    expect(JSON.stringify(toCoarseContext(result))).not.toMatch(
      /37\.563214|126\.987654|coordinate|accuracy/,
    );
    const prompt = buildAiPrompt({
      plan: { id: 'p', title: 'Date', events: [] },
      runtime: null,
      situationId: 'rain',
      locale: 'en',
      liveContext: {
        planId: 'p',
        revision: 1,
        updatedAt: new Date(now).toISOString(),
        locationAttempt: toCoarseContext(result),
      },
    });
    expect(prompt).not.toMatch(/37\.563214|126\.987654|coordinateDigest/);
  });
  it('settles browsers that never call back and ignores late observations', async () => {
    vi.useFakeTimers();
    let success!: PositionCallback;
    const result = acquireLocation(true, {
      online: true,
      geolocation: {
        getCurrentPosition: (callback) => {
          success = callback;
        },
      },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).status).toBe('timeout');
    success({
      timestamp: Date.now(),
      coords: { latitude: 37.56, longitude: 126.98, accuracy: 5 },
    } as GeolocationPosition);
    expect((await result).observation).toBeUndefined();
  });
});

describe('public route capabilities and strict responses', () => {
  it('stays disabled without real operational prerequisites and never uses another mode', async () => {
    const io = vi.fn();
    expect(await createFootProvider(undefined, io).fetchRoute(leg)).toEqual({
      ok: false,
      reason: 'service-terms',
    });
    expect(io).not.toHaveBeenCalled();
    expect(routingCapability('transit', policy)).toBe('unsupported-mode');
    expect(routingCapability('car', policy)).toBe('unsupported-mode');
    expect(routingCapability('taxi', policy)).toBe('unsupported-mode');
    expect(await resolvePlace('Public cafe')).toEqual({ ok: false, reason: 'provider-disabled' });
  });
  it('uses a fixed HTTPS foot endpoint, no credentials, no redirects, and opaque local evidence', async () => {
    const io = vi.fn(async () => new Response(JSON.stringify(body)));
    const result = await createFootProvider(policy, io).fetchRoute(leg);
    expect(io).toHaveBeenCalledWith(
      expect.stringContaining(FOOT_ENDPOINT),
      expect.objectContaining({
        credentials: 'omit',
        mode: 'cors',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      evidence: { mode: 'walking', durationSeconds: 600, endpoint: FOOT_ENDPOINT },
    });
    if (result.ok) expect(result.evidence.endpoint).not.toContain('37.56');
  });
  it.each([
    [{ code: 'NoRoute' }, 'no-route'],
    [{ ...body, waypoints: [{ distance: 101 }, { distance: 0 }] }, 'snap-too-far'],
    [{ ...body, routes: [{ duration: 0, distance: 800 }] }, 'response-shape'],
    [{ ...body, routes: [{ duration: -1, distance: 800 }] }, 'response-shape'],
    [{ ...body, routes: [{ duration: Infinity, distance: 800 }] }, 'response-shape'],
    [{ ...body, waypoints: [] }, 'response-shape'],
  ])('rejects malformed or unusable route data', (value, reason) => {
    expect(parseFootResponse(value, leg, new Date().toISOString())).toEqual({ ok: false, reason });
  });
  it('distinguishes rate limiting, unreadable responses and network failures', async () => {
    expect(
      await createFootProvider(policy, async () => new Response('', { status: 429 })).fetchRoute(
        leg,
      ),
    ).toEqual({ ok: false, reason: 'rate-limit' });
    expect(
      await createFootProvider(policy, async () => new Response('not JSON')).fetchRoute(leg),
    ).toEqual({ ok: false, reason: 'response-shape' });
    expect(
      await createFootProvider(policy, async () => {
        throw new TypeError('fetch failed');
      }).fetchRoute(leg),
    ).toEqual({ ok: false, reason: 'cors-or-network' });
  });
  it('aborts slow requests and returns an explicit timeout', async () => {
    vi.useFakeTimers();
    const io = vi.fn(
      (_url: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const pending = createFootProvider(policy, io).fetchRoute(leg);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, reason: 'route-timeout' });
  });
});
