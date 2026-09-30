import { useEffect, useState } from 'react';
import {
  createNewPack,
  dismissToast,
  importPackFile,
  initStore,
  loadDemoPack,
  undo,
  useStore,
} from '../store/datepackStore';
import { localizeAll, format, useLocale, setLocale, LOCALES } from '../i18n';
import { DayView } from '../features/day/DayView';
import { PlanView } from '../features/plan/PlanView';
import { DetailsView } from '../features/details/DetailsView';
import { RequestResume } from '../features/ai/RequestResume';
import { CreateWithAiSheet } from '../features/ai/CreateWithAiSheet';
import { TabBar } from '../components/TabBar';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { BetaBanner } from '../components/BetaBanner';
import type { ViewId } from './routes';
import { HeartIcon, UndoIcon } from '../components/icons';

export default function App() {
  const [aiCreateOpen, setAiCreateOpen] = useState(false);
  return (
    <>
      <AppContent onOpenCreate={() => setAiCreateOpen(true)} />
      <CreateWithAiSheet open={aiCreateOpen} onClose={() => setAiCreateOpen(false)} />
    </>
  );
}

function AppContent({ onOpenCreate }: { onOpenCreate: () => void }) {
  const store = useStore();
  const locale = useLocale();
  const [view, setView] = useState<ViewId>('today');
  const [resumeTarget, setResumeTarget] = useState('');

  useEffect(() => {
    if (view !== 'details' || !resumeTarget) return;
    const target = document.getElementById(resumeTarget);
    target?.scrollIntoView({ block: 'start' });
    target?.focus();
    setResumeTarget('');
  }, [view, resumeTarget]);

  function openView(next: ViewId): void {
    setView(next);
    window.scrollTo({ top: 0 });
  }

  function resumeRequest(): void {
    if (store.pendingRequest?.kind === 'create') {
      onOpenCreate();
      return;
    }
    const payload = store.pendingRequest?.payload as { experienceId?: string } | undefined;
    setResumeTarget(
      store.pendingRequest?.kind === 'memory-edit'
        ? `memory-${payload?.experienceId}`
        : 'ai-section',
    );
    setView('details');
  }

  useEffect(() => {
    void initStore();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  if (store.status === 'loading') {
    return (
      <main className="app-shell center">
        <div className="boot">
          <HeartIcon width={30} height={30} />
          <p>DatePack</p>
        </div>
      </main>
    );
  }

  if (store.status === 'empty' || !store.pack) {
    return <EmptyState error={store.error} onOpenCreate={onOpenCreate} />;
  }

  const { pack, runtime } = store;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-topbar">
          <span className="brand">
            <HeartIcon width={16} height={16} /> DatePack
          </span>
          {store.undoStack.length > 0 && (
            <button type="button" className="undo-chip" onClick={undo}>
              <UndoIcon width={14} height={14} /> {locale === 'ko' ? '되돌리기' : 'Undo'}
            </button>
          )}
        </div>
        <BetaBanner />
      </header>

      <ErrorBoundary key={locale}>
        <RequestResume onResume={resumeRequest} onToday={() => openView('today')} />
        <div className="app-content">
          {view === 'today' && (
            <DayView
              plan={pack.plan}
              runtime={runtime}
              onOpenAi={() => {
                setResumeTarget('ai-section');
                setView('details');
              }}
              onOpenPlan={() => openView('plan')}
            />
          )}
          {view === 'plan' && (
            <PlanView
              plan={pack.plan}
              runtime={runtime}
              onOpenAi={() => {
                setResumeTarget('ai-section');
                setView('details');
              }}
            />
          )}
          {view === 'details' && (
            <DetailsView plan={pack.plan} runtime={runtime} onOpenCreate={onOpenCreate} />
          )}
        </div>

        <TabBar current={view} onSelect={openView} />

        {store.toast && (
          <div className="toast" role="status">
            <span>{store.toast.message}</span>
            {store.toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  const action = store.toast!.action!;
                  dismissToast();
                  action.onClick();
                }}
              >
                {store.toast.action.label}
              </button>
            )}
          </div>
        )}
      </ErrorBoundary>
    </main>
  );
}

function EmptyState({ error, onOpenCreate }: { error?: string | null; onOpenCreate: () => void }) {
  const locale = useLocale();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');

  return (
    <main className="app-shell center">
      <div className="empty">
        <div className="empty-lang-row">
          <div className="lang-switch" role="group" aria-label={format(locale, 'empty.lang')}>
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
        </div>
        <BetaBanner />
        <div className="empty-logo">
          <HeartIcon width={34} height={34} />
          <h1>DatePack</h1>
        </div>
        <p className="tagline">
          {locale === 'ko' ? '지금, 더 좋은 하루를 함께.' : 'Plan less. Be together.'}
        </p>
        {error && (
          <p className="form-error">
            {(locale === 'ko'
              ? '저장 공간을 여는데 실패했어요: '
              : "Couldn't open local storage: ") + error}
          </p>
        )}

        <div className="empty-form">
          <button type="button" className="btn btn-primary" onClick={onOpenCreate}>
            {format(locale, 'create.btn')}
          </button>
          <p className="hint-text">{format(locale, 'create.btn.sub')}</p>

          <div className="divider" />

          <label className="field">
            <span>{locale === 'ko' ? '데이트 이름' : 'Date name'}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={format(locale, 'empty.namePlaceholder')}
            />
          </label>
          <label className="field">
            <span>{locale === 'ko' ? '날짜 (선택)' : 'Date (optional)'}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => void createNewPack(title, date)}
          >
            {format(locale, 'empty.create')}
          </button>
          <label className="btn btn-ghost file-btn">
            {format(locale, 'empty.openFile')}
            <input
              type="file"
              accept=".json,.datepack.json,.datepack,.zip"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importPackFile(file).catch((err) => showImportError(err, locale));
                e.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void loadDemoPack().catch((err) => showImportError(err, locale))}
          >
            {format(locale, 'empty.demo')}
          </button>
        </div>
      </div>
    </main>
  );
}

/** Import errors carry localizable issues — render them in the active language. */
export function showImportError(error: unknown, locale: 'ko' | 'en'): void {
  const hasIssues = typeof error === 'object' && error !== null && 'issues' in error;
  if (hasIssues) {
    alert(localizeAll(locale, (error as { issues: never[] }).issues).join('\n'));
  } else {
    alert(error instanceof Error ? error.message : String(error));
  }
}
