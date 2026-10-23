/** #/about — what Rootword is, how the links are made, translations, and full credits & licences. */
import { useEffect } from 'preact/hooks';
import { meta, openSettings, passage, translations } from '../../app/state';
import { refToHash } from '../../lib/reference';
import { ALIGNMENT } from '../common/alignment';
import { Meter } from '../common/Meter';
import './about.css';

export function About() {
  const m = meta.value;
  const list = translations.value;
  const { tr, ref } = passage.value;
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = 'About — Rootword';
    return () => {
      document.title = 'Rootword — Read the Bible with Greek & Hebrew';
    };
  }, []);

  return (
    <div class="page page--about">
      <article class="about" aria-labelledby="about-title">
        <header class="ch-head">
          <p class="eyebrow">About</p>
          <h1 class="ch-title" id="about-title">
            <span>Rootword</span>
          </h1>
          <span class="ch-rule" aria-hidden="true" />
          <p class="about__lede">
            A reader’s edition of the Bible with its Greek and Hebrew. Read in several English translations; hover or tap any English word to
            see the original word it translates — its dictionary form, transliteration, grammar in plain words, and a definition.
          </p>
          <p class="about__back">
            <a href={refToHash(tr, { book: ref.book, chapter: ref.chapter })}>← Back to reading</a>
          </p>
        </header>

        <section>
          <h2 class="sec">
            <span>How the Greek and Hebrew links are made</span>
          </h2>
          <p>
            New Testament words link to the <b>SBL Greek New Testament</b>. Old Testament words link to the Hebrew (and Aramaic) of the{' '}
            <b>Westminster Leningrad Codex</b>; for those, the word card also shows the equivalent Greek word of the <b>Septuagint</b>, so the
            Old Testament has a Greek word beneath it too. How exactly an English word is tied to its original depends on the translation:
          </p>
          <dl class="about__kinds">
            {(['manual', 'strongs', 'bridged'] as const).map((k) => (
              <div key={k}>
                <dt>
                  <Meter kind={k} />
                </dt>
                <dd>{ALIGNMENT[k].explain}</dd>
              </div>
            ))}
          </dl>
          <p>
            Words printed in <i>italics</i> in the KJV were supplied by the translators; nothing in the Greek or Hebrew stands behind them,
            and Rootword says so when you point at one.
          </p>
        </section>

        <section>
          <h2 class="sec">
            <span>Translations</span>
          </h2>
          <table class="about__table">
            <thead>
              <tr>
                <th scope="col">Translation</th>
                <th scope="col">Year</th>
                <th scope="col">Licence</th>
                <th scope="col">Link to the original</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <th scope="row">
                    <span class="about__abbr">{t.abbr}</span> {t.name}
                    <small>{t.description}</small>
                  </th>
                  <td class="tnum">{t.year}</td>
                  <td>{t.license}</td>
                  <td>
                    <Meter kind={t.alignment} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!m && <p class="about__muted">Loading the list of translations…</p>}
        </section>

        <section>
          <h2 class="sec">
            <span>The NIV and other copyrighted translations</span>
          </h2>
          <p>
            The New International Version is copyrighted by Biblica, so Rootword never bundles it. If you have your own free API.Bible key you
            can read it here: the text is fetched from API.Bible with your key, the key is stored only in this browser, and the word links are
            matched automatically, so they are marked approximate.{' '}
            <button type="button" class="link-btn" onClick={() => openSettings('niv')}>
              Connect the NIV
            </button>
          </p>
        </section>

        <section>
          <h2 class="sec">
            <span>Credits and licences</span>
          </h2>
          <p>
            Rootword is built entirely on openly licensed scholarship. Material under <b>CC BY 4.0</b> is used under that licence with
            attribution as follows; public-domain texts are credited with thanks.
          </p>
          <ul class="credits">
            {(m?.credits ?? []).map((c) => (
              <li key={c.name}>
                <div class="credits__head">
                  <a href={c.url} target="_blank" rel="noopener noreferrer">
                    {c.name}
                  </a>
                  <span class="credits__lic">{c.license}</span>
                </div>
                {c.note && <p>{c.note}</p>}
              </li>
            ))}
          </ul>
          <p class="about__muted">
            CC BY 4.0: <a href="https://creativecommons.org/licenses/by/4.0/">creativecommons.org/licenses/by/4.0</a>. Alignments © Clear Bible
            and Biblica; SBLGNT © Society of Biblical Literature and Logos Bible Software; Macula Hebrew © Clear Bible; STEPBible lexicons ©
            Tyndale House, Cambridge. Changes: the data were converted to Rootword’s compact format and cantillation marks were removed from the
            Hebrew; the STEPBible Greek definitions (Abbott-Smith) were edited and abridged (bibliographies and apparatus brackets removed,
            sub-senses folded together), and short entries for Hebrew prefixes and suffixes (and, but, the, in, his…) were written for Rootword
            and are labelled as such; cross references with no or negative votes (and self-references) were dropped, the rest capped at 40 per verse, and the
            ESV’s 3 John 1:15 mapped to 1:14 as numbered in the KJV and BSB; the TIPNR summaries and articles of people and places were
            merged; morphology codes are shown in plain English.
          </p>
        </section>

        <section>
          <h2 class="sec">
            <span>Privacy</span>
          </h2>
          <p>
            No accounts and no analytics of our own. Your theme, last-read chapter, highlights, notes and preferences stay in this browser. An
            API.Bible key, if you add one, is stored only here and sent only to API.Bible.
          </p>
          <p>
            When you read an API.Bible translation (such as the NIV), API.Bible’s required Fair Use Management System reports each chapter
            shown to fums.api.bible with a random device ID (kept in this browser) and a session ID; no key or personal data is sent.
          </p>
          {m && (
            <p class="about__muted">
              Data version {m.version}, generated {m.generated}.
            </p>
          )}
        </section>
      </article>
    </div>
  );
}
