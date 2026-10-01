import { useRef, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import {
  deletePackById,
  exportPackById,
  importPackFile,
  loadDemoPack,
  useStore,
} from '../../store/datepackStore';
import { LOCALES, localizeAll, setLocale, useLocale } from '../../i18n';
import { version } from '../../../package.json';
import { REPO_URL } from '../../app/meta';

export function AppMenu({
  open,
  onClose,
  onPlanTools,
}: {
  open: boolean;
  onClose: () => void;
  onPlanTools: () => void;
}) {
  const { savedDocuments, pack } = useStore();
  const locale = useLocale();
  const ko = locale === 'ko';
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      setError(
        typeof reason === 'object' && reason !== null && 'issues' in reason
          ? localizeAll(locale, (reason as { issues: never[] }).issues).join('\n')
          : ko
            ? '파일 작업을 완료하지 못했어요. 저장 공간과 파일을 확인하고 다시 시도하세요.'
            : 'Could not complete this file action. Check storage and the file, then retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={open}
      title={ko ? '메뉴' : 'Menu'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="menu-section">
        <h3>{ko ? '언어' : 'Language'}</h3>
        <div className="lang-switch" role="group" aria-label={ko ? '언어' : 'Language'}>
          {LOCALES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`lang-btn ${locale === id ? 'active' : ''}`}
              aria-pressed={locale === id}
              onClick={() => setLocale(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <section className="menu-section">
        <h3>{ko ? '파일 관리' : 'Files'}</h3>
        <p className="hint-text">
          {ko
            ? '사진과 기록은 이 기기에 저장돼요. 파일로 내려받아 보관하거나 다른 기기에서 여세요.'
            : 'Photos and memories stay on this device. Download a file to keep a copy or open it on another device.'}
        </p>
        <button
          type="button"
          className="btn btn-soft"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {ko ? '.datepack.json 파일 열기' : 'Open a .datepack.json file'}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".json,.datepack.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void action(() => importPackFile(file));
          }}
        />
        <ul className="menu-file-list">
          {savedDocuments.map(({ pack }) => (
            <li key={pack.id}>
              <strong>
                {pack.kind === 'outing'
                  ? pack.plan.title
                  : pack.meta.title || (ko ? '사진과 기록' : 'Photos and memories')}
              </strong>
              <span className="hint-text">
                {pack.kind === 'outing'
                  ? ko
                    ? '외출 계획'
                    : 'Outing plan'
                  : ko
                    ? '독립 기록'
                    : 'Independent memories'}{' '}
                · {ko ? `기록 ${pack.experiences.length}개` : `${pack.experiences.length} memories`}
              </span>
              <div className="action-row">
                <button
                  type="button"
                  className="text-action"
                  disabled={busy}
                  onClick={() => void action(() => exportPackById(pack.id))}
                >
                  {ko ? '파일 내려받기' : 'Download file'}
                </button>
                <button
                  type="button"
                  className="text-action danger"
                  disabled={busy}
                  onClick={() => {
                    const message =
                      pack.kind === 'outing'
                        ? ko
                          ? '이 계획을 삭제할까요? 연결된 기록과 사진은 독립 기록으로 보존돼요.'
                          : 'Delete this plan? Linked memories and photos will be kept as independent memories.'
                        : ko
                          ? '이 문서의 기록과 사진을 모두 삭제할까요? 되돌릴 수 없어요.'
                          : 'Delete every memory and photo in this document? This cannot be undone.';
                    if (window.confirm(message)) void action(() => deletePackById(pack.id));
                  }}
                >
                  {pack.kind === 'outing'
                    ? ko
                      ? '계획 삭제'
                      : 'Delete plan'
                    : ko
                      ? '문서 삭제'
                      : 'Delete document'}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {pack && (
          <button type="button" className="btn btn-soft" disabled={busy} onClick={onPlanTools}>
            {ko ? '선택한 계획의 사진·AI 도구' : 'Photos and AI tools for selected plan'}
          </button>
        )}
      </section>
      <section className="menu-section">
        <h3>{ko ? 'DatePack 정보' : 'About DatePack'}</h3>
        <p className="hint-text">
          {ko ? '모든 데이터는 이 기기에만 저장돼요.' : 'Everything stays on this device.'}
        </p>
        <p className="hint-text">
          v{version} · Public Beta ·{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void action(loadDemoPack)}
        >
          {ko ? '예제 계획 열기' : 'Open sample plan'}
        </button>
      </section>
    </Sheet>
  );
}
