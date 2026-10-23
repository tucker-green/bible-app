/**
 * A small modal for the My study page's decisions (import: merge / replace; delete everything):
 * a labelled dialog (role="alertdialog" for destructive ones) with focus moved in, Tab trapped,
 * Esc / the scrim / Android back to cancel, and focus returned to the opener. Centred on larger
 * screens, anchored to the bottom (thumb reach) on phones.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { trapTab } from '../common/hooks';
import { useBackClose } from '../shell/sheet';

export interface StudyDialogProps {
  open: boolean;
  title: string;
  /** id prefix for aria-labelledby / describedby */
  id: string;
  /** Destructive confirmation (role="alertdialog"). */
  alert?: boolean;
  onClose: () => void;
  children: ComponentChildren;
  /** The buttons. Put the safe choice first in DOM order when `alert` (it gets the focus). */
  actions: ComponentChildren;
}

export function StudyDialog({ open, title, id, alert, onClose, children, actions }: StudyDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useBackClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    requestAnimationFrame(() => {
      const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('.ms-dlg__acts button');
      (first ?? el)?.focus();
    });
    document.documentElement.classList.add('ms-dlg-open');
    return () => {
      document.documentElement.classList.remove('ms-dlg-open');
      const back = opener.current;
      if (back && back.isConnected) requestAnimationFrame(() => back.focus());
    };
  }, [open]);

  if (!open) return null;
  return (
    <div class="ms-dlg-wrap">
      <div class="ms-dlg-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        class="ms-dlg"
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          if (ref.current) trapTab(e, ref.current);
        }}
      >
        <h2 class="ms-dlg__title" id={`${id}-title`}>
          {title}
        </h2>
        <div class="ms-dlg__body" id={`${id}-desc`}>
          {children}
        </div>
        <div class="ms-dlg__acts">{actions}</div>
      </div>
    </div>
  );
}
