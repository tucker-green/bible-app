import './styles/theme.css';
import './styles/global.css';
import './styles/motion.css';
import './styles/a11y.css';
import './styles/print.css';
import { render } from 'preact';
import { App } from './app/App';
import { startRouter } from './app/router';
import { initRemoteTranslations } from './app/remote';
import { initState, meta, metaError, passage, route } from './app/state';
import { routeTransition } from './app/transitions';
import { loadMeta, prefetchChapter } from './lib/data';
import { initPwa } from './pwa';

initState();
// Saved API.Bible translations (the NIV…) before the router runs, so #/NIV/… links open cold.
initRemoteTranslations();
// Chapter and page changes animate with View Transitions where supported (src/app/transitions.ts).
startRouter(window, { wrap: routeTransition });

// Fetch meta.json and the first chapter in parallel (the reader waits for meta to validate the
// translation; the chapter request is already in flight by then). Only when the reader is what
// opens: a cold #/word/… link must not fetch (or spend API.Bible quota on) the last-read chapter.
const { tr, ref } = passage.peek();
if (route.peek().name === 'read' || route.peek().name === 'search') prefetchChapter(tr, ref.book, ref.chapter, { next: false });
loadMeta().then(
  (m) => {
    meta.value = m;
  },
  (err: unknown) => {
    metaError.value = err instanceof Error ? err : new Error(String(err));
  },
);

render(<App />, document.getElementById('app')!);
// Service worker, update toast, offline banner, install prompt (src/pwa.ts).
initPwa();
