// Fills the built page with the current numbers before it is sent. People see numbers at once,
// and search engines and link previews, which may not run scripts, get them too.

const text = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** True when a server's count can be trusted and added up. The page's script uses the same rule. */
const counted = (now) => Boolean(now && now.players !== undefined && (now.unsure ? now.online : now.ok && now.online));

// This project's own repos. They are private for now, so the links only appear when the address asks for them.
const OWN_LINKS =
  '<nav class="own-links" id="own-links" aria-label="This project">' +
  '<a class="mac" href="https://github.com/hesitancy9996/mxo-apple-silicon" target="_blank" rel="noopener noreferrer" data-own>' +
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="10" height="7" rx="1"/><path d="M1.5 12.5h13l-1 1h-11z"/></svg>Play on a Mac</a>' +
  '<a href="https://github.com/hesitancy9996/whoisjackedin" target="_blank" rel="noopener noreferrer" data-own title="This site\'s code on GitHub" aria-label="This site\'s code on GitHub">' +
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 2.5 7 13.5"/></svg>Code</a>' +
  '</nav>';

/**
 * `template` is the built page. `stats` is what the stats endpoint returns. With `links`, the repo links are added.
 * With `analytics`, Vercel's visitor count script: it only exists on Vercel, and keeps one month on the free plan,
 * so the site's own counter stays the long-term record.
 */
export function renderPage(template, stats, { links = false, analytics = false } = {}) {
  const live = stats.servers.filter((server) => counted(server.now));
  const total = live.reduce((sum, server) => sum + server.now.players, 0);
  const peaks = stats.total ?? {};
  const each = stats.servers.map((server) => `${server.name} ${counted(server.now) ? server.now.players : 'offline'}`).join(', ');
  const summary = live.length
    ? `${total} ${total === 1 ? 'operative' : 'operatives'} jacked in right now (${each}). Live player counts, peaks, uptime and history for the Matrix Online community servers.`
    : null;
  // Each swap is a function, so a "$" in the data is never read as a pattern.
  const put = (page, marker, value) => page.replace(marker, () => value);
  let page = template.replace('<span id="own-links"></span>', () => (links ? OWN_LINKS : ''));
  if (analytics) page = page.replace('</body>', () => '<script defer src="/_vercel/insights/script.js"></script>\n</body>');
  if (live.length) {
    page = put(page, 'id="total-now">–<', `id="total-now">${total}<`);
    page = put(page, 'id="total-peak24">–<', `id="total-peak24">${Math.max(peaks.peak24 ?? 0, total)}<`);
    page = put(page, 'id="total-record">–<', `id="total-record">${Math.max(peaks.recordPeak ?? 0, total)}<`);
  }
  page = put(page, 'id="total-note">&nbsp;<', `id="total-note">${live.length} of ${stats.servers.length} servers online<`);
  if (summary) {
    page = page.replace(/(<meta name="description" content=")[^"]*(")/, (_, a, b) => a + text(summary) + b);
    page = page.replace(/(<meta property="og:description" content=")[^"]*(")/, (_, a, b) => a + text(summary) + b);
  }
  // The same numbers, handed to the page's script so it can draw everything without waiting.
  return put(page, '<script type="application/json" id="boot">null</script>', `<script type="application/json" id="boot">${JSON.stringify(stats).replace(/</g, '\\u003c')}</script>`);
}
