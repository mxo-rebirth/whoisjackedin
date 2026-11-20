// The page's script: loads the numbers, draws every part of the page, and keeps it up to date.
import { isRange, linked, range, readingAt, setRange, setReadingAt, setStats, stats } from './page/state.js';
import { dayTimeFmt, TZ_HOURS } from './page/format.js';
import { $, stateIcon } from './page/dom.js';
import { pref, setPref } from './page/prefs.js';
import { charts, paint } from './page/look.js';
import { renderNow, renderRanking, renderSummary } from './page/cards.js';
import { renderPlayers } from './page/players.js';
import { followFavourite, renderDaily, renderGaps, renderHours, renderOutages, renderPicker, renderRecords, renderUptime, renderWeek } from './page/history.js';
import { renderAbout, renderFooter } from './page/about.js';
import { startRain } from './page/rain.js';
import './page/leave.js';
import './page/install.js';

// The label counts from the newest reading, not from the fetch: a fetched answer can already be a minute old.
function renderUpdated() {
  if (!readingAt) return;
  const seconds = Math.max(0, Math.round((Date.now() - readingAt) / 1000));
  $('updated').textContent = seconds < 5 ? 'read just now' : seconds < 120 ? `read ${seconds} s ago` : `last read ${dayTimeFmt.format(readingAt)}`;
}

/**
 * The newest reading's time on this browser's clock. Worked out from the server's own times, so a wrong clock
 * here does not matter. `age` is how long a cache held the answer, in seconds.
 */
function readingTimeOf(data, age = 0) {
  const newest = Math.max(0, ...data.servers.map((server) => server.now?.at ?? 0));
  return newest ? Date.now() - age * 1000 - (data.now - newest) : null;
}

// The host's cache keeps each answer for a minute and may hand it out 10 s longer (see api/stats.js), so asking
// sooner only gets the same answer back. The next fetch is timed for just after that.
const CACHED_MS = 70_000;
let nextLoad = null;
function scheduleLoad(cachedAt = Date.now()) {
  clearTimeout(nextLoad);
  const wait = Math.min(75_000, Math.max(15_000, cachedAt + CACHED_MS + 2_000 - Date.now()));
  nextLoad = setTimeout(() => (document.hidden ? scheduleLoad() : load()), wait);
}

function showBanner(message) {
  const banner = $('banner');
  banner.hidden = !message;
  if (message) banner.replaceChildren(stateIcon('critical'), document.createTextNode(message));
}

function renderRecorded() {
  renderRanking();
  renderPlayers();
  renderSummary();
  renderDaily();
  renderPicker();
  renderUptime();
  renderHours();
  renderRecords();
  renderOutages();
  renderGaps();
}

function renderAll() {
  renderEverything();
  // Tells anything else on the page that the cards and footer were drawn again.
  document.dispatchEvent(new Event('mxo:render'));
}

document.addEventListener('mxo:favourite', () => {
  followFavourite();
  if (stats) renderAll();
});

function renderEverything() {
  renderNow();
  $('history-off').hidden = Boolean(stats.storage);
  $('recorded').hidden = !stats.storage;
  if (stats.storage) renderRecorded();
  renderAbout();
  renderFooter();
  renderUpdated();
}

/** Shows the data saved from the last visit right away, while fresh data loads. */

function showSaved() {
  try {
    const saved = JSON.parse(pref('last-stats'));
    if (!saved?.servers || !isRange(saved.history?.range)) return;
    setStats(saved);
    setReadingAt(readingTimeOf(saved));
    setRange(saved.history.range);
    renderAll();
  } catch (err) {
    setStats(null);
    setReadingAt(null);
  }
}

// Each load gets a number. An answer that arrives after a newer load was started is dropped, so a slow answer
// for an older range can never replace the chart of the range now chosen.
let loads = 0;

async function load({ dim = false } = {}) {
  const ticket = ++loads;
  let cachedAt;
  const scoped = document.querySelectorAll('.scoped');
  if (dim) scoped.forEach((node) => node.classList.add('stale'));
  try {
    const res = await fetch(`/api/stats?range=${range}&tz=${TZ_HOURS}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const fresh = await res.json();
    if (ticket !== loads) return;
    const age = Number(res.headers.get('age')) || 0;
    setStats(fresh);
    setReadingAt(readingTimeOf(fresh, age));
    cachedAt = Date.now() - age * 1000;
    showBanner('');
    renderAll();
    // Remember the last good data, so there is something to show if the next load fails.
    setPref('last-stats', JSON.stringify(stats));
  } catch (err) {
    if (ticket !== loads) return;
    console.error(err);
    showBanner(
      stats
        ? `Could not refresh. Showing the last data, read ${dayTimeFmt.format(readingAt)}. Trying again every minute.`
        : 'The stats could not be loaded. This page retries by itself every minute.',
    );
    scheduleLoad();
    return;
  } finally {
    scoped.forEach((node) => node.classList.remove('stale'));
  }
  scheduleLoad(cachedAt);
}

function selectRange(next, { dim = true } = {}) {
  setRange(next);
  setPref('range', next);
  for (const button of document.querySelectorAll('.ranges button')) {
    button.setAttribute('aria-pressed', String(button.dataset.range === range));
  }
  load({ dim });
}

for (const button of document.querySelectorAll('.ranges button')) {
  button.addEventListener('click', () => selectRange(button.dataset.range));
}

for (const toggle of document.querySelectorAll('[data-table]')) {
  toggle.addEventListener('click', () => {
    const wrap = $(toggle.dataset.table);
    wrap.hidden = !wrap.hidden;
    toggle.textContent = wrap.hidden ? 'Show as table' : 'Hide table';
    toggle.setAttribute('aria-expanded', String(!wrap.hidden));
  });
}

// The charts follow the width of the page.
let lastWidth = 0;

new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (width === lastWidth || !stats?.storage) return;
  lastWidth = width;
  for (const chart of charts.values()) chart.resize();
  renderPlayers();
  renderDaily();
  renderHours();
  renderWeek();
}).observe($('players-plot'));

setInterval(renderUpdated, 1000);

// Back on the tab, the numbers are fetched at once instead of waiting for the timer.
document.addEventListener('visibilitychange', () => document.hidden || load());

startRain();

// The site can be installed as an app. Not on your own computer, where a kept copy would hide fresh builds.
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) navigator.serviceWorker.register('/sw.js').catch(() => {});

{
  const root = document.documentElement;
  const button = $('theme-switch');
  /** Everything drawn in script takes the new colors: the charts, and the falling code starts over. */
  const repaint = () => {
    paint();
    const rain = $('rain');
    rain.getContext('2d').clearRect(0, 0, rain.width, rain.height);
    if (stats) renderAll();
  };
  const show = (theme) => {
    root.dataset.theme = theme;
    button.textContent = theme === 'light' ? 'Dark mode' : 'Light mode';
    repaint();
  };
  // The page's own color: the Matrix's green, or the cold blue of the world outside it.
  const tint = $('accent-switch');
  const name = () => (root.dataset.accent === 'blue' ? 'Green' : 'Blue');
  tint.textContent = name();
  tint.addEventListener('click', () => {
    const next = root.dataset.accent === 'blue' ? 'green' : 'blue';
    if (next === 'blue') root.dataset.accent = 'blue';
    else delete root.dataset.accent;
    setPref('accent', next);
    tint.textContent = name();
    repaint();
  });
  button.textContent = root.dataset.theme === 'light' ? 'Dark mode' : 'Light mode';
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    setPref('theme', next);
    show(next);
  });
  // Follow the device while no choice has been saved.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', (event) => {
    if (!pref('theme')) show(event.matches ? 'light' : 'dark');
  });
}

// One call per page view, so visits can be counted. Automated browsers are left out.
if (!navigator.webdriver) fetch('/api/hit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: document.referrer }), keepalive: true }).catch(() => {});

// The page arrives with the current numbers in it. They are drawn at once, then the viewer's own range
// and time zone are fetched. Without them, the numbers saved from the last visit fill in.
let boot = null;

try {
  boot = JSON.parse($('boot').textContent);
} catch {}

if (boot?.servers) {
  setStats(boot);
  setReadingAt(readingTimeOf(boot));
  renderAll();
} else if (!linked) showSaved();

selectRange(range, { dim: !boot?.servers });
