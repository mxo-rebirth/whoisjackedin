// What the page is showing: the last numbers loaded, when they came, and the chosen range.
// Only the loading code changes these, through the setters.
import { pref, setPref } from './prefs.js';

export const RANGE_LABEL = { '1h': 'last hour', '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days', all: 'whole record' };

/** True for a range the page knows. Inherited names such as "constructor" do not count. */
export const isRange = (value) => typeof value === 'string' && Object.hasOwn(RANGE_LABEL, value);

export let range = '24h';

if (isRange(pref('range'))) range = pref('range');

// A link like /?range=7d opens that range directly.
export const linked = new URLSearchParams(location.search).get('range');

if (isRange(linked)) range = linked;

export let stats = null;

// When the newest reading in `stats` was taken, on this browser's clock.
export let readingAt = null;

export const hiddenServers = new Set(); // switched off in the legend

/** The visitor's favourite server, or null. Its card comes first and the single-server views start on it. */
export let favourite = pref('favourite');
export const setFavourite = (id) => {
  favourite = id;
  setPref('favourite', id);
};

// A star set in another tab of this site shows here too, so a click in a stale tab cannot undo it unseen.
addEventListener('storage', (event) => {
  if (event.key !== 'favourite') return;
  favourite = event.newValue;
  document.dispatchEvent(new Event('mxo:favourite'));
});

/** Today's calendar date in this time zone, as midnight UTC. Matches the days the server sends. */

export const todayKey = () => {
  const now = new Date(stats.now);
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
};

export const setStats = (value) => {
  stats = value;
};
export const setReadingAt = (value) => {
  readingAt = value;
};
export const setRange = (value) => {
  range = value;
};
