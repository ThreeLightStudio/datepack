import type { OutingConditions } from './types';

export function isValidOutingConditions(value: unknown): value is OutingConditions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) => !['party', 'region', 'budget', 'durationMinutes', 'nearby', 'singleStop'].includes(k),
    )
  )
    return false;
  for (const field of ['nearby', 'singleStop'])
    if (v[field] !== undefined && typeof v[field] !== 'boolean') return false;
  if (v.party !== undefined && !['solo', 'together'].includes(String(v.party))) return false;
  if (v.region !== undefined && (typeof v.region !== 'string' || !v.region.trim())) return false;
  if (
    v.durationMinutes !== undefined &&
    (!Number.isInteger(v.durationMinutes) ||
      Number(v.durationMinutes) <= 0 ||
      Number(v.durationMinutes) > 1440)
  )
    return false;
  if (v.budget !== undefined) {
    if (!v.budget || typeof v.budget !== 'object' || Array.isArray(v.budget)) return false;
    const b = v.budget as Record<string, unknown>;
    if (
      Object.keys(b).some((k) => !['currency', 'amount', 'basis'].includes(k)) ||
      b.currency !== 'KRW' ||
      !['total', 'per-person'].includes(String(b.basis)) ||
      !Number.isSafeInteger(b.amount) ||
      Number(b.amount) < 0
    )
      return false;
  }
  return true;
}
