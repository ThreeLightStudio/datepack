import { isValidDateISO, isValidTime, type DatePlan } from '@datepack/core';

export const initialOutingForm = {
  title: '',
  region: '',
  date: '',
  party: '',
  budget: '',
  budgetBasis: 'total',
  nearby: '',
  singleStop: '',
  durationMinutes: '',
  startTime: '',
  endTime: '',
  endDay: '0',
  notes: '',
  importText: '',
  mode: 'request',
};
export type OutingForm = typeof initialOutingForm;

/** One interpretation for direct creation, AI creation, and condition editing. */
export function outingBrief(
  form: OutingForm,
): Pick<DatePlan, 'outingConditions' | 'availableFrom' | 'mustEndBy'> {
  if (form.date && !isValidDateISO(form.date)) throw new Error('date');
  if (form.party && !['solo', 'together'].includes(form.party)) throw new Error('party');
  const number = (raw: string, max: number, zero: boolean) => {
    if (!raw.trim()) return undefined;
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) > max ||
      Number(raw) < (zero ? 0 : 1)
    )
      throw new Error('number');
    return Number(raw);
  };
  if (!['total', 'per-person'].includes(form.budgetBasis)) throw new Error('basis');
  for (const flag of [form.nearby, form.singleStop])
    if (!['', 'yes'].includes(flag)) throw new Error('flag');
  const amount = number(form.budget, Number.MAX_SAFE_INTEGER, true);
  const durationMinutes = number(form.durationMinutes, 1440, false);
  if (form.endDay !== '0' && form.endDay !== '1') throw new Error('day');
  for (const time of [form.startTime, form.endTime])
    if (time && !isValidTime(time)) throw new Error('time');
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  if (form.startTime && form.endTime) {
    const span = Number(form.endDay) * 1440 + mins(form.endTime) - mins(form.startTime);
    if (span < 0 || span > 1440) throw new Error('window');
  }
  return {
    outingConditions: {
      ...(form.nearby ? { nearby: true } : {}),
      ...(form.singleStop ? { singleStop: true } : {}),
      ...(form.party ? { party: form.party as 'solo' | 'together' } : {}),
      ...(form.region.trim() ? { region: form.region.trim() } : {}),
      ...(amount !== undefined
        ? { budget: { currency: 'KRW', amount, basis: form.budgetBasis as 'total' | 'per-person' } }
        : {}),
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    },
    availableFrom: form.startTime ? { dayOffset: 0, time: form.startTime } : undefined,
    mustEndBy: form.endTime
      ? { dayOffset: Number(form.endDay) as 0 | 1, time: form.endTime }
      : undefined,
  };
}

export function conditionsText(
  plan: Pick<DatePlan, 'outingConditions' | 'availableFrom' | 'mustEndBy'>,
  ko: boolean,
): string {
  const c = plan.outingConditions;
  return [
    c?.party ? (c.party === 'solo' ? (ko ? '혼자' : 'Solo') : ko ? '함께' : 'Together') : '',
    c?.region,
    c?.budget
      ? `${new Intl.NumberFormat(ko ? 'ko-KR' : 'en-US').format(c.budget.amount)} ${ko ? '원 이내' : 'KRW ceiling'} · ${c.budget.basis === 'per-person' ? (ko ? '한 사람당' : 'per person') : ko ? '전체' : 'total'}`
      : '',
    c?.nearby ? (ko ? '가까운 이동 선호' : 'Nearby travel preferred') : '',
    c?.singleStop ? (ko ? '한 곳만 방문' : 'Only one stop') : '',
    c?.durationMinutes ? `${c.durationMinutes}${ko ? '분 정도' : ' min approximately'}` : '',
    plan.availableFrom ? `${plan.availableFrom.time}${ko ? '부터' : ' onwards'}` : '',
    plan.mustEndBy
      ? `${plan.mustEndBy.dayOffset ? (ko ? '다음 날 ' : 'Next day ') : ''}${plan.mustEndBy.time}${ko ? '까지' : ' latest'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
