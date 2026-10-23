import { render } from 'preact';

function Placeholder() {
  return <main>Bible app is being built…</main>;
}

render(<Placeholder />, document.getElementById('app')!);
