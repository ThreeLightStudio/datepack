import { useEffect, useRef, useState } from 'react';
import {
  createNewPack,
  dismissToast,
  initStore,
  refreshLibrary,
  showToast,
  switchPack,
  undo,
  useStore,
} from '../store/datepackStore';
import { localizeAll, useLocale } from '../i18n';
import { DayView } from '../features/day/DayView';
import { PlanView } from '../features/plan/PlanView';
import { DetailsView } from '../features/details/DetailsView';
import { RequestResume } from '../features/ai/RequestResume';
import { CreateWithAiSheet } from '../features/ai/CreateWithAiSheet';
import { HomeView, PlanSummary } from '../features/home/HomeView';
import { AppMenu } from '../features/home/AppMenu';
import type { LibraryActivity } from '../features/home/libraryActivity';
import { RecordHub, type RecordHubHandle } from '../features/memories/RecordHub';
import { TabBar } from '../components/TabBar';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { BetaBanner } from '../components/BetaBanner';
import { Sheet } from '../components/Sheet';
import type { TabId, ViewId } from './routes';
import { DotsIcon, HeartIcon, UndoIcon } from '../components/icons';

export default function App() {
  const store = useStore();
  const locale = useLocale();
  const ko = locale === 'ko';
  const [view, setView] = useState<ViewId>('home');
  const viewRef = useRef(view);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [aiCreateOpen, setAiCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [resumeTarget, setResumeTarget] = useState('');
  const recordsRef = useRef<RecordHubHandle>(null);
  const positions = useRef(new Map<ViewId, { top: number; focus: HTMLElement | null }>());
  const primary: TabId = view === 'today' || view === 'details' ? 'plan' : view;

  function openView(next: ViewId) {
    if (next === viewRef.current) return;
    positions.current.set(viewRef.current, {
      top: window.scrollY,
      focus: document.activeElement as HTMLElement | null,
    });
    viewRef.current = next;
    setView(next);
    requestAnimationFrame(() => {
      const saved = positions.current.get(next);
      window.scrollTo({ top: saved?.top ?? 0 });
      if (saved?.focus?.isConnected) saved.focus.focus({ preventScroll: true });
    });
  }
  async function openPlan(id: string, today = false) {
    try {
      await switchPack(id);
      openView(today ? 'today' : 'plan');
    } catch {
      showToast(
        ko ? '계획을 열지 못했어요. 다시 시도하세요.' : 'Could not open the plan. Try again.',
      );
    }
  }
  function openPlanAi() {
    setResumeTarget('ai-section');
    openView('details');
  }
  async function resumeActivity(activity?: LibraryActivity) {
    try {
      if (activity) await switchPack(activity.packId);
      const request = activity?.request ?? store.pendingRequest;
      if (request?.kind === 'create') {
        setAiCreateOpen(true);
        return;
      }
      if (request?.kind === 'memory-edit') {
        const experienceId =
          activity?.request?.experienceId ??
          (store.pendingRequest?.payload as { experienceId?: string })?.experienceId;
        const packId = activity?.packId ?? store.document?.id;
        if (packId && experienceId) {
          openView('records');
          recordsRef.current?.resumeAi({ packId, experienceId });
        }
        return;
      }
      openPlanAi();
    } catch {
      showToast(
        ko ? '요청을 열지 못했어요. 다시 시도하세요.' : 'Could not open this request. Try again.',
      );
    }
  }
  async function makePlan(chosenDate = date) {
    if (creating) return;
    setCreating(true);
    try {
      await createNewPack(title, chosenDate);
      setCreateOpen(false);
      setTitle('');
      setDate('');
      openView('plan');
    } catch {
      showToast(
        ko
          ? '계획을 저장하지 못했어요. 입력은 그대로예요.'
          : 'Could not save this plan. Your input is kept.',
      );
    } finally {
      setCreating(false);
    }
  }
  useEffect(() => {
    void initStore();
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshLibrary().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  useEffect(() => {
    if (view !== 'details' || !resumeTarget) return;
    const target = document.getElementById(resumeTarget);
    target?.scrollIntoView({ block: 'start' });
    target?.focus();
    setResumeTarget('');
  }, [view, resumeTarget]);

  if (store.status === 'loading')
    return (
      <main className="app-shell center">
        <div className="boot">
          <HeartIcon width={30} height={30} />
          <p>DatePack</p>
        </div>
      </main>
    );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-topbar">
          <span className="brand">
            <HeartIcon width={16} height={16} />
            DatePack
          </span>
          <div className="header-actions">
            {store.undoStack.length > 0 && (
              <button type="button" className="undo-chip" onClick={() => void undo()}>
                <UndoIcon width={14} height={14} />
                {ko ? '되돌리기' : 'Undo'}
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={ko ? '메뉴' : 'Menu'}
              onClick={() => setMenuOpen(true)}
            >
              <DotsIcon />
            </button>
          </div>
        </div>
        <BetaBanner />
      </header>
      <ErrorBoundary>
        {store.error && (
          <div className="storage-error" role="alert">
            <p>
              {ko
                ? '저장 공간을 열지 못했어요. 다시 시도해주세요.'
                : 'Could not open local storage. Try again.'}
            </p>
            <button type="button" className="btn btn-soft" onClick={() => void initStore()}>
              {ko ? '다시 시도' : 'Retry'}
            </button>
          </div>
        )}
        {view !== 'home' && (
          <RequestResume onResume={() => void resumeActivity()} onToday={() => openView('today')} />
        )}
        <div className="app-content">
          {view === 'home' && (
            <HomeView
              onCreate={() => setCreateOpen(true)}
              onPhoto={() => recordsRef.current?.choosePhotos()}
              onOpenPlan={(id, today) => void openPlan(id, today)}
              onRecords={() => openView('records')}
              onRecord={(key) => recordsRef.current?.openRecord(key)}
              onResume={(activity) => void resumeActivity(activity)}
            />
          )}
          {(view === 'plan' || view === 'today' || view === 'details') && (
            <>
              <div className="plan-navigation">
                <label className="field">
                  <span>{ko ? '선택한 계획' : 'Selected plan'}</span>
                  <select
                    value={store.pack?.id ?? ''}
                    onChange={(event) => {
                      if (event.target.value) void openPlan(event.target.value);
                    }}
                  >
                    <option value="">{ko ? '계획 선택' : 'Choose a plan'}</option>
                    {store.savedPacks.map(({ pack }) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.plan.title}
                      </option>
                    ))}
                  </select>
                </label>
                {store.pack && (
                  <div
                    className="plan-view-switch"
                    role="group"
                    aria-label={ko ? '계획 화면' : 'Plan view'}
                  >
                    <button
                      type="button"
                      aria-pressed={view === 'today'}
                      onClick={() => openView('today')}
                    >
                      {ko ? '지금' : 'Now'}
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === 'plan'}
                      onClick={() => openView('plan')}
                    >
                      {ko ? '전체 일정' : 'Full plan'}
                    </button>
                  </div>
                )}
              </div>
              {!store.pack ? (
                <div className="view">
                  <h1 className="plan-title">{ko ? '외출 계획' : 'Outing plans'}</h1>
                  <p className="empty-inline">
                    {ko
                      ? '계획을 고르거나 새로 만들어보세요. 기록은 계획 없이도 남길 수 있어요.'
                      : 'Choose or create a plan. You can keep memories without one.'}
                  </p>
                  {store.savedPacks.map((row) => (
                    <PlanSummary
                      key={row.pack.id}
                      row={row}
                      onOpen={() => void openPlan(row.pack.id)}
                    />
                  ))}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    {ko ? '계획 만들기' : 'Make a plan'}
                  </button>
                </div>
              ) : (
                <>
                  {view === 'today' && (
                    <DayView
                      plan={store.pack.plan}
                      runtime={store.runtime}
                      onOpenAi={openPlanAi}
                      onOpenPlan={() => openView('plan')}
                    />
                  )}
                  {view === 'plan' && (
                    <PlanView
                      plan={store.pack.plan}
                      runtime={store.runtime}
                      onOpenAi={openPlanAi}
                    />
                  )}
                  {view === 'details' && (
                    <DetailsView
                      plan={store.pack.plan}
                      runtime={store.runtime}
                      onOpenCreate={() => setCreateOpen(true)}
                    />
                  )}
                </>
              )}
            </>
          )}
          <RecordHub
            ref={recordsRef}
            visible={view === 'records'}
            onOpenTask={() => openView('records')}
          />
        </div>
        <TabBar current={primary} onSelect={openView} />
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
      <AppMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onPlanTools={() => {
          setMenuOpen(false);
          openView('details');
        }}
      />
      <Sheet
        open={createOpen}
        title={ko ? '계획 만들기' : 'Make a plan'}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setCreateOpen(false);
            setAiCreateOpen(true);
          }}
        >
          {ko ? 'AI와 계획 만들기' : 'Plan with AI'}
        </button>
        <p className="hint-text">
          {ko
            ? '사용하는 AI 앱에 요청하고, 돌아와 답안을 가져오세요.'
            : 'Ask your AI app, then bring its reply back here.'}
        </p>
        <form
          className="form create-plan-form"
          onSubmit={(event) => {
            event.preventDefault();
            const chosenDate = String(new FormData(event.currentTarget).get('plan-date') ?? '');
            setDate(chosenDate);
            void makePlan(chosenDate);
          }}
        >
          <h3>{ko ? '직접 만들기' : 'Make your own'}</h3>
          <label className="field">
            <span>{ko ? '계획 이름 (선택)' : 'Plan name (optional)'}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              disabled={creating}
            />
          </label>
          <label className="field">
            <span>{ko ? '날짜 (선택)' : 'Date (optional)'}</span>
            <input
              type="date"
              name="plan-date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={creating}
            />
          </label>
          <button type="submit" className="btn btn-soft" disabled={creating}>
            {creating
              ? ko
                ? '저장 중…'
                : 'Saving…'
              : ko
                ? '빈 계획 만들기'
                : 'Create an empty plan'}
          </button>
        </form>
      </Sheet>
      <CreateWithAiSheet open={aiCreateOpen} onClose={() => setAiCreateOpen(false)} />
    </main>
  );
}

/** Import errors carry localizable core issues. */
export function showImportError(error: unknown, locale: 'ko' | 'en'): void {
  const hasIssues = typeof error === 'object' && error !== null && 'issues' in error;
  alert(
    hasIssues
      ? localizeAll(locale, (error as { issues: never[] }).issues).join('\n')
      : error instanceof Error
        ? error.message
        : String(error),
  );
}
