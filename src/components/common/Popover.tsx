/**
 * Anchored popover (desktop) that becomes a bottom sheet on phones, rendered in a portal on <body>. Closes on Esc (focus returns to
 * the trigger) and on a pointer press outside. role="dialog" with a label.
 */
import type { ComponentChildren, RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { trapTab, useMedia } from './hooks';
import './popover.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement>;
  label: string;
  class?: string;
  /** Horizontal alignment to the anchor on desktop. */
  align?: 'left' | 'right';
  /** CSS selector of the element to focus on open (default: the dialog itself). */
  initialFocus?: string;
  children: ComponentChildren;
}

export function Popover({ open, onClose, anchor, label, class: cls = '', align = 'left', initialFocus, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sheet = useMedia('(max-width: 640px)');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position under the anchor (desktop).
  useLayoutEffect(() => {
    if (!open || sheet) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const vw = document.documentElement.clientWidth;
      const w = el.offsetWidth;
      let left = align === 'right' ? a.right - w : a.left - 8;
      left = Math.min(Math.max(left, 12), Math.max(12, vw - w - 12));
      setPos({ left, top: a.bottom + 8 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, sheet, align, anchor]);

  // Focus management + outside press + Esc.
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    const trigger = anchor.current;
    const target = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el;
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el?.contains(t) || trigger?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        trigger?.focus();
      } else if (sheet && el) {
        trapTab(e, el);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, sheet]);

  if (!open) return null;
  const style = sheet ? undefined : pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { visibility: 'hidden' as const };
  // Portalled to <body>: the masthead's backdrop-filter would otherwise trap position:fixed.
  return createPortal(
    <>
      {sheet && <div class="pop-scrim" aria-hidden="true" />}
      <div
        ref={ref}
        class={`pop ${sheet ? 'pop--sheet' : ''} ${cls}`.trim()}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        style={style}
      >
        {sheet && <span class="pop__handle" aria-hidden="true" />}
        {children}
      </div>
    </>,
    document.body,
  );
}
