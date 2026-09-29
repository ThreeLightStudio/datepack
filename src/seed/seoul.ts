import type { DatePack, DatePackAsset, DatePlan } from '@datepack/core';
import { assetPath, createEvent, createPlace, todayISO } from '@datepack/core';
import type { Locale } from '../i18n/core';

/**
 * Seed DatePack: a classic first-timer's loop around Gwanghwamun — palace,
 * hanok lanes, market food and a Namsan night view. Content is regenerated
 * per UI locale at load time (map queries stay Korean so map search keeps
 * working). The seed date is "today" on first run so the Day mode (NOW/NEXT)
 * is immediately observable. Images are locally generated SVG placeholders —
 * the layout must work with zero images (see image policy).
 */

type SeedCopy = {
  title: string;
  memo: string;
  constraints: { must: string[]; prefer: string[]; avoid: string[] };
  places: Record<
    | 'station'
    | 'gyeongbokgung'
    | 'bukchon'
    | 'gwangjang'
    | 'ikseondong'
    | 'cheonggyecheon'
    | 'namsan',
    string
  >;
  events: Record<
    | 'arrival'
    | 'gyeongbokgung'
    | 'bukchon'
    | 'gwangjang1'
    | 'ikseondong'
    | 'gwangjang2'
    | 'cheonggyecheon'
    | 'namsan'
    | 'departure',
    { title: string; note: string }
  >;
  planB: { trigger: string; title: string; note: string };
  coverText: string;
  cafeText: string;
  candidate: string;
};

const COPY: Record<Locale, SeedCopy> = {
  ko: {
    title: '서울 클래식 데이트',
    memo: '궁궐부터 남산 야경까지, 지하철과 도보로 돌아보는 서울 하루.',
    constraints: {
      must: ['경복궁 방문', '22:00 서울역 출발'],
      prefer: ['한옥 카페', '전통시장 먹거리'],
      avoid: ['너무 매운 음식', '장거리 이동'],
    },
    places: {
      station: '서울역',
      gyeongbokgung: '경복궁',
      bukchon: '북촌 한옥마을',
      gwangjang: '광장시장',
      ikseondong: '익선동 카페',
      cheonggyecheon: '청계천',
      namsan: 'N서울타워',
    },
    events: {
      arrival: { title: '서울역 도착', note: '공항철도·KTX 하차' },
      gyeongbokgung: { title: '경복궁', note: '수문장 교대식 10:00 · 근정전·경회루' },
      bukchon: { title: '북촌 한옥마을', note: '가회동 골목 산책' },
      gwangjang1: { title: '광장시장 점심', note: '빈대떡·마약김밥' },
      ikseondong: { title: '익선동 카페', note: '한옥 카페에서 휴식' },
      gwangjang2: { title: '광장시장 재방문', note: '먹거리 포장 & 골목 구경' },
      cheonggyecheon: { title: '청계천 산책', note: '석양 무렵 물빛길 산책' },
      namsan: { title: 'N서울타워 야경', note: '남산 케이블카 왕복' },
      departure: { title: '서울역 출발', note: '공항철도·KTX 승차' },
    },
    planB: {
      trigger: '줄이 너무 길 때',
      title: '지금은 건너뛰기',
      note: '줄이 너무 길면 점심을 미루고 다음 일정(익선동 카페)으로 진행해요. 16:30에 다시 방문해요.',
    },
    coverText: '서울, 더 좋은 하루를 함께.',
    cafeText: '익선동',
    candidate: '여유 있으면 작은 전시',
  },
  en: {
    title: 'Classic Seoul Day',
    memo: 'Palaces to Namsan nights — one classic Seoul loop by subway and on foot.',
    constraints: {
      must: ['Visit Gyeongbokgung Palace', 'Depart Seoul Station at 22:00'],
      prefer: ['Hanok café', 'Traditional market street food'],
      avoid: ['Overly spicy food', 'Long-distance travel'],
    },
    places: {
      station: 'Seoul Station',
      gyeongbokgung: 'Gyeongbokgung Palace',
      bukchon: 'Bukchon Hanok Village',
      gwangjang: 'Gwangjang Market',
      ikseondong: 'Ikseondong Café',
      cheonggyecheon: 'Cheonggyecheon',
      namsan: 'N Seoul Tower',
    },
    events: {
      arrival: { title: 'Arrive at Seoul Station', note: 'Airport Railroad / KTX' },
      gyeongbokgung: {
        title: 'Gyeongbokgung Palace',
        note: 'Royal guard ceremony 10:00 · Geunjeongjeon & Gyeonghoeru',
      },
      bukchon: { title: 'Bukchon Hanok Village', note: 'Stroll the Gahoe-dong alleys' },
      gwangjang1: { title: 'Lunch at Gwangjang Market', note: 'Bindaetteok & mayak gimbap' },
      ikseondong: { title: 'Ikseondong Café', note: 'Coffee break in a hanok café' },
      gwangjang2: { title: 'Gwangjang Market, again', note: 'Grab snacks & browse the stalls' },
      cheonggyecheon: { title: 'Cheonggyecheon Walk', note: 'Golden-hour walk along the stream' },
      namsan: { title: 'N Seoul Tower night view', note: 'Namsan cable car round trip' },
      departure: { title: 'Depart from Seoul Station', note: 'Board the Airport Railroad / KTX' },
    },
    planB: {
      trigger: 'When the line is too long',
      title: 'Skip for now',
      note: "If the line is too long, put lunch on hold and move on to the next stop (Ikseondong Café). We'll come back at 16:30.",
    },
    coverText: 'Seoul, a better day together.',
    cafeText: 'Ikseondong',
    candidate: 'A small gallery if there’s time',
  },
};

export function createSeoulSeed(locale: Locale): {
  pack: DatePack;
  blobs: Array<{ asset: DatePackAsset; blob: Blob }>;
} {
  const date = todayISO();
  const copy = COPY[locale];

  // Map queries stay Korean regardless of locale — they are search keys, not copy.
  const places = [
    createPlace(copy.places.station, '서울역'),
    createPlace(copy.places.gyeongbokgung, '경복궁 서울'),
    createPlace(copy.places.bukchon, '북촌한옥마을 서울'),
    createPlace(copy.places.gwangjang, '광장시장 서울'),
    createPlace(copy.places.ikseondong, '익선동 카페 서울'),
    createPlace(copy.places.cheonggyecheon, '청계천 서울'),
    createPlace(copy.places.namsan, 'N서울타워 서울'),
  ];
  const [station, gyeongbokgung, bukchon, gwangjang, ikseondong, cheonggyecheon, namsan] = places;

  const e = copy.events;
  const events = [
    createEvent({
      id: 'event-arrival',
      title: e.arrival.title,
      start: '09:30',
      end: '09:50',
      type: 'transport',
      placeId: station.id,
      note: e.arrival.note,
    }),
    createEvent({
      id: 'event-gyeongbokgung',
      title: e.gyeongbokgung.title,
      start: '10:10',
      end: '11:40',
      type: 'place',
      placeId: gyeongbokgung.id,
      importance: 'core',
      travelMinutes: 15,
      note: e.gyeongbokgung.note,
    }),
    createEvent({
      id: 'event-bukchon',
      title: e.bukchon.title,
      start: '12:00',
      end: '13:00',
      type: 'place',
      placeId: bukchon.id,
      travelMinutes: 12,
      note: e.bukchon.note,
    }),
    createEvent({
      id: 'event-gwangjang-1',
      title: e.gwangjang1.title,
      start: '13:20',
      end: '14:30',
      type: 'meal',
      placeId: gwangjang.id,
      travelMinutes: 10,
      note: e.gwangjang1.note,
      planB: {
        trigger: copy.planB.trigger,
        title: copy.planB.title,
        note: copy.planB.note,
        replacementEventIds: ['event-gwangjang-2'],
      },
    }),
    createEvent({
      id: 'event-ikseondong',
      title: e.ikseondong.title,
      start: '14:50',
      end: '16:10',
      type: 'cafe',
      placeId: ikseondong.id,
      travelMinutes: 8,
      note: e.ikseondong.note,
    }),
    createEvent({
      id: 'event-gwangjang-2',
      title: e.gwangjang2.title,
      start: '16:30',
      end: '17:20',
      type: 'place',
      placeId: gwangjang.id,
      travelMinutes: 8,
      note: e.gwangjang2.note,
    }),
    createEvent({
      id: 'event-cheonggyecheon',
      title: e.cheonggyecheon.title,
      start: '17:30',
      end: '18:20',
      type: 'place',
      placeId: cheonggyecheon.id,
      travelMinutes: 5,
      note: e.cheonggyecheon.note,
    }),
    createEvent({
      id: 'event-namsan',
      title: e.namsan.title,
      start: '19:00',
      end: '21:00',
      type: 'place',
      placeId: namsan.id,
      importance: 'core',
      travelMinutes: 30,
      note: e.namsan.note,
    }),
    createEvent({
      id: 'event-departure',
      title: e.departure.title,
      start: '22:00',
      type: 'transport',
      placeId: station.id,
      fixed: true,
      note: e.departure.note,
    }),
  ];

  const plan: DatePlan = {
    id: 'plan-seoul-seed',
    title: copy.title,
    date,
    memo: copy.memo,
    availableFrom: { dayOffset: 0, time: '09:30' },
    mustEndBy: { dayOffset: 0, time: '22:00' },
    constraints: copy.constraints,
    events: events.map((event, order) => ({
      ...event,
      order,
      protectedFields: event.fixed ? ['time', 'place', 'content', 'delete', 'order'] : [],
    })),
    places,
    meeting: {
      placeId: station.id,
      locationNote: '2번 출구 앞',
      timing: { kind: 'exact', start: { dayOffset: 0, time: '09:30' } },
    },
    candidates: [
      {
        id: 'candidate-optional-market',
        title: copy.candidate,
        type: 'activity',
        proposedBy: 'DatePack',
      },
    ],
  };

  // Local generated placeholder assets (no remote image dependency).
  const coverSvg = skylineSvg(copy.coverText);
  const cafeSvg = cafeCardSvg(copy.cafeText);
  const coverAsset: DatePackAsset = {
    id: 'asset-seed-cover',
    filename: 'seoul-cover.svg',
    mimeType: 'image/svg+xml',
    path: assetPath('seoul-cover.svg'),
    createdAt: new Date().toISOString(),
  };
  const cafeAsset: DatePackAsset = {
    id: 'asset-seed-ikseondong',
    filename: 'ikseondong.svg',
    mimeType: 'image/svg+xml',
    path: assetPath('ikseondong.svg'),
    createdAt: new Date().toISOString(),
  };
  plan.coverAssetId = coverAsset.id;
  events[4].assetIds = [cafeAsset.id];

  const pack: DatePack = {
    manifest: {
      format: 'datepack',
      version: '3.0',
      entry: 'plan.json',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generator: 'datepack-web seed',
    },
    plan,
    baselinePlan: structuredClone(plan),
    experiences: [],
    revision: 0,
    assets: [coverAsset, cafeAsset],
  };

  const blobs = [
    { asset: coverAsset, blob: new Blob([coverSvg], { type: 'image/svg+xml' }) },
    { asset: cafeAsset, blob: new Blob([cafeSvg], { type: 'image/svg+xml' }) },
  ];

  return { pack, blobs };
}

function skylineSvg(text: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFE3EA"/>
      <stop offset="0.6" stop-color="#FFF3EC"/>
      <stop offset="1" stop-color="#FFD9C9"/>
    </linearGradient>
  </defs>
  <rect width="400" height="250" fill="url(#sky)"/>
  <circle cx="320" cy="64" r="26" fill="#FF6B8B" opacity="0.55"/>
  <g fill="#B98A8A" opacity="0.75">
    <rect x="20" y="150" width="34" height="100"/>
    <rect x="62" y="120" width="26" height="130"/>
    <rect x="96" y="165" width="40" height="85"/>
    <rect x="150" y="95" width="30" height="155"/>
    <rect x="188" y="140" width="44" height="110"/>
    <rect x="244" y="70" width="14" height="180"/>
    <circle cx="251" cy="66" r="10"/>
    <rect x="266" y="120" width="26" height="130"/>
    <rect x="300" y="150" width="36" height="100"/>
    <rect x="344" y="130" width="30" height="120"/>
  </g>
  <g fill="#A97F86" opacity="0.85">
    <rect x="126" y="102" width="5" height="148"/>
    <circle cx="128.5" cy="99" r="9"/>
    <rect x="127" y="84" width="3" height="10"/>
  </g>
  <g fill="#FFFFFF" opacity="0.5">
    <rect x="158" y="105" width="6" height="8"/><rect x="166" y="105" width="6" height="8"/>
    <rect x="158" y="120" width="6" height="8"/><rect x="196" y="152" width="6" height="8"/>
    <rect x="206" y="152" width="6" height="8"/><rect x="70" y="132" width="5" height="7"/>
  </g>
  <path d="M0 250 L0 210 Q100 190 200 208 T400 214 L400 250 Z" fill="#F7B8C4" opacity="0.8"/>
  <text x="28" y="52" font-family="Pretendard, sans-serif" font-size="24" font-weight="700" fill="#1F2937">${text}</text>
</svg>`;
}

function cafeCardSvg(text: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFE3EA"/>
      <stop offset="1" stop-color="#FFF7E8"/>
    </linearGradient>
  </defs>
  <rect width="400" height="250" fill="url(#bg)"/>
  <rect x="90" y="70" width="140" height="110" rx="16" fill="#FFFFFF"/>
  <rect x="104" y="86" width="112" height="14" rx="7" fill="#FFE3EA"/>
  <path d="M124 132 h64 v10 a32 32 0 0 1 -64 0 Z" fill="#C68A63"/>
  <path d="M188 128 h14 a10 10 0 0 1 0 20 h-14" fill="none" stroke="#C68A63" stroke-width="6"/>
  <path d="M140 118 q4 -8 0 -14 M156 118 q4 -8 0 -14" stroke="#E8B4A0" stroke-width="5" fill="none" stroke-linecap="round"/>
  <circle cx="316" cy="76" r="18" fill="#FF6B8B" opacity="0.35"/>
  <circle cx="60" cy="200" r="24" fill="#F7B8C4" opacity="0.5"/>
  <text x="96" y="222" font-family="Pretendard, sans-serif" font-size="20" font-weight="600" fill="#1F2937">${text}</text>
</svg>`;
}
