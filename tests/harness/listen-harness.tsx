/**
 * Visual / a11y harness for Listen mode and the pronounce button (not part of the app build).
 * Serve with Vite (npx vite) and open /tests/harness/listen.html. Query params:
 *   ?theme=light|dark       (default: system)
 *   ?view=listen|card       (default: listen)
 *   ?verse=5                verse to start listening from
 *   ?state=playing|paused|menu|ended|idle
 *
 * The page imitates the shell around the bar (a header, the reading column #text, and on phones
 * the bottom dock with a toolbar) so the bar is shown in context; the verse highlight here is a
 * stand-in for the reader's own `listeningVerse` styling. Speech synthesis comes from the browser
 * (tests inject a fake engine with addInitScript).
 */
import '../../src/styles/theme.css';
import '../../src/styles/global.css';
import '../../src/components/word/card.css';
import './listen-harness.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { listeningVerse, passage } from '../../src/app/state';
import { ListenBar, pauseListening, startListening } from '../../src/components/listen/ListenBar';
import { ListenButton } from '../../src/components/listen/ListenButton';
import { SpeakButton } from '../../src/components/word/SpeakButton';
import { configureData, loadText, tokensToText } from '../../src/lib/data';
import type { TextChapter } from '../../src/lib/types';

configureData({ base: '/data/' });
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'listen';
const startVerse = Number(params.get('verse') ?? '5') || undefined;
const state = params.get('state') ?? 'playing';

passage.value = { tr: 'KJV', ref: { book: 'JHN', chapter: 1 } };

function Chapter() {
  const [text, setText] = useState<TextChapter | null>(null);
  const current = listeningVerse.value;
  useEffect(() => {
    loadText('KJV', 'JHN', 1).then(setText, () => setText(null));
  }, []);
  useEffect(() => {
    if (!text) return;
    (window as unknown as { __ready: boolean }).__ready = true;
  }, [text]);
  return (
    <article class="hx-text" id="text" tabIndex={-1} aria-labelledby="hx-title">
      <header class="hx-chead">
        <p class="eyebrow">New Testament · Gospel</p>
        <h1 class="hx-title" id="hx-title">
          John <span class="num">1</span>
        </h1>
        <span class="hx-rule" aria-hidden="true" />
        <div class="hx-tools">
          <span class="hx-meta">King James Version · Greek · SBLGNT</span>
          <ListenButton />
        </div>
      </header>
      <div class="hx-prose">
        {text?.verses.slice(0, 18).map((v) => (
          <p key={v.v} class={`hx-verse${current === v.v ? ' is-listening' : ''}`} id={`v${v.v}`}>
            <sup class="hx-vn">{v.v}</sup> <span class="hx-vt">{tokensToText(v.t)}</span>
          </p>
        ))}
      </div>
    </article>
  );
}

function Toolbar() {
  const items = ['Books', 'KJV', 'Search', 'Reading', 'Aa'];
  return (
    <nav class="hx-toolbar" aria-label="Toolbar (harness stand-in)">
      {items.map((l) => (
        <button key={l} type="button" class="hx-tb">
          <span class="hx-tb-ico" aria-hidden="true" />
          <span>{l}</span>
        </button>
      ))}
    </nav>
  );
}

function ListenView() {
  useEffect(() => {
    if (state === 'idle') return;
    // Start from a (synthetic) user gesture, as the app does.
    startListening(startVerse);
    if (state === 'paused') setTimeout(() => pauseListening(false), 120);
    if (state === 'ended') {
      setTimeout(() => {
        const w = window as unknown as { __tts?: { finish(): void } };
        startListening(51);
        setTimeout(() => w.__tts?.finish(), 60);
      }, 150);
    }
    if (state === 'menu') setTimeout(() => document.querySelector<HTMLButtonElement>('.listen__speed')?.click(), 250);
  }, []);
  return (
    <>
      <header class="hx-head">
        <span class="hx-brand">Rootword</span>
        <span class="hx-where">John 1 · KJV</span>
      </header>
      <main id="main" class="hx-main">
        <Chapter />
      </main>
      <div class="dock">
        <div class="listen-dock">
          <ListenBar />
        </div>
        <Toolbar />
      </div>
    </>
  );
}

function CardView() {
  return (
    <main id="main" class="hx-cards">
      <h1 class="sr-only">Pronounce button in the word card</h1>
      {/* NT: Greek */}
      <div class="word-card is-pop is-pinned is-linked" role="dialog" aria-label="Word study: λόγος">
        <div class="card__inner">
          <div class="card__top">
            <span class="card__en">“the Word”</span>
            <span class="card__ref">John 1:1</span>
            <span class="card__lang">Greek · SBLGNT</span>
          </div>
          <div class="card__hero">
            <p class="card__orig" lang="grc" id="hx-head-1">
              λόγος
            </p>
            <span class="hx-say">
              <span class="card__translit">logos</span>
              <SpeakButton text="λόγος" lang="grc" translit="logos" />
            </span>
            <span class="card__hero-pill">
              <button type="button" class="card__strongs">
                G3056
              </button>
            </span>
          </div>
          <dl class="facts">
            <dt>Lemma</dt>
            <dd>
              <span class="grc" lang="grc">
                λόγος, -ου, ὁ
              </span>{' '}
              <span class="lexgl">logos</span>
            </dd>
            <dt>Parsing</dt>
            <dd>
              Noun · Nominative singular masculine <code>N-NSM</code>
            </dd>
            <dt>Gloss</dt>
            <dd class="gloss">word</dd>
          </dl>
          <p class="card__def hx-def">I. Of that by which the inward thought is expressed, Lat. oratio, sermo, vox, verbum.</p>
        </div>
      </div>

      {/* OT: Hebrew + Septuagint */}
      <div class="word-card is-pop is-pinned is-linked is-hbo" role="dialog" aria-label="Word study: אֱלֹהִים">
        <div class="card__inner">
          <div class="card__top">
            <span class="card__en">“God”</span>
            <span class="card__ref">Genesis 1:1</span>
            <span class="card__lang">Hebrew · WLC</span>
          </div>
          <div class="card__duo">
            <div class="duo__col">
              <div class="col-lbl">
                <span>Hebrew</span>
                <button type="button" class="card__strongs">
                  H430
                </button>
              </div>
              <p class="card__orig hbo" lang="hbo" dir="rtl">
                אֱלֹהִים
              </p>
              <span class="hx-say">
                <span class="card__translit">ʾĕlōhîm</span>
                <SpeakButton text="אֱלֹהִים" lang="hbo" translit="ʾĕlōhiym" />
              </span>
            </div>
            <span class="vr" aria-hidden="true" />
            <div class="duo__col">
              <div class="col-lbl">
                <span>Septuagint</span>
                <button type="button" class="card__strongs">
                  G2316
                </button>
              </div>
              <p class="lxx-word" lang="grc">
                θεὸς
              </p>
              <span class="hx-say">
                <span class="card__translit lxx-sub">theos</span>
                <SpeakButton text="θεὸς" lang="grc" translit="theos" />
              </span>
            </div>
          </div>
          <dl class="facts">
            <dt>Parsing</dt>
            <dd>
              Noun · common masculine plural absolute <code>Ncmpa</code>
            </dd>
            <dt>Gloss</dt>
            <dd class="gloss">God</dd>
          </dl>
          <div class="hx-sizes">
            <span class="eyebrow">Sizes</span>
            <SpeakButton text="λόγος" lang="grc" size="sm" />
            <SpeakButton text="λόγος" lang="grc" size="md" />
          </div>
        </div>
      </div>
    </main>
  );
}

render(view === 'card' ? <CardView /> : <ListenView />, document.getElementById('app')!);
