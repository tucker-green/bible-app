/**
 * Word interaction for the reader: ONE set of delegated listeners on the prose root handles hover
 * (with intent delay), click / tap (pin), keyboard (roving tabindex, ←/→, Home/End, Enter, Esc)
 * and focus. Word states are toggled imperatively on the affected spans — the chapter is never
 * re-rendered for a hover.
 */
import { batch } from '@preact/signals';
import { activeWord, closeWord, pinnedWord, settings } from '../../app/state';
import type { WordRef } from '../../app/state';
import type { ChapterModel } from './model';
import { linkedUnits, relatedUnits } from './model';

const HOVER_OPEN_MS = 100;
const HOVER_SWITCH_MS = 40;
const HOVER_CLOSE_MS = 240;
const STATE_CLASSES = ['is-active', 'is-linked', 'is-kin', 'is-open'];

function unitEl(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>('[data-u]');
  return el && root.contains(el) ? el : null;
}

export class ReaderController {
  root: HTMLElement | null = null;
  model: ChapterModel | null = null;
  /** The card element (set by WordCard) so pointer travel into it keeps a hover card open. */
  cardEl: HTMLElement | null = null;
  private els: HTMLElement[] = [];
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private marked: HTMLElement[] = [];
  private roving = 0;
  private pointerType = 'mouse';

  attach(root: HTMLElement): void {
    if (this.root === root) return;
    this.detach();
    this.root = root;
    root.addEventListener('pointerover', this.onPointerOver);
    root.addEventListener('pointerout', this.onPointerOut);
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('click', this.onClick);
    root.addEventListener('focusin', this.onFocusIn);
    root.addEventListener('focusout', this.onFocusOut);
    root.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  detach(): void {
    const root = this.root;
    if (!root) return;
    root.removeEventListener('pointerover', this.onPointerOver);
    root.removeEventListener('pointerout', this.onPointerOut);
    root.removeEventListener('pointerdown', this.onPointerDown);
    root.removeEventListener('click', this.onClick);
    root.removeEventListener('focusin', this.onFocusIn);
    root.removeEventListener('focusout', this.onFocusOut);
    root.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    window.removeEventListener('scroll', this.onScroll);
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.root = null;
  }

  /** Index the unit spans after (re-)rendering the chapter HTML. */
  index(model: ChapterModel | null): void {
    this.model = model;
    this.els = [];
    this.marked = [];
    this.roving = 0;
    if (!this.root) return;
    const list = this.root.querySelectorAll<HTMLElement>('[data-u]');
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      this.els[Number(el.dataset.u)] = el;
    }
  }

  el(unit: number): HTMLElement | null {
    return this.els[unit] ?? null;
  }

  private get key(): string {
    return this.model?.key ?? '';
  }

  private hoverEnabled(): boolean {
    if (!settings.value.hoverCards) return false;
    return typeof matchMedia !== 'function' || matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  /* -------------------------------------------------------------- pointer */

  private onPointerDown = (e: PointerEvent) => {
    this.pointerType = e.pointerType || 'mouse';
  };

  private onPointerOver = (e: PointerEvent) => {
    if (!this.root || e.pointerType === 'touch') return;
    const el = unitEl(e.target, this.root);
    if (!el) return;
    clearTimeout(this.closeTimer);
    if (!this.hoverEnabled() || pinnedWord.value) return; // :hover still shows a preview wash
    const unit = Number(el.dataset.u);
    const cur = activeWord.value;
    if (cur && cur.key === this.key && cur.unit === unit) return;
    clearTimeout(this.openTimer);
    const key = this.key;
    this.openTimer = setTimeout(
      () => {
        if (!pinnedWord.value) activeWord.value = { key, unit, via: 'hover' };
      },
      cur ? HOVER_SWITCH_MS : HOVER_OPEN_MS,
    );
  };

  private onPointerOut = (e: PointerEvent) => {
    if (!this.root) return;
    const el = unitEl(e.target, this.root);
    if (!el) return;
    const to = e.relatedTarget as Node | null;
    if (to && el.contains(to)) return;
    clearTimeout(this.openTimer);
    if (activeWord.value?.via === 'hover' && !pinnedWord.value) this.scheduleClose();
  };

  private scheduleClose(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      if (activeWord.value?.via === 'hover') activeWord.value = null;
    }, HOVER_CLOSE_MS);
  }

  /** The pointer entered the card: keep a hover card open. */
  cardEnter(): void {
    clearTimeout(this.closeTimer);
    clearTimeout(this.openTimer);
  }

  /** The pointer left the card. */
  cardLeave(): void {
    if (activeWord.value?.via === 'hover' && !pinnedWord.value) this.scheduleClose();
  }

  private onClick = (e: MouseEvent) => {
    if (!this.root) return;
    const el = unitEl(e.target, this.root);
    if (!el) return;
    const unit = Number(el.dataset.u);
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    const p = pinnedWord.value;
    if (p && p.key === this.key && p.unit === unit) {
      closeWord();
      return;
    }
    const touch = this.pointerType === 'touch';
    const via: WordRef['via'] = e.detail === 0 ? 'keyboard' : touch ? 'touch' : 'click';
    this.setRoving(unit);
    batch(() => {
      pinnedWord.value = { key: this.key, unit, via };
      activeWord.value = null;
    });
  };

  private onDocPointerDown = (e: PointerEvent) => {
    if (!pinnedWord.value || !this.root) return;
    const t = e.target as Node | null;
    if (t && this.cardEl?.contains(t)) return;
    if (unitEl(t, this.root)) return; // the click handler decides
    if (t instanceof Element && t.closest('[data-keep-word]')) return;
    closeWord();
  };

  private onScroll = () => {
    if (activeWord.value?.via === 'hover' && !pinnedWord.value) {
      clearTimeout(this.openTimer);
      activeWord.value = null;
    }
  };

  /* ------------------------------------------------------------- keyboard */

  private onFocusIn = (e: FocusEvent) => {
    if (!this.root) return;
    const el = unitEl(e.target, this.root);
    if (!el) return;
    const unit = Number(el.dataset.u);
    this.setRoving(unit);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-haspopup', 'dialog');
    let keyboard = false;
    try {
      keyboard = el.matches(':focus-visible');
    } catch {
      keyboard = false;
    }
    if (!keyboard) return;
    const p = pinnedWord.value;
    if (p) {
      if (p.unit !== unit || p.key !== this.key) pinnedWord.value = { key: this.key, unit, via: 'keyboard' };
      return;
    }
    clearTimeout(this.openTimer);
    activeWord.value = { key: this.key, unit, via: 'focus' };
  };

  private onFocusOut = (e: FocusEvent) => {
    if (!this.root) return;
    const el = unitEl(e.target, this.root);
    if (el) {
      el.removeAttribute('role');
      el.removeAttribute('aria-haspopup');
    }
    const to = e.relatedTarget as Node | null;
    if (to && (this.root.contains(to) || this.cardEl?.contains(to))) return;
    if (activeWord.value?.via === 'focus') activeWord.value = null;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.root || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = unitEl(e.target, this.root);
    if (!el) return;
    const unit = Number(el.dataset.u);
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        this.focusUnit(this.step(unit, e.key === 'ArrowRight' ? 1 : -1));
        break;
      case 'Home':
      case 'End': {
        e.preventDefault();
        e.stopPropagation();
        const ids = this.ids();
        this.focusUnit(e.key === 'Home' ? ids[0] : ids[ids.length - 1]);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        e.stopPropagation();
        const p = pinnedWord.value;
        if (p && p.key === this.key && p.unit === unit) closeWord();
        else
          batch(() => {
            pinnedWord.value = { key: this.key, unit, via: 'keyboard' };
            activeWord.value = null;
          });
        break;
      }
      case 'Escape':
        if (pinnedWord.value || activeWord.value) {
          e.preventDefault();
          e.stopPropagation();
          closeWord();
        }
        break;
    }
  };

  private ids(): number[] {
    const out: number[] = [];
    this.els.forEach((el, i) => {
      if (el) out.push(i);
    });
    return out;
  }

  private step(unit: number, delta: 1 | -1): number {
    let i = unit + delta;
    while (i >= 0 && i < this.els.length) {
      if (this.els[i]) return i;
      i += delta;
    }
    return unit;
  }

  private setRoving(unit: number): void {
    if (this.roving === unit) return;
    this.els[this.roving]?.setAttribute('tabindex', '-1');
    this.els[unit]?.setAttribute('tabindex', '0');
    this.roving = unit;
  }

  /** Move keyboard focus to a unit (keeps it in view under the sticky header). */
  focusUnit(unit: number): void {
    const el = this.els[unit];
    if (!el) return;
    this.setRoving(unit);
    el.focus({ preventScroll: true });
    const r = el.getBoundingClientRect();
    const header = document.querySelector('.masthead')?.getBoundingClientRect().bottom ?? 0;
    if (r.top < header + 8 || r.bottom > window.innerHeight - 8) {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }

  /* ------------------------------------------------------------ highlight */

  /** Apply the word states for the open word (or clear them). */
  highlight(ref: WordRef | null, pinned: boolean): void {
    for (const el of this.marked) {
      el.classList.remove(...STATE_CLASSES);
      el.removeAttribute('aria-describedby');
      el.removeAttribute('aria-expanded');
      el.removeAttribute('aria-controls');
    }
    this.marked = [];
    const model = this.model;
    if (!ref || !model || ref.key !== model.key) return;
    const anchor = this.els[ref.unit];
    if (!anchor) return;
    for (const id of linkedUnits(model, ref.unit)) {
      const el = this.els[id];
      if (!el) continue;
      el.classList.add(id === ref.unit ? 'is-active' : 'is-linked');
      this.marked.push(el);
    }
    if (settings.value.markRelated) {
      for (const id of relatedUnits(model, ref.unit)) {
        const el = this.els[id];
        if (!el) continue;
        el.classList.add('is-kin');
        this.marked.push(el);
      }
    }
    if (pinned) {
      anchor.classList.add('is-open');
      anchor.setAttribute('aria-expanded', 'true');
      anchor.setAttribute('aria-controls', 'word-card');
    } else {
      anchor.setAttribute('aria-describedby', 'word-card');
    }
  }
}
