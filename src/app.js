// The page's script: loads the numbers, draws every part of the page, and keeps it up to date.
import { linked, loadedAt, range, RANGE_LABEL, setLoadedAt, setRange, setStats, stats } from './page/state.js';
import { dayTimeFmt, TZ_HOURS } from './page/format.js';
import { $, stateIcon } from './page/dom.js';
import { charts, paint } from './page/look.js';
import { renderNow, renderRanking, renderSummary } from './page/cards.js';
import { renderPlayers } from './page/players.js';
import { renderDaily, renderGaps, renderHours, renderOutages, renderPicker, renderRecords, renderUptime, renderWeek } from './page/history.js';
import { renderAbout, renderFooter } from './page/about.js';
import { startRain } from './page/rain.js';
import './page/leave.js';

function renderUpdated() {
  if (!loadedAt) return;
  const seconds = Math.round((Date.now() - loadedAt) / 1000);
  $('updated').textContent = seconds < 5 ? 'updated just now' : seconds < 120 ? `updated ${seconds} s ago` : `last update ${dayTimeFmt.format(loadedAt)}`;
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
    const saved = JSON.parse(localStorage.getItem('last-stats'));
    if (!saved?.servers || !(saved.history?.range in RANGE_LABEL)) return;
    setStats(saved);
    setLoadedAt(saved.now);
    setRange(saved.history.range);
    renderAll();
  } catch (err) {
    setStats(null);
    setLoadedAt(null);
  }
}

async function load({ dim = false } = {}) {
  const scoped = document.querySelectorAll('.scoped');
  if (dim) scoped.forEach((node) => node.classList.add('stale'));
  try {
    const res = await fetch(`/api/stats?range=${range}&tz=${TZ_HOURS}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const fresh = await res.json();
    setStats(fresh);
    setLoadedAt(Date.now());
    showBanner('');
    renderAll();
    // Remember the last good data, so there is something to show if the next load fails.
    try {
      localStorage.setItem('last-stats', JSON.stringify(stats));
    } catch {}
  } catch (err) {
    console.error(err);
    showBanner(
      stats
        ? `Could not refresh. Showing the last data, from ${dayTimeFmt.format(loadedAt)}. Trying again every minute.`
        : 'The stats could not be loaded. This page retries by itself every minute.',
    );
  } finally {
    scoped.forEach((node) => node.classList.remove('stale'));
  }
}

function selectRange(next, { dim = true } = {}) {
  setRange(next);
  try {
    localStorage.setItem('range', next);
  } catch {}
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

// The numbers change once a minute, so that is how often they are fetched.
setInterval(() => document.hidden || load(), 60_000);

setInterval(renderUpdated, 1000);

document.addEventListener('visibilitychange', () => document.hidden || load());

startRain();

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
    document.cookie = `accent=${next}; max-age=31536000; path=/; SameSite=Lax`;
    tint.textContent = name();
    repaint();
  });
  button.textContent = root.dataset.theme === 'light' ? 'Dark mode' : 'Light mode';
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    document.cookie = `theme=${next}; max-age=31536000; path=/; SameSite=Lax`;
    show(next);
  });
  // Follow the device while no choice has been saved.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', (event) => {
    if (!/(?:^|; )theme=/.test(document.cookie)) show(event.matches ? 'light' : 'dark');
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
  setLoadedAt(boot.now);
  renderAll();
} else if (!linked) showSaved();

selectRange(range, { dim: !boot?.servers });
