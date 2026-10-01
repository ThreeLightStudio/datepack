/** Primary areas and contextual plan views share a small in-memory navigator. */
export type TabId = 'home' | 'plan' | 'records';
export type ViewId = TabId | 'today' | 'details';

export const VIEW_TITLES: Record<ViewId, string> = {
  home: '홈',
  records: '기록',
  today: '오늘',
  plan: '전체 일정',
  details: '더보기',
};
