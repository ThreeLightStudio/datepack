/** DatePack v3 public data contract. Legacy file shapes live in migration.ts. */

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
export type LocalPoint = { dayOffset: 0 | 1; time: string };
export type EventTiming =
  | { kind: 'exact'; start: LocalPoint; end?: LocalPoint }
  | { kind: 'window'; earliestStart: LocalPoint; latestStart: LocalPoint }
  | { kind: 'unscheduled'; label?: string };
export type ProtectedField = 'time' | 'place' | 'content' | 'delete' | 'order';
export type Importance = 'core' | 'normal' | 'optional';

export type DatePack = {
  manifest: DatePackManifest;
  plan: DatePlan;
  /** Immutable starting point used for review and change comparison. */
  baselinePlan: DatePlan;
  experiences: Experience[];
  revision: number;
  assets: DatePackAsset[];
};
export type DatePackManifest = {
  format: 'datepack';
  version: string;
  entry: 'plan.json';
  createdAt?: string;
  updatedAt?: string;
  generator?: string;
};
export type PlanConstraints = { must?: string[]; prefer?: string[]; avoid?: string[] };
export type DatePlan = {
  id: string;
  title: string;
  /** Local YYYY-MM-DD; omit when the date is not known yet. */
  date?: string;
  availableFrom?: LocalPoint;
  mustEndBy?: LocalPoint;
  coverAssetId?: string;
  galleryAssetIds?: string[];
  memo?: string;
  constraints?: PlanConstraints;
  events: DateEvent[];
  candidates?: Candidate[];
  places?: Place[];
  meeting?: Meeting;
  /** Shared travel notes only. A person's own origin and route are never part of this type. */
  sharedTravel?: SharedTravel[];
};
export type DateEvent = {
  id: string;
  order: number;
  title: string;
  type: DateEventType;
  timing: EventTiming;
  placeId?: string;
  note?: string;
  assetIds?: string[];
  importance?: Importance;
  protectedFields?: ProtectedField[];
  estimatedDurationMinutes?: number;
  planB?: PlanB;
  /** @deprecated Runtime compatibility aliases for the v1/v2 app and patch adapter. Not written by v3. */
  start?: string;
  end?: string;
  fixed?: boolean;
  travelMinutes?: number;
};
export type Candidate = {
  id: string;
  title: string;
  type?: DateEventType;
  placeId?: string;
  note?: string;
  proposedBy?: string;
  assetIds?: string[];
  excluded?: boolean;
};
export type Meeting = { placeId?: string; locationNote?: string; timing?: EventTiming };
export type SharedTravel = {
  id: string;
  fromPlaceId?: string;
  toPlaceId?: string;
  note?: string;
  estimatedMinutes?: number;
  source?: 'user' | 'legacy';
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
export type Experience = {
  id: string;
  eventId?: string;
  title: string;
  outcome: 'completed' | 'skipped' | 'note';
  recordedAt: string;
  occurredOn?: string;
  timing?: { kind: 'exact'; at: LocalPoint } | { kind: 'approximate'; period: string };
  note?: string;
  assetIds?: string[];
  source?: { kind: 'user' | 'legacy'; format?: string; planId?: string; eventId?: string };
};
export type DatePackAsset = {
  id: string;
  filename: string;
  mimeType: string;
  path?: string;
  createdAt?: string;
  data?: string;
};

// Runtime state remains device-local and outside the portable file.
export type EventRuntimeStatus = 'pending' | 'current' | 'completed' | 'skipped';
export type EventRuntimeState = {
  eventId: string;
  status: EventRuntimeStatus;
  delayedByMinutes?: number;
  activePlan?: 'A' | 'B';
  /** User explicitly asked to keep an elapsed, unconfirmed event in the next plan. */
  includeInRemaining?: boolean;
};
export type DatePackRuntimeState = {
  planId: string;
  updatedAt: string;
  events: Record<string, EventRuntimeState>;
};

// Legacy patch surface retained for P0 callers; v3 timing is adapted at the boundary.
export type DatePackPatchReplaceValue = Partial<{
  title: string;
  start: string;
  end: string;
  type: DateEventType;
  note: string;
  travelMinutes: number;
  placeId: string;
  fixed: boolean;
}>;
export type DatePackPatchNewEvent = {
  title: string;
  start: string;
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

/** Historical structures accepted only by migration functions. */
export type LegacyDateEvent = {
  id: string;
  start: string;
  end?: string;
  title: string;
  type: DateEventType;
  placeId?: string;
  note?: string;
  assetIds?: string[];
  travelMinutes?: number;
  fixed?: boolean;
  planB?: PlanB;
};
export type LegacyDatePlan = {
  id: string;
  title: string;
  date: string;
  coverAssetId?: string;
  galleryAssetIds?: string[];
  memo?: string;
  constraints?: PlanConstraints;
  events: LegacyDateEvent[];
  places?: Place[];
};
export type LegacyDatePack = {
  manifest: DatePackManifest;
  plan: LegacyDatePlan;
  assets: DatePackAsset[];
};
