import './app/migrate';
import 'mathlive/fonts.css';
import 'mathlive/static.css';
import './styles.css';
import { App } from './app/app';

const app = new App({
  ribbon: document.getElementById('ribbon')!,
  page: document.getElementById('page')!,
  quick: document.getElementById('quicksearch-root')!,
  status: document.getElementById('statusbar')!,
  home: document.getElementById('home')!,
});
app.start();

// Handy for debugging from the devtools console.
(window as unknown as { crunchpad: App }).crunchpad = app;
