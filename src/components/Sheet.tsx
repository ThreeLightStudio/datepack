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
const sheetBackdrops = new Map<symbol, HTMLElement | null>();
const originalInert = new Map<HTMLElement, boolean>();
let originalOverflow = '';
function syncSheetBackground(): void {
  if (!activeSheets.size) {
    document.body.style.overflow = originalOverflow;
    originalInert.forEach((inert, node) => {
      node.inert = inert;
    });
    originalInert.clear();
    return;
  }
  const top = sheetBackdrops.get([...activeSheets].at(-1)!);
  document.body.style.overflow = 'hidden';
  for (const node of Array.from(document.body.children) as HTMLElement[]) {
    if (!originalInert.has(node)) originalInert.set(node, node.inert);
    node.inert = node !== top;
  }
}
const SHEET_HISTORY_KEY = 'datepackSheet';
let returnFocus: HTMLElement | null = null;
export function sheetReturnFocus(): HTMLElement | null {
  return activeSheets.size ? returnFocus : null;
}
const transitions: Array<() => void> = [];
let sheetBackPending = false;
/** Leave the sheet's history entry before adding a task entry. */
export function afterSheetsClose(action: () => void): void {
  transitions.push(action);
  requestAnimationFrame(finishSheets);
}
function finishSheets(): void {
  if (activeSheets.size) return;
  if (sheetBackPending) return;
  if (history.state?.[SHEET_HISTORY_KEY]) {
    sheetBackPending = true;
    window.addEventListener(
      'popstate',
      () => {
        sheetBackPending = false;
        finishSheets();
      },
      { once: true },
    );
    history.back();
    return;
  }
  transitions.splice(0).forEach((action) => action());
}

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
    if (!activeSheets.size) originalOverflow = document.body.style.overflow;
    activeSheets.add(owner);
    sheetBackdrops.set(owner, backdropRef.current);
    if (activeSheets.size === 1) returnFocus = document.activeElement as HTMLElement | null;
    if (!history.state?.[SHEET_HISTORY_KEY]) {
      history.pushState({ ...history.state, [SHEET_HISTORY_KEY]: true }, '');
    }
    syncSheetBackground();
    sheet?.focus();
    const top = () => [...activeSheets].at(-1) === owner;
    const onBack = () => {
      if (top()) closeRef.current();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!top()) return;
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !sheet) return;
      const focusables = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.getClientRects().length > 0,
      );
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
      sheetBackdrops.delete(owner);
      syncSheetBackground();
      // A same-render transition between sheets reuses one history entry.
      requestAnimationFrame(() => {
        if (activeSheets.size) return;
        if (transitions.length) {
          finishSheets();
          return;
        }
        if (history.state?.[SHEET_HISTORY_KEY] && !sheetBackPending) {
          sheetBackPending = true;
          window.addEventListener(
            'popstate',
            () => {
              sheetBackPending = false;
              finishSheets();
            },
            { once: true },
          );
          history.back();
        }
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
