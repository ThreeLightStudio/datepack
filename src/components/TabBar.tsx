import { ListIcon, CameraIcon, HeartIcon } from './icons';
import type { ReactElement } from 'react';
import type { TabId } from '../app/routes';
import { useLocale } from '../i18n';

const LABELS: Record<TabId, { ko: string; en: string }> = {
  home: { ko: '홈', en: 'Home' },
  plan: { ko: '일정', en: 'Plans' },
  records: { ko: '기록', en: 'Memories' },
};

const ICONS: Record<
  TabId,
  (p: { width: number; height: number; fill?: string; stroke?: string }) => ReactElement
> = { home: HeartIcon, plan: ListIcon, records: CameraIcon };

type Props = { current: TabId; onSelect: (view: TabId) => void };

export function TabBar({ current, onSelect }: Props) {
  const locale = useLocale();
  return (
    <nav className="tab-bar" aria-label={locale === 'ko' ? '주요 화면' : 'Main navigation'}>
      {(Object.keys(LABELS) as TabId[]).map((id) => {
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
