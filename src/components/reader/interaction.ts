/**
 * Word interaction for the reader: ONE set of delegated listeners on the prose root handles hover
 * (with intent delay), click / tap (pin), keyboard (roving tabindex, ←/→, ↑/↓, Home/End, Enter,
 * Esc), focus, verse numbers (→ verse sheet), nearest-word hit-testing for touch, and
 * press-and-slide scrubbing (docs/EXPERIENCE.md §2). Word states are toggled imperatively on the
 * affected spans — the chapter is never re-rendered for a hover.
 *
 * Roving focus covers words ([data-u]) and verse numbers ([data-vn]) in reading order: Tab enters
 * the text at one stop, ←/→ move stop to stop, ↑/↓ move to the previous / next verse number,
 * Enter/Space opens the word card or the verse sheet, Esc closes and returns focus.
 */
import { batch } from '@preact/signals';
import { activeWord, closeWord, openVerseSheet, pinnedWord, settings, verseSheet } from '../../app/state';
import type { WordRef } from '../../app/state';
import { feedback } from '../../lib/feedback';
import { HIT_SLOP_PX, SCRUB_HOLD_MS, SCRUB_SLOP_PX, SCRUB_TICK_MS, distanceToRects, markScrubLearned, maybeShowCoach, scrub } from '../word/scrub';
import type { ChapterModel } from './model';
import { linkedUnits, relatedUnits } from './model';

const HOVER_OPEN_MS = 100;
const HOVER_SWITCH_MS = 40;
const HOVER_CLOSE_MS = 240;
const STATE_CLASSES = ['is-active', 'is-linked', 'is-kin', 'is-open'];
const STOP_SELECTOR = '[data-u], [data-vn]';

function unitEl(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>('[data-u]');
  return el && root.contains(el) ? el : null;
}

function vnEl(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>('[data-vn]');
  return el && root.contains(el) ? el : null;
}

function stopEl(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(STOP_SELECTOR);
  return el && root.contains(el) ? el : null;
}

interface Press {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
  unit: number;
}

export class ReaderController {
  root: HTMLElement | null = null;
  model: ChapterModel | null = null;
  /** The card element (set by WordCard) so pointer travel into it keeps a hover card open. */
  cardEl: HTMLElement | null = null;
  private els: HTMLElement[] = [];
  /** Words and verse numbers in reading order (the roving-focus stops). */
  private stops: HTMLElement[] = [];
  private stopIndex = new Map<HTMLElement, number>();
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private marked: HTMLElement[] = [];
  private roving: HTMLElement | null = null;
  private pointerType = 'mouse';
  /* scrubbing */
  private press: Press | null = null;
  private scrubbing = false;
  private suppressClickUntil = 0;
  private lastTick = 0;
  private scrollRaf = 0;
  private longPressAt = 0;
  /** The next focus on a word should not open its focus card (focus returning after a close). */
  private quietFocus = false;

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
    root.addEventListener('contextmenu', this.onContextMenu);
    root.addEventListener('selectstart', this.onSelectStart);
    root.addEventListener('touchmove', this.onTouchMove, { passive: false });
    document.addEventListener('pointermove', this.onDocPointerMove, { passive: true });
    document.addEventListener('pointerup', this.onDocPointerUp, true);
    document.addEventListener('pointercancel', this.onDocPointerCancel, true);
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
    root.removeEventListener('contextmenu', this.onContextMenu);
    root.removeEventListener('selectstart', this.onSelectStart);
    root.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('pointermove', this.onDocPointerMove);
    document.removeEventListener('pointerup', this.onDocPointerUp, true);
    document.removeEventListener('pointercancel', this.onDocPointerCancel, true);
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    window.removeEventListener('scroll', this.onScroll);
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.cancelPress();
    this.endScrub(false);
    this.root = null;
  }

  /** Index the unit spans after (re-)rendering the chapter HTML. */
  index(model: ChapterModel | null): void {
    this.cancelPress();
    this.endScrub(false);
    this.model = model;
    this.els = [];
    this.marked = [];
    this.stops = [];
    this.stopIndex.clear();
    this.roving = null;
    if (!this.root) return;
    const list = this.root.querySelectorAll<HTMLElement>(STOP_SELECTOR);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      this.stops.push(el);
      this.stopIndex.set(el, i);
      if (el.dataset.u !== undefined) this.els[Number(el.dataset.u)] = el;
      if (!this.roving && el.getAttribute('tabindex') === '0') this.roving = el;
    }
    if (!this.roving && this.stops[0]) {
      this.roving = this.stops[0];
      this.roving.setAttribute('tabindex', '0');
    }
  }

  el(unit: number): HTMLElement | null {
    return this.els[unit] ?? null;
  }

  /** The verse-number element of a verse, if rendered. */
  vn(verse: number): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(`[data-vn="${verse}"]`) ?? null;
  }

  /** True while a long-press is pending or a scrub is in progress. */
  busy(): boolean {
    return Boolean(this.press) || this.scrubbing;
  }

  /** True while scrubbing (swipe navigation stays out of the way). */
  isScrubbing(): boolean {
    return this.scrubbing;
  }

  get key(): string {
    return this.model?.key ?? '';
  }

  /** Narrow screens show the card as a bottom sheet, which only opens on a deliberate tap / Enter. */
  private narrow(): boolean {
    return typeof window !== 'undefined' && document.documentElement.clientWidth < 720;
  }

  private hoverEnabled(): boolean {
    if (!settings.value.hoverCards || this.narrow()) return false;
    return typeof matchMedia !== 'function' || matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  /* ------------------------------------------------------- hit testing */

  /**
   * The word unit at a point, or the nearest one within `slop` px (touch targets are small).
   * Points over the open sheet / header are ignored.
   */
  unitNear(x: number, y: number, slop = HIT_SLOP_PX): HTMLElement | null {
    const root = this.root;
    if (!root || typeof document.elementFromPoint !== 'function') return null;
    const direct = unitEl(document.elementFromPoint(x, y), root);
    if (direct) return direct;
    const seen = new Set<HTMLElement>();
    const probes: [number, number][] = [
      [-slop, 0],
      [slop, 0],
      [0, -slop],
      [0, slop],
      [-slop * 0.7, -slop * 0.7],
      [slop * 0.7, -slop * 0.7],
      [-slop * 0.7, slop * 0.7],
      [slop * 0.7, slop * 0.7],
    ];
    for (const [dx, dy] of probes) {
      const el = unitEl(document.elementFromPoint(x + dx, y + dy), root);
      if (el) seen.add(el);
    }
    let best: HTMLElement | null = null;
    let dist = Infinity;
    for (const el of seen) {
      const d = distanceToRects(x, y, el.getClientRects());
      if (d < dist) {
        dist = d;
        best = el;
      }
    }
    return dist <= slop + 0.5 ? best : null;
  }

  /** Units under a point regardless of what covers it (the sheet / loupe), for scrubbing. */
  private unitUnder(x: number, y: number): HTMLElement | null {
    const root = this.root;
    if (!root) return null;
    if (typeof document.elementsFromPoint === 'function') {
      for (const el of document.elementsFromPoint(x, y)) {
        const u = unitEl(el, root);
        if (u) return u;
        if (el === root) break;
      }
    }
    return this.unitNear(x, y);
  }

  /* -------------------------------------------------------------- pointer */

  private onPointerDown = (e: PointerEvent) => {
    this.pointerType = e.pointerType || 'mouse';
    if (e.pointerType !== 'touch' || !e.isPrimary || !this.root) return;
    if (vnEl(e.target, this.root)) return;
    const el = unitEl(e.target, this.root) ?? this.unitNear(e.clientX, e.clientY);
    if (!el) return;
    this.cancelPress();
    const unit = Number(el.dataset.u);
    this.press = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      unit,
      timer: setTimeout(() => this.engage(), SCRUB_HOLD_MS),
    };
  };

  private cancelPress(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }

  /** Long-press fired: enter scrub mode on the pressed word. */
  private engage(): void {
    const p = this.press;
    if (!p || !this.root) return;
    this.scrubbing = true;
    this.longPressAt = Date.now();
    this.suppressClickUntil = Number.POSITIVE_INFINITY;
    document.documentElement.classList.add('is-scrubbing');
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
    feedback('engage');
    this.lastTick = performance.now();
    this.selectUnit(p.unit, 'touch');
    scrub.value = { key: this.key, unit: p.unit, x: p.x, y: p.y };
    this.autoScroll();
  }

  private onDocPointerMove = (e: PointerEvent) => {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!this.scrubbing) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > SCRUB_SLOP_PX) this.cancelPress();
      return;
    }
    this.scrubTo(p.x, p.y);
  };

  /** Move the scrub selection to the word under (x, y). */
  private scrubTo(x: number, y: number): void {
    const top = Math.max(0, document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0) + 4;
    const sheetTop = this.cardEl?.isConnected ? this.cardEl.getBoundingClientRect().top - 4 : window.innerHeight;
    const hy = Math.min(Math.max(y, top), sheetTop);
    const el = this.unitUnder(x, hy);
    const cur = scrub.value;
    if (el) {
      const unit = Number(el.dataset.u);
      if (!cur || cur.unit !== unit) {
        this.selectUnit(unit, 'touch');
        const now = performance.now();
        if (now - this.lastTick >= SCRUB_TICK_MS) {
          this.lastTick = now;
          feedback('tick');
        }
      }
      scrub.value = { key: this.key, unit, x, y };
    } else if (cur) {
      scrub.value = { ...cur, x, y };
    }
  }

  /** While scrubbing near the header or the sheet, scroll the text slowly. */
  private autoScroll(): void {
    cancelAnimationFrame(this.scrollRaf);
    const step = () => {
      const p = this.press;
      if (!this.scrubbing || !p) return;
      const top = Math.max(0, document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0);
      const bottom = this.cardEl?.isConnected ? this.cardEl.getBoundingClientRect().top : window.innerHeight;
      const zone = 44;
      let v = 0;
      // only once the finger is deliberately sliding (not where it first pressed)
      const travelled = Math.hypot(p.x - p.x0, p.y - p.y0) > 24;
      if (travelled && p.y < top + zone) v = -Math.min(10, ((top + zone - p.y) / zone) * 10);
      else if (travelled && p.y > bottom - zone) v = Math.min(10, ((p.y - (bottom - zone)) / zone) * 10);
      if (v) {
        window.scrollBy(0, v);
        this.scrubTo(p.x, p.y);
      }
      this.scrollRaf = requestAnimationFrame(step);
    };
    this.scrollRaf = requestAnimationFrame(step);
  }

  private endScrub(keep: boolean): void {
    cancelAnimationFrame(this.scrollRaf);
    if (!this.scrubbing) return;
    this.scrubbing = false;
    document.documentElement.classList.remove('is-scrubbing');
    scrub.value = null;
    if (keep) {
      markScrubLearned();
      // swallow the click that follows the lift
      this.suppressClickUntil = Date.now() + 450;
    } else {
      this.suppressClickUntil = 0;
    }
  }

  private onDocPointerUp = (e: PointerEvent) => {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    const was = this.scrubbing;
    this.cancelPress();
    this.endScrub(was);
  };

  private onDocPointerCancel = (e: PointerEvent) => {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    // While scrubbing, scrolling is suppressed, so a cancel means the OS took the gesture.
    const was = this.scrubbing;
    this.cancelPress();
    this.endScrub(was);
  };

  /** Scrolling is suppressed only while scrubbing. */
  private onTouchMove = (e: TouchEvent) => {
    if (this.scrubbing && e.cancelable) e.preventDefault();
  };

  /** Long-press on a word is ours (scrubbing), not the browser's menu / selection. */
  private onContextMenu = (e: Event) => {
    if (!this.root) return;
    if ((this.pointerType === 'touch' || this.scrubbing) && unitEl(e.target, this.root)) e.preventDefault();
  };

  private onSelectStart = (e: Event) => {
    if (!this.root) return;
    if ((this.press || this.scrubbing) && this.pointerType === 'touch' && unitEl(e.target, this.root)) e.preventDefault();
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

  /** Pin a unit's card (tap / click / keyboard / scrub). */
  private selectUnit(unit: number, via: WordRef['via']): void {
    this.setRoving(this.els[unit] ?? null);
    batch(() => {
      if (verseSheet.value) verseSheet.value = null;
      pinnedWord.value = { key: this.key, unit, via };
      activeWord.value = null;
    });
  }

  private onClick = (e: MouseEvent) => {
    if (!this.root) return;
    if (Date.now() < this.suppressClickUntil) {
      e.preventDefault();
      this.suppressClickUntil = 0;
      return;
    }
    const touch = this.pointerType === 'touch';
    const v = vnEl(e.target, this.root);
    if (v) {
      e.preventDefault();
      this.openVerse(Number(v.dataset.vn), e.detail === 0);
      return;
    }
    const el = unitEl(e.target, this.root) ?? (touch && e.detail !== 0 ? this.unitNear(e.clientX, e.clientY) : null);
    if (!el) return;
    const unit = Number(el.dataset.u);
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    const p = pinnedWord.value;
    if (p && p.key === this.key && p.unit === unit) {
      closeWord();
      return;
    }
    const via: WordRef['via'] = e.detail === 0 ? 'keyboard' : touch ? 'touch' : 'click';
    const swapping = Boolean(p);
    this.selectUnit(unit, via);
    feedback(touch ? 'select' : swapping ? 'select' : 'pin');
    if (touch) maybeShowCoach();
  };

  /** Open the verse sheet for a verse (from a verse number). */
  openVerse(verse: number, keyboard = false): void {
    const el = this.vn(verse);
    if (el) this.setRoving(el);
    openVerseSheet(this.key, verse);
    feedback(keyboard ? 'pin' : 'select');
  }

  private onDocPointerDown = (e: PointerEvent) => {
    if (!pinnedWord.value || !this.root) return;
    const t = e.target as Node | null;
    if (t && this.cardEl?.contains(t)) return;
    if (unitEl(t, this.root)) return; // the click handler decides
    if (t instanceof Element && t.closest('[data-keep-word]')) return;
    // a touch just beside a word selects it (nearest-word hit-testing) rather than closing
    if (e.pointerType === 'touch' && this.root.contains(t) && this.unitNear(e.clientX, e.clientY)) return;
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
    const stop = stopEl(e.target, this.root);
    if (stop) this.setRoving(stop);
    const el = unitEl(e.target, this.root);
    if (!el) return;
    const unit = Number(el.dataset.u);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-haspopup', 'dialog');
    if (this.quietFocus) {
      this.quietFocus = false;
      return;
    }
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
    if (!this.narrow()) activeWord.value = { key: this.key, unit, via: 'focus' };
  };

  private onFocusOut = (e: FocusEvent) => {
    if (!this.root) return;
    const el = unitEl(e.target, this.root);
    if (el && !el.classList.contains('is-open')) {
      el.removeAttribute('role');
      el.removeAttribute('aria-haspopup');
    }
    const to = e.relatedTarget as Node | null;
    if (to && (this.root.contains(to) || this.cardEl?.contains(to))) return;
    if (activeWord.value?.via === 'focus') activeWord.value = null;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.root || e.altKey || e.ctrlKey || e.metaKey) return;
    const stop = stopEl(e.target, this.root);
    if (!stop) return;
    const isVerse = stop.dataset.vn !== undefined;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        this.focusStop(this.stepStop(stop, e.key === 'ArrowRight' ? 1 : -1));
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const target = this.verseStop(stop, e.key === 'ArrowDown' ? 1 : -1);
        if (!target) return; // let the page scroll
        e.preventDefault();
        e.stopPropagation();
        this.focusStop(target);
        break;
      }
      case 'Home':
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        this.focusStop(e.key === 'Home' ? this.stops[0] : this.stops[this.stops.length - 1]);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        e.stopPropagation();
        if (isVerse) {
          this.openVerse(Number(stop.dataset.vn), true);
          break;
        }
        const unit = Number(stop.dataset.u);
        const p = pinnedWord.value;
        if (p && p.key === this.key && p.unit === unit) closeWord();
        else {
          batch(() => {
            verseSheet.value = null;
            pinnedWord.value = { key: this.key, unit, via: 'keyboard' };
            activeWord.value = null;
          });
          feedback('pin');
        }
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

  private stepStop(from: HTMLElement, delta: 1 | -1): HTMLElement {
    const i = this.stopIndex.get(from) ?? 0;
    return this.stops[Math.min(this.stops.length - 1, Math.max(0, i + delta))] ?? from;
  }

  /** Verse number (or first word) of the next (+1) / previous (-1) verse, or null at the ends. */
  private verseStop(from: HTMLElement, dir: 1 | -1): HTMLElement | null {
    const i = this.stopIndex.get(from);
    if (i === undefined) return null;
    const verseOf = (el: HTMLElement): number => {
      if (el.dataset.vn !== undefined) return Number(el.dataset.vn);
      const u = this.model?.units[Number(el.dataset.u)];
      return u ? u.verse : -1;
    };
    const v = verseOf(from);
    // first stop of each verse = its verse number (rendered before its words)
    if (dir === 1) {
      for (let j = i + 1; j < this.stops.length; j++) if (verseOf(this.stops[j]) !== v) return this.stops[j];
      return null;
    }
    let j = i - 1;
    // on a word: ↑ first goes to this verse's own number
    if (from.dataset.vn === undefined) {
      while (j >= 0 && verseOf(this.stops[j]) === v) {
        if (this.stops[j].dataset.vn !== undefined) return this.stops[j];
        j--;
      }
    }
    if (j < 0) return null;
    const pv = verseOf(this.stops[j]);
    while (j > 0 && verseOf(this.stops[j - 1]) === pv) j--;
    return this.stops[j] ?? null;
  }

  private setRoving(el: HTMLElement | null): void {
    if (!el || this.roving === el) return;
    this.roving?.setAttribute('tabindex', '-1');
    el.setAttribute('tabindex', '0');
    this.roving = el;
  }

  /** Move keyboard focus to a stop (keeps it in view under the sticky header / above the dock). */
  private focusStop(el: HTMLElement | null | undefined): void {
    if (!el) return;
    this.setRoving(el);
    el.focus({ preventScroll: true });
    const r = el.getBoundingClientRect();
    const header = Math.max(0, document.querySelector('.masthead')?.getBoundingClientRect().bottom ?? 0);
    const bottom = window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 0);
    if (r.top < header + 8 || r.bottom > bottom - 8) {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }

  /** Move keyboard focus to a unit. `quiet`: do not open its focus card (focus returning after a close). */
  focusUnit(unit: number, quiet = false): void {
    const el = this.els[unit];
    if (!el) return;
    this.quietFocus = quiet && document.activeElement !== el;
    this.focusStop(el);
    this.quietFocus = false;
  }

  /** Move keyboard focus to a verse number. */
  focusVerse(verse: number): void {
    this.focusStop(this.vn(verse));
  }

  /* ------------------------------------------------------------ highlight */

  /** Apply the word states for the open word (or clear them). */
  highlight(ref: WordRef | null, pinned: boolean): void {
    for (const el of this.marked) {
      el.classList.remove(...STATE_CLASSES);
      el.removeAttribute('aria-describedby');
      el.removeAttribute('aria-expanded');
      el.removeAttribute('aria-controls');
      if (document.activeElement !== el) {
        el.removeAttribute('role');
        el.removeAttribute('aria-haspopup');
      }
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
      anchor.setAttribute('role', 'button');
      anchor.setAttribute('aria-haspopup', 'dialog');
      anchor.setAttribute('aria-expanded', 'true');
      anchor.setAttribute('aria-controls', 'word-card');
    } else {
      anchor.setAttribute('aria-describedby', 'word-card');
    }
  }

  /** Was a long-press scrub engaged within the last `ms`? (for tests / diagnostics) */
  scrubbedRecently(ms = 1000): boolean {
    return Date.now() - this.longPressAt < ms;
  }
}
