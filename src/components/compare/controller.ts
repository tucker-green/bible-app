/**
 * The compare page's word controller: the reader's ReaderController (hover intent, tap / click
 * pinning, roving focus, press-and-slide scrubbing, nearest-word hit-testing — all unchanged) over
 * the merged unit space of model.ts, plus three column-aware adaptations:
 *
 *  - Verse numbers repeat in every column, so the column of the number that was pressed is noted
 *    (capture-phase listener) and its verse sheet opens with that column's key ("BSB/JHN/1");
 *    focus returns to that same number when the sheet closes (vn() prefers the noted column).
 *  - ↑ / ↓ move verse to verse within the same column (the reader's own ↑ / ↓ would follow DOM
 *    order, which interleaves the translations); ← / → still walk word by word in reading order.
 *  - Keyboard focus is kept clear of the sticky translation bar and the bottom dock.
 */
import { batch } from '@preact/signals';
import { verseSheet } from '../../app/state';
import { ReaderController } from '../reader/interaction';

const STOP = '[data-u], [data-vn]';

/** Bottom edge of whatever is pinned at the top (the sticky translation bar, else the masthead). */
function topInset(): number {
  const bar = document.querySelector('.cmp-bar');
  const head = document.getElementById('masthead');
  return Math.max(0, bar?.getBoundingClientRect().bottom ?? 0, head?.getBoundingClientRect().bottom ?? 0);
}

/** Scroll just enough that `el` is visible between the sticky bar and the bottom dock. */
export function keepInView(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const top = topInset() + 8;
  const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 0;
  const bottom = window.innerHeight - dock - 8;
  if (r.top < top) window.scrollBy(0, r.top - top - 16);
  else if (r.bottom > bottom) window.scrollBy(0, r.bottom - bottom + 16);
}

/** A reading position: verse row `verse` was `offset` px from the top of the viewport. */
export interface Anchor {
  verse: number;
  offset: number;
}

/** The first verse row not hidden under the sticky bar, when the page is scrolled into the grid. */
export function captureAnchor(root: HTMLElement): Anchor | null {
  const top = topInset();
  const rows = root.querySelectorAll<HTMLElement>('[data-row]');
  if (!rows.length || rows[0].getBoundingClientRect().top >= top) return null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (r.bottom > top + 4) return { verse: Number(rows[i].dataset.row), offset: r.top };
  }
  return null;
}

/**
 * Run `fix` now and over the next two frames: rows of long chapters skip layout until they come
 * near the viewport (content-visibility), so their real heights only settle after a scroll.
 */
function settle(fix: () => void): void {
  fix();
  requestAnimationFrame(() => {
    fix();
    requestAnimationFrame(fix);
  });
}

/** Put verse row `a.verse` back at the same distance from the top. */
export function restoreAnchor(root: HTMLElement, a: Anchor): void {
  settle(() => {
    const row = root.querySelector<HTMLElement>(`[data-row="${a.verse}"]`);
    if (!row) return;
    const dy = row.getBoundingClientRect().top - a.offset;
    if (Math.abs(dy) > 1) window.scrollBy(0, dy);
  });
}

/** Scroll a verse row just below the sticky bar; `flash` briefly highlights it (route targeting). */
export function scrollToRow(root: HTMLElement, verse: number, flash = false): void {
  const row = root.querySelector<HTMLElement>(`[data-row="${verse}"]`);
  if (!row) return;
  settle(() => {
    const dy = row.getBoundingClientRect().top - topInset() - 24;
    if (Math.abs(dy) > 1) window.scrollBy(0, dy);
  });
  if (!flash) return;
  const els = [...row.querySelectorAll<HTMLElement>('.verse')];
  els.forEach((el) => {
    el.classList.remove('is-target');
    void el.offsetWidth;
    el.classList.add('is-target');
  });
  setTimeout(() => els.forEach((el) => el.classList.remove('is-target')), 3200);
}

export class CompareController extends ReaderController {
  /** Verse-sheet key of each column ("KJV/JHN/1"), in column order. */
  colKeys: string[] = [];
  /** Column whose verse number opened the verse sheet (focus returns there). */
  vnCol: number | null = null;
  private pendingCol: number | null = null;

  attach(root: HTMLElement): void {
    const fresh = this.root !== root;
    super.attach(root);
    if (!fresh) return;
    root.addEventListener('pointerdown', this.onCapture, true);
    root.addEventListener('click', this.onCapture, true);
    root.addEventListener('keydown', this.onKeyCapture, true);
    root.addEventListener('focusin', this.onFocusAfter);
  }

  detach(): void {
    const root = this.root;
    if (root) {
      root.removeEventListener('pointerdown', this.onCapture, true);
      root.removeEventListener('click', this.onCapture, true);
      root.removeEventListener('keydown', this.onKeyCapture, true);
      root.removeEventListener('focusin', this.onFocusAfter);
    }
    super.detach();
  }

  /** Column index of the cell holding `target`, or null. */
  colOf(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const cell = target.closest<HTMLElement>('[data-col]');
    return cell && this.root?.contains(cell) ? Number(cell.dataset.col) : null;
  }

  private onCapture = (e: Event) => {
    this.pendingCol = this.colOf(e.target);
  };

  /** A verse number in the noted column first (several columns repeat the same number). */
  vn(verse: number): HTMLElement | null {
    if (this.vnCol !== null && this.root) {
      const el = this.root.querySelector<HTMLElement>(`[data-col="${this.vnCol}"] [data-vn="${verse}"]`);
      if (el) return el;
    }
    return super.vn(verse);
  }

  /** Open the verse sheet of the column whose number was pressed. */
  openVerse(verse: number, keyboard = false): void {
    const col = this.pendingCol ?? this.colOf(document.activeElement) ?? 0;
    this.vnCol = col;
    const key = this.colKeys[col];
    batch(() => {
      super.openVerse(verse, keyboard);
      if (key) verseSheet.value = { key, verse };
    });
  }

  /** ↑ / ↓: the previous / next verse in the same column (↑ on a word first goes to its own number). */
  stepVerse(from: HTMLElement, dir: 1 | -1): HTMLElement | null {
    const cell = from.closest<HTMLElement>('[data-col]');
    const row = from.closest<HTMLElement>('[data-row]');
    if (!cell || !row) return null;
    if (dir === -1 && from.dataset.vn === undefined) {
      const own = cell.querySelector<HTMLElement>('[data-vn]');
      if (own) return own;
    }
    const col = cell.dataset.col;
    let r: Element | null = row;
    for (;;) {
      r = dir === 1 ? r.nextElementSibling : r.previousElementSibling;
      if (!r) return null;
      if (!(r instanceof HTMLElement) || r.dataset.row === undefined) continue; // section headings
      const c = r.querySelector(`[data-col="${col}"]`);
      const s = c?.querySelector<HTMLElement>('[data-vn]') ?? c?.querySelector<HTMLElement>('[data-u]');
      if (s) return s;
    }
  }

  private onKeyCapture = (e: KeyboardEvent) => {
    this.pendingCol = this.colOf(e.target);
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const root = this.root;
    const stop = e.target instanceof Element ? e.target.closest<HTMLElement>(STOP) : null;
    if (!root || !stop || !root.contains(stop)) return;
    const target = this.stepVerse(stop, e.key === 'ArrowDown' ? 1 : -1);
    if (!target) return; // the reader's own handling (or the page scrolls)
    e.preventDefault();
    e.stopPropagation();
    target.focus({ preventScroll: true });
    keepInView(target);
  };

  /** Keyboard focus moved (← → ↑ ↓ Home End): keep it clear of the sticky bar and the dock. */
  private onFocusAfter = (e: FocusEvent) => {
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (!el || !el.matches(STOP)) return;
    let keyboard = false;
    try {
      keyboard = el.matches(':focus-visible');
    } catch {
      keyboard = false;
    }
    if (keyboard) keepInView(el);
  };
}
