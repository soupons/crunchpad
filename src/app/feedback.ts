/**
 * "Feedback" button: opens a pre-filled GitHub issue for bug reports and suggestions.
 */
import { isDesktop } from './platform';

/** The GitHub repo that receives feedback, e.g. `https://github.com/you/crunchpad`. */
export const FEEDBACK_REPO = 'https://github.com/soupons/crunchpad';

export const feedbackConfigured = () => !FEEDBACK_REPO.includes('/OWNER/');

export function feedbackUrl(): string {
  const body = [
    '**What happened, or what would you like?**',
    '',
    '',
    '**Steps to reproduce (for bugs)**',
    '1. ',
    '',
    '---',
    `App: crunchpad (${isDesktop ? 'desktop' : 'web'})`,
    `Browser: ${navigator.userAgent}`,
  ].join('\n');
  const q = new URLSearchParams({ body });
  return `${FEEDBACK_REPO}/issues/new?${q}`;
}

/** Desktop routes http(s) links to the system browser via the window-open handler. */
export function openFeedback() {
  window.open(feedbackUrl(), '_blank', 'noopener');
}
