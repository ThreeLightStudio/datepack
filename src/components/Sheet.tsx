import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';
import { useLocale } from '../i18n';

type SheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  restoreFocus?: () => boolean;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const activeSheets = new Set<symbol>();
const SHEET_HISTORY_KEY = 'datepackSheet';
let returnFocus: HTMLElement | null = null;

/** Bottom sheet constrained to the 430px canvas.
 *  Manages focus: moves focus in on open, traps Tab, restores focus on close. */
export function Sheet({ open, title, onClose, children, restoreFocus }: SheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const restoreRef = useRef(restoreFocus);
  const locale = useLocale();

  useEffect(() => {
    closeRef.current = onClose;
    restoreRef.current = restoreFocus;
  }, [onClose, restoreFocus]);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const owner = Symbol();
    activeSheets.add(owner);
    if (!history.state?.[SHEET_HISTORY_KEY]) {
      returnFocus = document.activeElement as HTMLElement | null;
      history.pushState({ ...history.state, [SHEET_HISTORY_KEY]: true }, '');
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = Array.from(document.body.children).filter(
      (node) => node !== backdropRef.current,
    ) as HTMLElement[];
    const inertBefore = background.map((node) => node.inert);
    background.forEach((node) => {
      node.inert = true;
    });
    sheet?.focus();
    const onBack = () => closeRef.current();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !sheet) return;
      const focusables = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === sheet || !sheet.contains(active))) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && (active === last || active === sheet || !sheet.contains(active))) {
        first.focus();
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onBack);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onBack);
      activeSheets.delete(owner);
      document.body.style.overflow = overflow;
      background.forEach((node, index) => {
        node.inert = inertBefore[index];
      });
      // A same-render transition between sheets reuses one history entry.
      requestAnimationFrame(() => {
        if (activeSheets.size) return;
        if (history.state?.[SHEET_HISTORY_KEY]) history.back();
        if (restoreRef.current?.()) return;
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        else
          document.querySelector<HTMLElement>('.tab-item.active')?.focus({ preventScroll: true });
      });
    };
  }, [open]);

  useEffect(() => {
    if (open && sheetRef.current) {
      sheetRef.current.scrollTop = 0;
      sheetRef.current.focus({ preventScroll: true });
    }
  }, [open, title]);

  if (!open) return null;
  return createPortal(
    <div ref={backdropRef} className="sheet-backdrop" onClick={onClose} role="presentation">
      <section
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={locale === 'ko' ? '닫기' : 'Close'}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
