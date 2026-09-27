// DatePack format types.
// File format version follows major.minor ("2.0"). See schema.ts for the reader policy.

export const DATE_EVENT_TYPES = [
  'place',
  'meal',
  'cafe',
  'transport',
  'reservation',
  'activity',
  'note',
] as const;

export type DateEventType = (typeof DATE_EVENT_TYPES)[number];

/**
 * A portable date plan file.
 * On disk it is one JSON document (.datepack.json, format 2.0).
 */
export type DatePack = { manifest: DatePackManifest; plan: DatePlan; assets: DatePackAsset[] };

export type DatePackManifest = {
  format: 'datepack';
  version: string; // "2.0"
  /** Legacy ZIP field — meaningless in the JSON container, still normalized on read. */
  entry: 'plan.json';
  createdAt?: string;
  updatedAt?: string;
  generator?: string;
};

export type PlanConstraints = { must?: string[]; prefer?: string[]; avoid?: string[] };

export type DatePlan = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD (local)

  coverAssetId?: string;
  galleryAssetIds?: string[];
  memo?: string;

  constraints?: PlanConstraints;

  events: DateEvent[];
  places?: Place[];
};

export type DateEvent = {
  id: string;
  start: string; // HH:mm
  end?: string; // HH:mm

  title: string;
  type: DateEventType;

  placeId?: string;
  note?: string;
  assetIds?: string[];

  travelMinutes?: number;

  /** 고정 일정: AI patch와 재계획이 건드리지 않아야 하는 일정 */
  fixed?: boolean;

  planB?: PlanB;
};

export type PlanB = {
  trigger?: string;
  title: string;
  note?: string;
  replacementEventIds?: string[];
};

export type Place = {
  id: string;
  name: string;
  address?: string;
  mapQuery?: string;
  assetIds?: string[];
};

export type DatePackAsset = {
  id: string;
  filename: string;
  mimeType: string;
  /** Legacy ZIP path ("assets/cafe.jpg"); omitted in the JSON container. */
  path?: string;
  createdAt?: string;
  /**
   * JSON container only: the image inlined as a "data:<mime>;base64,…" URL.
   * Absent at runtime (blobs live in IndexedDB) and for assets whose blob
   * could not be loaded at export time.
   */
  data?: string;
};

// ---------------------------------------------------------------------------
// Runtime state (kept out of the .datepack file; stored in IndexedDB only)
// ---------------------------------------------------------------------------

export type EventRuntimeStatus = 'pending' | 'current' | 'completed' | 'skipped';

export type EventRuntimeState = {
  eventId: string;
  status: EventRuntimeStatus;
  delayedByMinutes?: number;
  activePlan?: 'A' | 'B';
};

export type DatePackRuntimeState = {
  planId: string;
  updatedAt: string;
  events: Record<string, EventRuntimeState>;
};

// ---------------------------------------------------------------------------
// AI patch (partial, event-id targeted)
// ---------------------------------------------------------------------------

export type DatePackPatchReplaceValue = Partial<
  Pick<
    DateEvent,
    'title' | 'start' | 'end' | 'type' | 'note' | 'travelMinutes' | 'placeId' | 'fixed'
  >
>;

export type DatePackPatchNewEvent = {
  title: string;
  start: string; // HH:mm
  end?: string;
  type?: DateEventType;
  note?: string;
  placeId?: string;
  travelMinutes?: number;
};

export type DatePackPatchOperation =
  | { op: 'replace'; target: string; value: DatePackPatchReplaceValue }
  | { op: 'move'; target: string; value: { start?: string; end?: string } }
  | { op: 'remove'; target: string }
  | { op: 'insertBefore'; target: string; value: DatePackPatchNewEvent }
  | { op: 'insertAfter'; target: string; value: DatePackPatchNewEvent };

export type DatePackPatch = {
  type: 'datepack.patch';
  version: 1;
  operations: DatePackPatchOperation[];
};
