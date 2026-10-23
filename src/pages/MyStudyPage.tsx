/**
 * #/study — my highlights, notes and bookmarks (kept only in this browser; src/app/study.ts).
 *
 * Contract (keep it): default export, no props (`MyStudyPageProps` is empty).
 *
 * Tabs (WAI-ARIA tabs: ←/→/Home/End, automatic activation; the last tab is remembered per browser):
 * Highlights (filter by colour) · Notes (search, edit in place) · Bookmarks. Every list is grouped by
 * book in Bible order; each item links back into the reader and shows the verse in the translation
 * on screen. "Your data" (export / import / delete everything) is the right rail on wide screens and
 * follows the lists on narrow ones.
 */
import { useRef, useState } from 'preact/hooks';
import { passage, translations } from '../app/state';
import { readString, writeString } from '../app/storage';
import { studyCounts } from '../app/study';
import { DataTools } from '../components/study/DataTools';
import { describeCounts } from '../components/study/model';
import { BookmarksPanel, HighlightsPanel, NotesPanel } from '../components/study/panels';
import { PageLayout } from '../components/layout/PageLayout';
import '../components/study/study.css';

export type MyStudyPageProps = Record<string, never>;

export type StudyTab = 'highlights' | 'notes' | 'bookmarks';
const TABS: { id: StudyTab; label: string }[] = [
  { id: 'highlights', label: 'Highlights' },
  { id: 'notes', label: 'Notes' },
  { id: 'bookmarks', label: 'Bookmarks' },
];
const TAB_KEY = 'studyTab';

function firstTab(): StudyTab {
  const saved = readString(TAB_KEY);
  if (saved === 'highlights' || saved === 'notes' || saved === 'bookmarks') return saved;
  const c = studyCounts.peek();
  return c.highlights ? 'highlights' : c.notes ? 'notes' : c.bookmarks ? 'bookmarks' : 'highlights';
}

export default function MyStudyPage(_props: MyStudyPageProps) {
  const [tab, setTabState] = useState<StudyTab>(firstTab);
  const tabRefs = useRef<Record<StudyTab, HTMLButtonElement | null>>({ highlights: null, notes: null, bookmarks: null });
  const counts = studyCounts.value;
  const { tr } = passage.value;
  const trMeta = translations.value.find((t) => t.id === tr);
  const abbr = trMeta?.abbr ?? tr;

  const setTab = (t: StudyTab, focus = false) => {
    setTabState(t);
    writeString(TAB_KEY, t);
    if (focus) tabRefs.current[t]?.focus();
  };
  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    setTab(TABS[j].id, true);
  };
  const toData = () => {
    const el = document.getElementById('ms-data');
    el?.scrollIntoView({ block: 'start' });
    el?.focus({ preventScroll: true });
  };

  const lede = (
    <div class="ms-lede">
      <p>
        {counts.total ? (
          <>
            You have <b>{describeCounts(counts)}</b>, in Bible order.
          </>
        ) : (
          'Highlights, notes and bookmarks you make while reading gather here, in Bible order.'
        )}{' '}
        Verse text from the {trMeta?.name ?? abbr}.
      </p>
      <p class="ms-lede__where">
        Kept only in this browser.{' '}
        <button type="button" class="link-btn ms-lede__jump" onClick={toData}>
          Back up or move it
        </button>
      </p>
    </div>
  );

  const panelProps = { tr, abbr };
  return (
    <PageLayout eyebrow="Personal study" title="My study" docTitle="My study" lede={lede} aside={<DataTools />} asideLabel="Your data" class="ms-page">
      <div class="ms-tabs" role="tablist" aria-label="My study" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`ms-tab-${t.id}`}
            class="ms-tab"
            aria-selected={tab === t.id}
            aria-controls={`ms-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            <span>{t.label}</span>
            <span class="ms-tab__n tnum">{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <div class="ms-panel" role="tabpanel" id={`ms-panel-${tab}`} aria-labelledby={`ms-tab-${tab}`} tabIndex={-1} key={tab}>
        {tab === 'highlights' ? <HighlightsPanel {...panelProps} /> : tab === 'notes' ? <NotesPanel {...panelProps} /> : <BookmarksPanel {...panelProps} />}
      </div>
    </PageLayout>
  );
}
