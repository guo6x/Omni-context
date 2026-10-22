'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent, type MutableRefObject, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface ModalDialogProps {
  active: boolean;
  titleId: string;
  onDismiss: () => void;
  returnFocusRef?: MutableRefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

function getFocusableElements(dialog: HTMLDivElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) =>
    element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== 'hidden'
  );
}

/** Focus-contained dialog with Escape dismissal and focus restoration. */
export default function ModalDialog({ active, titleId, onDismiss, returnFocusRef, className, children }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasActiveRef = useRef(false);
  const restoreFocus = useCallback(() => {
    if (!wasActiveRef.current) return;
    wasActiveRef.current = false;
    const previousFocus = previousFocusRef.current;
    previousFocusRef.current = null;
    if (previousFocus?.isConnected) previousFocus.focus();
    if (returnFocusRef?.current === previousFocus) returnFocusRef.current = null;
  }, [returnFocusRef]);

  useEffect(() => {
    if (active) {
      // Keep the original trigger if React Strict Mode replays this effect.
      if (!wasActiveRef.current) {
        const requestedTarget = returnFocusRef?.current;
        const activeElement = document.activeElement;
        previousFocusRef.current = requestedTarget?.isConnected
          ? requestedTarget
          : activeElement instanceof HTMLElement && activeElement !== document.body
            ? activeElement
            : null;
        wasActiveRef.current = true;
      }
      const dialog = dialogRef.current;
      if (dialog) (getFocusableElements(dialog)[0] ?? dialog).focus();
      return;
    }
    restoreFocus();
  }, [active, restoreFocus, returnFocusRef]);

  // Some consumers unmount their dialog when it closes instead of keeping an
  // inactive instance in the tree (for example, a one-shot confirmation).
  useEffect(() => () => restoreFocus(), [restoreFocus]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    const target = event.target;
    // A nested modal owns its own Escape and Tab behavior. Let its event reach
    // that dialog instead of dismissing or moving focus in the parent.
    if (dialog && target instanceof Element && target.closest('[role="dialog"]') !== dialog) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key !== 'Tab') return;

    if (!dialog) return;
    const focusable = getFocusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (activeIndex < 0) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && activeIndex === 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={className}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
