import type { DatePack, DatePackRuntimeState } from '@datepack/core';
import type { DeviceState, PendingRequest } from '../../storage/indexedDb';

export type LibraryActivity = {
  packId: string;
  title: string;
  continuing: boolean;
  request?: Pick<PendingRequest, 'id' | 'kind' | 'status' | 'updatedAt'> & {
    experienceId?: string;
  };
};

/** Read user evidence; a plan date never implies a started or completed outing. */
export function summarizeActivity(
  pack: DatePack,
  device: Pick<DeviceState, 'pendingRequest' | 'liveContext'>,
  runtime?: DatePackRuntimeState | null,
): LibraryActivity {
  const request = device.pendingRequest;
  const payload = request?.payload as { experienceId?: unknown } | undefined;
  return {
    packId: pack.id,
    title:
      pack.kind === 'outing'
        ? pack.plan.title
        : (pack.meta.title ?? pack.experiences[0]?.title ?? ''),
    continuing:
      pack.kind === 'outing' &&
      (Boolean(device.liveContext?.confirmedAt) ||
        Object.values(runtime?.events ?? {}).some((entry) => entry.status === 'current')),
    ...(request && request.planId === pack.id && !['applied', 'cancelled'].includes(request.status)
      ? {
          request: {
            id: request.id,
            kind: request.kind,
            status: request.status,
            updatedAt: request.updatedAt,
            ...(typeof payload?.experienceId === 'string'
              ? { experienceId: payload.experienceId }
              : {}),
          },
        }
      : {}),
  };
}
