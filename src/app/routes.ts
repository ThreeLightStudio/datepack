/** POC keeps navigation in memory: three views, no router dependency. */
export type ViewId = 'today' | 'plan' | 'details';

export const VIEW_TITLES: Record<ViewId, string> = {
  today: '오늘',
  plan: '전체 일정',
  details: '더보기',
};
