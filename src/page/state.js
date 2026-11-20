// What the page is showing: the last numbers loaded, when they came, and the chosen range.
// Only the loading code changes these, through the setters.
export const RANGE_LABEL = { '1h': 'last hour', '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days', all: 'whole record' };

/** True for a range the page knows. Inherited names such as "constructor" do not count. */
export const isRange = (value) => typeof value === 'string' && Object.hasOwn(RANGE_LABEL, value);

export let range = '24h';

try {
  const saved = localStorage.getItem('range');
  if (isRange(saved)) range = saved;
} catch {}

// A link like /?range=7d opens that range directly.
export const linked = new URLSearchParams(location.search).get('range');

if (isRange(linked)) range = linked;

export let stats = null;

// When the newest reading in `stats` was taken, on this browser's clock.
export let readingAt = null;

export const hiddenServers = new Set(); // switched off in the legend

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
