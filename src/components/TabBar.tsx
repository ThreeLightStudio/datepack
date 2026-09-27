import { ListIcon, DotsIcon, HeartIcon } from './icons';
import type { ReactElement } from 'react';
import type { ViewId } from '../app/routes';
import { useLocale } from '../i18n';

const LABELS: Record<ViewId, { ko: string; en: string }> = {
  today: { ko: '오늘', en: 'Today' },
  plan: { ko: '전체 일정', en: 'Itinerary' },
  details: { ko: '더보기', en: 'More' },
};

const ICONS: Record<
  ViewId,
  (p: { width: number; height: number; fill?: string; stroke?: string }) => ReactElement
> = { today: HeartIcon, plan: ListIcon, details: DotsIcon };

type Props = { current: ViewId; onSelect: (view: ViewId) => void };

export function TabBar({ current, onSelect }: Props) {
  const locale = useLocale();
  return (
    <nav className="tab-bar" aria-label={LABELS.plan[locale]}>
      {(Object.keys(LABELS) as ViewId[]).map((id) => {
        const active = current === id;
        const Icon = ICONS[id];
        return (
          <button
            key={id}
            type="button"
            className={`tab-item ${active ? 'active' : ''}`}
            onClick={() => onSelect(id)}
            aria-current={active ? 'page' : undefined}
          >
            {/* inactive heart keeps a stroked weight so all three tabs read evenly */}
            <Icon
              width={22}
              height={22}
              fill={active ? undefined : 'none'}
              stroke={active ? undefined : 'currentColor'}
            />
            <span>{LABELS[id][locale]}</span>
          </button>
        );
      })}
    </nav>
  );
}
