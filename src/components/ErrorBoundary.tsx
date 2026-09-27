import { Component, type ErrorInfo, type ReactNode } from 'react';
import { HeartIcon } from './icons';

type Props = { children: ReactNode };
type State = { error: Error | null };

const FALLBACK = {
  ko: {
    title: '화면을 그리다 문제가 생겼어요',
    body: '저장된 데이터는 그대로 남아 있어요. 새로고침하면 다시 시작할 수 있어요.',
    reload: '새로고침',
  },
  en: {
    title: 'Something went wrong while drawing the screen',
    body: 'Your saved data is untouched. Reload to start again.',
    reload: 'Reload',
  },
} as const;

/** Last-resort crash guard: no white screens, ever. Data stays in IndexedDB. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[datepack] render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const locale =
      typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko')
        ? FALLBACK.ko
        : FALLBACK.en;
    return (
      <main className="app-shell center">
        <div className="empty">
          <div className="empty-logo">
            <HeartIcon width={34} height={34} />
            <h1>{locale.title}</h1>
          </div>
          <p className="tagline">{locale.body}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            {locale.reload}
          </button>
        </div>
      </main>
    );
  }
}
