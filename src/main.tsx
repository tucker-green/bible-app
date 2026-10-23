import './styles/theme.css';
import './styles/global.css';
import { render } from 'preact';
import { App } from './app/App';
import { startRouter } from './app/router';
import { initState, meta, metaError } from './app/state';
import { loadMeta } from './lib/data';

initState();
startRouter();
loadMeta().then(
  (m) => {
    meta.value = m;
  },
  (err: unknown) => {
    metaError.value = err instanceof Error ? err : new Error(String(err));
  },
);

render(<App />, document.getElementById('app')!);
