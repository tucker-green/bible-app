import './styles/theme.css';
import './styles/global.css';
import './styles/motion.css';
import './styles/a11y.css';
import './styles/print.css';
import { render } from 'preact';
import { App } from './app/App';
import { startRouter } from './app/router';
import { initState, meta, metaError, passage } from './app/state';
import { routeTransition } from './app/transitions';
import { loadMeta, prefetchChapter } from './lib/data';

initState();
// Chapter and page changes animate with View Transitions where supported (src/app/transitions.ts).
startRouter(window, { wrap: routeTransition });

// Fetch meta.json and the first chapter in parallel (the reader waits for meta to validate the
// translation; the chapter request is already in flight by then).
const { tr, ref } = passage.peek();
prefetchChapter(tr, ref.book, ref.chapter, { next: false });
loadMeta().then(
  (m) => {
    meta.value = m;
  },
  (err: unknown) => {
    metaError.value = err instanceof Error ? err : new Error(String(err));
  },
);

render(<App />, document.getElementById('app')!);
