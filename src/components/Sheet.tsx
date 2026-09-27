import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

type SheetProps = { open: boolean; title: string; onClose: () => void; children: ReactNode };

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Bottom sheet constrained to the 430px canvas.
 *  Manages focus: moves focus in on open, traps Tab, restores focus on close. */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheet?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !sheet) return;
      const focusables = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
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
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
