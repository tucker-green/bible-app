/**
 * #/word/{strongsId} — the word study: the "root word" deep dive.
 *
 * Contract (kept): default export, props `WordStudyPageProps`.
 *   id — normalised Strong's id from the route ("G3056", "H0430", "H0871a"); the router has already
 *        validated it with normalizeStrongs().
 *
 * Data: the lexicon entry (loadLexEntry), the word study (src/lib/wordstudy.ts: counts per book,
 * forms, Septuagint bridge, related words) and the concordance (loadConcordance: every verse), all
 * keyed the same way (base id, or the full id of a Hebrew prefix/suffix morpheme). Ids with no study
 * data (e.g. Textus Receptus words known only from the KJV's tags) get a lexicon-only page.
 *
 * Sections (src/components/wordstudy/): header (lemma, transliteration, pronunciation, Strong's,
 * part of speech, gloss, counts) · Meaning · How it's translated · Where it occurs (chart + table,
 * choosing a book filters the list) · Forms · The Septuagint bridge · Related words · Every
 * occurrence. Phones get accordion sections; desktops an "On this page" rail.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { announce, openSearch, passage, translations } from '../app/state';
import { Icon } from '../components/common/Icon';
import { PageLayout } from '../components/layout/PageLayout';
import { Distribution } from '../components/wordstudy/Distribution';
import { Forms } from '../components/wordstudy/Forms';
import { Meaning } from '../components/wordstudy/Meaning';
import type { LexBrief } from '../components/wordstudy/model';
import {
  bookCountOf,
  fmt,
  groupRefsByBook,
  isAramaicEntry,
  plural,
  renderingGroups,
  splitStrongs,
  strongsLabel,
  strongsMatcher,
} from '../components/wordstudy/model';
import { Occurrences } from '../components/wordstudy/Occurrences';
import { Renderings } from '../components/wordstudy/Renderings';
import type { TocItem } from '../components/wordstudy/Section';
import { goToSection, StudySection, StudyToc } from '../components/wordstudy/Section';
import { Bridge, Related, useLexBriefs } from '../components/wordstudy/WordChips';
import { SpeakButton } from '../components/word/SpeakButton';
import { getBookByNum } from '../lib/books';
import { loadConcordance, loadLexEntry } from '../lib/data';
import { transliterate } from '../lib/greek';
import { formatReference, refToHash } from '../lib/reference';
import type { LexEntry, WordStudy, WordStudyChunk } from '../lib/types';
import { unpackRef } from '../lib/types';
import { findStudy, loadWordStudyChunk } from '../lib/wordstudy';
import '../components/wordstudy/wordstudy.css';

export interface WordStudyPageProps {
  id: string;
}

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; lex: LexEntry | undefined; study: WordStudy | undefined; chunk: WordStudyChunk; conc: number[] | null };

const FALLBACK_TRS = [
  { id: 'KJV', name: 'King James Version' },
  { id: 'BSB', name: 'Berean Standard Bible' },
];

export default function WordStudyPage({ id }: WordStudyPageProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let off = false;
    setLoad({ status: 'loading' });
    Promise.all([loadLexEntry(id), loadWordStudyChunk(id), loadConcordance(id).catch(() => null)]).then(
      ([lex, chunk, conc]) => {
        if (off) return;
        const study = findStudy(chunk, id);
        setLoad(lex || study ? { status: 'ready', lex, study, chunk, conc } : { status: 'missing' });
      },
      () => !off && setLoad({ status: 'error' }),
    );
    return () => {
      off = true;
    };
  }, [id, attempt]);

  const label = strongsLabel(id);
  const langName = id.startsWith('G') ? 'Greek' : 'Hebrew';
  if (load.status === 'loading') {
    return (
      <PageLayout eyebrow={`Word study · ${langName}`} title={<span class="skeleton ws-skel-title" />} docTitle={`Word study ${label}`} busy>
        <div class="ws-skel">
          <span class="skeleton" style={{ width: '40%' }} />
          <span class="skeleton" style={{ width: '92%' }} />
          <span class="skeleton" style={{ width: '86%' }} />
          <span class="skeleton" style={{ width: '64%' }} />
        </div>
      </PageLayout>
    );
  }
  if (load.status !== 'ready') {
    const missing = load.status === 'missing';
    return (
      <PageLayout eyebrow={`Word study · ${langName}`} title={missing ? `No word ${label}` : 'Didn’t load'} docTitle={missing ? `No word ${label}` : 'Didn’t load'}>
        <div class="notice" role="alert">
          <div>
            <p class="notice__title">{missing ? `There is no ${langName} word with Strong’s number ${label}.` : 'This word study didn’t load.'}</p>
            <p>
              {missing
                ? 'The number may be mistyped or outside Strong’s numbering. Try searching for the word instead.'
                : navigator.onLine === false
                  ? 'You seem to be offline.'
                  : 'Check your connection and try again.'}
            </p>
            <div class="notice__actions">
              {missing ? (
                <button type="button" class="btn-quiet" onClick={() => openSearch('')}>
                  Search
                </button>
              ) : (
                <button type="button" class="btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>
              )}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }
  return <StudyView id={id} lex={load.lex} study={load.study} chunk={load.chunk} conc={load.conc} onRetry={() => setAttempt((n) => n + 1)} />;
}

interface ViewProps {
  id: string;
  lex: LexEntry | undefined;
  study: WordStudy | undefined;
  chunk: WordStudyChunk;
  conc: number[] | null;
  onRetry: () => void;
}

function StudyView({ id, lex, study, chunk, conc, onRetry }: ViewProps) {
  const readingTr = passage.value.tr;
  const trs = translations.value;
  const trMeta = trs.find((t) => t.id === readingTr);
  // Remote translations (NIV via API.Bible) would spend the reader's quota on dozens of chapters.
  const previewTr = trMeta?.remote ? 'KJV' : readingTr;
  const trNote = trMeta?.remote ? `(${trMeta.abbr} previews would use your API.Bible allowance, so the KJV is shown.)` : undefined;

  const lang: 'grc' | 'hbo' = id[0] === 'G' ? 'grc' : 'hbo';
  const aramaic = lang === 'hbo' && isAramaicEntry(lex);
  const htmlLang = lang === 'grc' ? 'grc' : aramaic ? 'arc' : 'he';
  const dir = lang === 'hbo' ? 'rtl' : undefined;
  const label = strongsLabel(study?.id ?? id);
  const lemma = lex?.lemma || study?.forms[0]?.[0] || label;
  const translit = lex?.translit || (lang === 'grc' ? transliterate(lemma) : '');
  const langName = lang === 'grc' ? 'Greek' : aramaic ? 'Aramaic' : 'Hebrew';
  const total = study?.total ?? 0;

  const match = useMemo(() => strongsMatcher(study?.id ?? id, chunk), [study, id, chunk]);
  const groups = useMemo(() => groupRefsByBook(conc ?? []), [conc]);
  const versesByBook = useMemo(() => new Map(groups.map((g) => [g.bookNum, g.refs.length] as [number, number])), [groups]);
  const verses = conc?.length || lex?.verses || 0;
  const nBooks = study ? bookCountOf(study) : groups.length;
  const firstRef = conc?.length ? toRef(conc[0]) : null;
  const rendGroups = useMemo(() => renderingGroups(lex?.renderings, trs.length ? trs : FALLBACK_TRS), [lex, trs]);
  const related = useMemo(() => {
    const ids = study?.related?.length ? study.related : splitStrongs(lex?.deriv ?? '').flatMap((p) => (p.t === 'id' ? [p.id] : []));
    return [...new Set(ids)].filter((x) => x !== id && x !== study?.id);
  }, [study, lex, id]);
  const briefs: Map<string, LexBrief> | null = useLexBriefs();

  const [book, setBook] = useState(0);
  const chooseBook = (n: number) => {
    setBook(n);
    const g = groups.find((x) => x.bookNum === n);
    announce(n && g ? `Listing the ${plural(g.refs.length, 'verse')} in ${g.name}` : `Listing every verse, ${plural(conc?.length ?? 0, 'verse')}`);
  };

  const word = (
    <span lang={htmlLang} dir={dir} class={`ws-w ws-${lang === 'grc' ? 'grc' : 'he'}`}>
      {lemma}
    </span>
  );

  const toc: TocItem[] = [];
  if (lex) toc.push({ id: 'ws-meaning', title: 'Meaning' });
  if (rendGroups.length) toc.push({ id: 'ws-translated', title: 'How it’s translated' });
  if (study && total > 0) toc.push({ id: 'ws-where', title: 'Where it occurs', n: String(nBooks) });
  if (study?.forms.length) toc.push({ id: 'ws-forms', title: 'Forms', n: String(study.forms.length) });
  if (study?.lxx?.length) toc.push({ id: 'ws-lxx', title: 'Septuagint bridge' });
  if (related.length) toc.push({ id: 'ws-related', title: 'Related words', n: String(related.length) });
  if (conc?.length) toc.push({ id: 'ws-occ', title: 'Every occurrence', n: fmt(conc.length) });

  const lxxOnly = Boolean(study && total === 0 && study.lxx?.length);
  const edition = lang === 'grc' ? 'Greek New Testament (SBLGNT)' : 'Hebrew Bible (Westminster Leningrad Codex)';

  return (
    <PageLayout
      class="ws-page"
      eyebrow={`Word study · ${langName} · ${lxxOnly ? 'Septuagint' : lang === 'grc' ? 'New Testament' : 'Old Testament'}`}
      title={
        <>
          {word}
          <span class="sr-only">, Strong’s {label}</span>
        </>
      }
      docTitle={`${lemma} (${label}) · word study`}
      lede={
        <div class="ws-lede">
          <p class="ws-lede__line">
            {translit && <span class="ws-translit">{translit}</span>}
            <SpeakButton text={lemma} lang={lang} translit={translit || undefined} size="md" />
            {lex?.pos && <span class="ws-pos">{lex.pos}</span>}
          </p>
          {lex?.gloss && <p class="ws-gloss">“{lex.gloss}”</p>}
        </div>
      }
      aside={toc.length > 2 ? <StudyToc items={toc} /> : undefined}
      asideLabel="On this page"
    >
      <div class="ws-facts">
        <span class="ws-sn" title="Strong’s number">
          <span class="sr-only">Strong’s number </span>
          {label}
        </span>
        {total > 0 && (
          <span>
            <b class="tnum">{fmt(total)}</b> {total === 1 ? 'occurrence' : 'occurrences'}
          </span>
        )}
        {verses > 0 && (
          <span>
            <b class="tnum">{fmt(verses)}</b> {verses === 1 ? 'verse' : 'verses'}
          </span>
        )}
        {nBooks > 0 && (
          <span>
            <b class="tnum">{nBooks}</b> {nBooks === 1 ? 'book' : 'books'}
          </span>
        )}
        {firstRef && (
          <span>
            First in <a href={refToHash(previewTr, firstRef)}>{formatReference(firstRef, 'short')}</a>
          </span>
        )}
        {total > 0 && (
          <button type="button" class="ws-facts__search" onClick={() => openSearch(label)}>
            <Icon name="search" />
            Search the text
          </button>
        )}
      </div>

      {!study && (
        <div class="notice ws-notice">
          <Icon name="info" />
          <div>
            <p class="notice__title">Dictionary entry only</p>
            <p>
              No verses are filed under {label} in the {edition} that Rootword links the English to, so there are no counts or verses to
              list. The word may be counted under a related number{related.length ? ' (below)' : ''}
              {lang === 'grc' ? ', or appear only in the Textus Receptus behind the King James Version, whose Strong’s tags still lead here' : ''}.
            </p>
          </div>
        </div>
      )}
      {lxxOnly && (
        <div class="notice ws-notice">
          <Icon name="info" />
          <div>
            <p class="notice__title">Septuagint only</p>
            <p>This word is not in the {edition}. Rootword knows it from the Septuagint, where it renders the Hebrew words below.</p>
          </div>
        </div>
      )}

      {lex && (
        <StudySection id="ws-meaning" title="Meaning">
          <Meaning entry={lex} tr={readingTr} lang={lang} />
        </StudySection>
      )}

      {rendGroups.length > 0 && (
        <StudySection id="ws-translated" title="How it’s translated" meta="top renderings">
          <Renderings groups={rendGroups} total={total} />
        </StudySection>
      )}

      {study && total > 0 && (
        <StudySection id="ws-where" title="Where it occurs" meta={plural(nBooks, 'book')}>
          <Distribution
            study={study}
            verses={versesByBook}
            value={book}
            onChange={chooseBook}
            onShowVerses={() => goToSection('ws-occ')}
            word={word}
          />
        </StudySection>
      )}

      {study && study.forms.length > 0 && (
        <StudySection id="ws-forms" title="Forms" meta={plural(study.forms.length, 'form')} closedOnPhone>
          <Forms study={study} lang={aramaic ? 'arc' : lang} word={lemma} />
        </StudySection>
      )}

      {study?.lxx?.length ? (
        <StudySection id="ws-lxx" title="The Septuagint bridge" meta={lang === 'hbo' ? 'Hebrew → Greek' : 'Greek ← Hebrew'}>
          <Bridge study={study} word={word} briefs={briefs} />
        </StudySection>
      ) : null}

      {related.length > 0 && (
        <StudySection id="ws-related" title="Related words" meta="by derivation">
          <Related ids={related} briefs={briefs} />
        </StudySection>
      )}

      {study && total > 0 && conc === null && (
        <div class="notice ws-notice" role="alert">
          <Icon name="alert" />
          <div>
            <p class="notice__title">The verse list didn’t load.</p>
            <div class="notice__actions">
              <button type="button" class="btn-primary" onClick={onRetry}>
                Try again
              </button>
            </div>
          </div>
        </div>
      )}
      {conc && conc.length > 0 && (
        <StudySection id="ws-occ" title="Every occurrence" meta={plural(conc.length, 'verse')} fixed>
          <Occurrences refs={conc} match={match} tr={previewTr} book={book} onBook={chooseBook} word={word} trNote={trNote} />
        </StudySection>
      )}
    </PageLayout>
  );
}

function toRef(packed: number) {
  const { bookNum, chapter, verse } = unpackRef(packed);
  const b = getBookByNum(bookNum);
  return b ? { book: b.id, chapter, verse: verse || undefined } : null;
}
