import { useEffect, useRef, useState } from 'react';
import {
  createNewPack,
  getStoreState,
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
import { initialOutingForm, outingBrief } from '../features/outing/conditions';
import { OutingFields } from '../features/outing/OutingFields';
import { useAiForm } from '../features/ai/useAiDraft';
import { DraftSaveError } from '../features/ai/RequestHelp';
import { AiSection } from '../features/ai/AiSection';
import { MemoriesSection } from '../features/memories/MemoriesSection';
import type { RecordKey } from '../features/memories/recordLibrary';
import { Sheet, afterSheetsClose, sheetReturnFocus } from '../components/Sheet';
import type { TabId, ViewId } from './routes';
import { DotsIcon, HeartIcon, UndoIcon } from '../components/icons';

type AiTask = {
  historyId: string;
  kind: 'create' | 'plan' | 'memory';
  origin: ViewId;
  key?: RecordKey;
};

export default function App() {
  const store = useStore();
  const locale = useLocale();
  const ko = locale === 'ko';
  const [view, setView] = useState<ViewId>('home');
  const viewRef = useRef(view);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [task, setTask] = useState<AiTask | null>(null);
  const taskRef = useRef<AiTask | null>(null);
  const taskExit = useRef<ViewId | null>(null);
  const taskPositions = useRef(new Map<string, number>());
  const createForm = useAiForm('create', initialOutingForm);
  const { title, date } = createForm.value;
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const recordsRef = useRef<RecordHubHandle>(null);
  const positions = useRef(new Map<ViewId, { top: number; focus: HTMLElement | null }>());
  const primary: TabId =
    view === 'ai'
      ? task?.origin === 'records'
        ? 'records'
        : task?.origin === 'home'
          ? 'home'
          : 'plan'
      : view === 'today' || view === 'details'
        ? 'plan'
        : view;

  function openView(next: ViewId) {
    if (next === viewRef.current) return;
    if (next !== 'ai')
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
      else if (saved?.focus) {
        const label = saved.focus.getAttribute('aria-label');
        const text = saved.focus.textContent;
        const restored = [...document.querySelectorAll<HTMLElement>('button')].find((el) =>
          label ? el.getAttribute('aria-label') === label : el.textContent === text,
        );
        restored?.focus({ preventScroll: true });
      }
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
  function taskKey(value: AiTask) {
    const current = getStoreState();
    if (value.kind === 'memory') return `memory:${value.key?.packId}:${value.key?.experienceId}`;
    if (value.kind === 'create')
      return `create:${current.pendingRequest?.kind === 'create' ? current.pendingRequest.id : 'form'}`;
    return `plan:${current.document?.id}`;
  }
  function openTask(kind: AiTask['kind'], key?: RecordKey) {
    const origin = taskRef.current?.origin ?? viewRef.current;
    if (!taskRef.current)
      positions.current.set(origin, {
        top: window.scrollY,
        focus: sheetReturnFocus() ?? (document.activeElement as HTMLElement | null),
      });
    afterSheetsClose(() => {
      const next = {
        kind,
        origin,
        key,
        historyId: taskRef.current?.historyId ?? crypto.randomUUID(),
      };
      if (!taskRef.current)
        history.pushState({ ...history.state, datepackTask: next.historyId }, '');
      taskRef.current = next;
      setTask(next);
      positions.current.set('ai', {
        top: taskPositions.current.get(taskKey(next)) ?? 0,
        focus: null,
      });
      openView('ai');
      requestAnimationFrame(() =>
        document.getElementById('ai-task-title')?.focus({ preventScroll: true }),
      );
    });
  }
  function closeTask() {
    if (taskRef.current && history.state?.datepackTask === taskRef.current.historyId)
      history.back();
  }
  function openPlanAi() {
    openTask('plan');
  }
  async function resumeActivity(activity?: LibraryActivity) {
    try {
      if (activity) await switchPack(activity.packId);
      const request = activity?.request ?? store.pendingRequest;
      if (request?.kind === 'create') {
        openTask('create');
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
  async function makePlan() {
    if (creating) return;
    setCreating(true);
    try {
      await createNewPack(title, date, outingBrief(createForm.value));
      setCreateOpen(false);

      afterSheetsClose(() => openView('plan'));
    } catch {
      setCreateError(
        ko
          ? '날짜, 예산(0 이상), 소요 시간(1~1440분), 시작·마감을 확인해주세요. 저장 실패 시 입력은 유지돼요.'
          : 'Check date, nonnegative budget, duration (1–1440 min), and time window. Input is kept if saving fails.',
      );
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
    const restoredHistory = { ...history.state };
    delete restoredHistory.datepackTask;
    delete restoredHistory.datepackSheet;
    history.replaceState(restoredHistory, '');
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
    const onBack = () => {
      if (!taskRef.current || history.state?.datepackTask === taskRef.current.historyId) return;
      const previous = taskRef.current;
      taskPositions.current.set(taskKey(previous), window.scrollY);
      const destination = taskExit.current ?? previous.origin;
      const returningToRecord = !taskExit.current && previous.key;
      taskExit.current = null;
      taskRef.current = null;
      setTask(null);
      openView(destination);
      if (returningToRecord)
        requestAnimationFrame(() => recordsRef.current?.openRecord(previous.key!));
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

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
        {view !== 'home' && view !== 'ai' && (
          <RequestResume onResume={() => void resumeActivity()} onToday={() => openView('today')} />
        )}
        <div className="app-content">
          {view === 'ai' && task && (
            <div className="view ai-task-screen">
              <button type="button" className="btn btn-ghost" onClick={closeTask}>
                {ko ? '돌아가기 · 입력은 보관돼요' : 'Back · input is kept'}
              </button>
              <h1 id="ai-task-title" className="plan-title" tabIndex={-1}>
                {task.kind === 'create'
                  ? ko
                    ? 'AI와 외출 만들기'
                    : 'Plan an outing with AI'
                  : task.kind === 'memory'
                    ? ko
                      ? '기록 문장 다듬기'
                      : 'Polish memory wording'
                    : ko
                      ? 'AI로 다시 계획하기'
                      : 'Replan with AI'}
              </h1>
              {task.kind === 'create' && <CreateWithAiSheet open onClose={closeTask} />}
              {task.kind === 'plan' && store.pack && (
                <AiSection key={store.pack.id} plan={store.pack.plan} runtime={store.runtime} />
              )}
              {task.kind === 'memory' &&
                task.key &&
                (() => {
                  const doc = store.document?.id === task.key.packId ? store.document : null;
                  const record = doc?.experiences.find((e) => e.id === task.key?.experienceId);
                  return record ? (
                    <MemoriesSection key={`${doc!.id}:${record.id}`} experience={record} />
                  ) : (
                    <p>{ko ? '기록을 다시 열어주세요.' : 'Reopen the memory.'}</p>
                  );
                })()}
            </div>
          )}
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
                      onOpenAi={openPlanAi}
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
            onOpenAi={(key) => openTask('memory', key)}
          />
        </div>
        {view !== 'ai' && <TabBar current={primary} onSelect={openView} />}
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
          afterSheetsClose(() => {
            if (taskRef.current) {
              taskExit.current = 'details';
              closeTask();
            } else openView('details');
          });
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
            openTask('create');
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
            void makePlan();
          }}
        >
          <h3>{ko ? '직접 만들기' : 'Make your own'}</h3>
          <label className="field">
            <span>{ko ? '계획 이름 (선택)' : 'Plan name (optional)'}</span>
            <input
              value={title}
              onChange={(event) => createForm.change('title', event.target.value)}
              maxLength={160}
              disabled={creating}
            />
          </label>
          <OutingFields value={createForm.value} change={createForm.change} disabled={creating} />
          {createForm.error && <DraftSaveError retry={createForm.retry} />}
          {createError && (
            <p className="form-error" role="alert">
              {createError}
            </p>
          )}
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
