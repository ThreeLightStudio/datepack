import { version as APP_VERSION } from '../../package.json';
import { useLocale } from '../i18n';
import { REPO_URL } from '../app/meta';

/** 0.x releases ship as Public Beta — the slip hides itself from 1.0 on. */
export function BetaBanner() {
  const locale = useLocale();
  if (!APP_VERSION.startsWith('0.')) return null;
  return (
    <div className="beta-banner" role="note">
      <span className="beta-badge">Public Beta</span>
      <span className="beta-msg">
        {locale === 'ko'
          ? '아직 안정화 중이에요 — 피드백을 남겨주세요'
          : 'Still stabilizing — feedback welcome'}
      </span>
      <a className="beta-link" href={REPO_URL} target="_blank" rel="noreferrer">
        v{APP_VERSION} · GitHub ↗
      </a>
    </div>
  );
}
