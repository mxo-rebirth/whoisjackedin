import * as echarts from 'echarts/core';
import { BarChart, EffectScatterChart, HeatmapChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, TooltipComponent, VisualMapContinuousComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, EffectScatterChart, HeatmapChart, LineChart, DataZoomComponent, GridComponent, TooltipComponent, VisualMapContinuousComponent, CanvasRenderer]);

const SVG_NS = 'http://www.w3.org/2000/svg';
const RANGE_LABEL = { '1h': 'last hour', '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days', all: 'whole record' };
const $ = (id) => document.getElementById(id);
// The charts are drawn on a canvas, which cannot read CSS variables. The page's colors are read into
// these objects, and read again whenever the theme changes (see paint()).
const rootStyle = getComputedStyle(document.documentElement);
const token = (name) => rootStyle.getPropertyValue(name).trim();
// Color follows the server, whatever order the list comes in.
const SERIES = {};
const colorOf = (id) => SERIES[id] ?? token('--muted');
const DAY = 86400e3;
// Days are counted in the viewer's time zone, to the nearest whole hour.
const TZ_HOURS = Math.max(-12, Math.min(14, Math.round(-new Date().getTimezoneOffset() / 60)));

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const monthDayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
// Days arrive as calendar dates stored at midnight UTC, so they are printed without shifting them.
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (date) => `${weekdayFmt.format(date)} ${date.getDate()}`;
const hourLabel = (hour) => hourFmt.format(new Date(2024, 0, 1, hour % 24));

let range = '24h';
try {
  const saved = localStorage.getItem('range');
  if (saved in RANGE_LABEL) range = saved;
} catch {}
// A link like /?range=7d opens that range directly.
const linked = new URLSearchParams(location.search).get('range');
if (linked in RANGE_LABEL) range = linked;

let stats = null;
let loadedAt = null;
let zoom = { start: 0, end: 100 }; // the part of the loaded period on show, in percent
let stacked = false;
let picked = null; // the server shown in the breakdown table and the weekly pattern
let tableRows = 'day'; // the breakdown table lists days or months
let sortBy = { column: 'period', down: true };
const hiddenServers = new Set(); // switched off in the legend

/** Today's calendar date in this time zone, as midnight UTC. Matches the days the server sends. */
const todayKey = () => {
  const now = new Date(stats.now);
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
};

/**
 * Operatives are shown whole, averages included. Half an operative confuses more than it tells.
 * An average that is above nothing but rounds to it is shown as "<1": a bar is drawn for it, so "0" would be wrong.
 */
const whole = (value) => (value > 0 && value < 0.5 ? '<1' : String(Math.round(value)));
const players = (n) => `${n} ${n === 1 ? 'operative' : 'operatives'}`;
const percent = (share) => {
  const pct = share * 100;
  return `${pct === 100 || pct === 0 ? pct : pct.toFixed(1)}%`;
};

/** Downtime in words, from how many checks were answered and how many of those found the server up. */
const downtime = (answered, online) => (answered === online ? 'no downtime' : `down for ${duration((answered - online) * stats.sampleSeconds * 1000)}`);

/** How long ago something was, in words. */
const ago = (t) => (stats.now - t < 90e3 ? 'just now' : `${duration(stats.now - t)} ago`);

function duration(ms) {
  const minutes = ms / 60000;
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} days`;
}

function el(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (parent) parent.appendChild(node);
  return node;
}

function html(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function key(id) {
  const node = html('span', 'key');
  node.style.background = colorOf(id);
  return node;
}

function link(label, url) {
  const node = html('a', '', label);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function stateIcon(kind) {
  const color = { good: 'var(--good)', critical: 'var(--critical)', unknown: 'var(--muted)' }[kind];
  const shape = { good: 'M4.5 8.2l2.3 2.3 4.7-5', critical: 'M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6', unknown: 'M4.8 8h6.4' }[kind];
  const icon = el('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' });
  el('circle', { cx: 8, cy: 8, r: 8, fill: color }, icon);
  el('path', { d: shape, fill: 'none', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, icon);
  return icon;
}

function niceStep(raw, wholeNumbers) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / power;
  const step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
  return wholeNumbers ? Math.max(1, step) : step;
}

const INK = {};
const MONO = token('--mono');
const stillPage = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const channels = (hex) => [0, 1, 2].map((i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16));
/** A see-through version of a hex color. */
const fade = (hex, alpha) => `rgba(${channels(hex).join(', ')}, ${alpha})`;
/** A solid color between two hex colors. A share of 1 is all of the first. */
const mix = (hex, other, share) => {
  const b = channels(other);
  return `rgb(${channels(hex)
    .map((a, i) => Math.round(a * share + b[i] * (1 - share)))
    .join(', ')})`;
};

const AXIS_TEXT = { fontFamily: MONO, fontSize: 11 };
const AXIS_LINE = { lineStyle: {} };
const SPLIT_LINE = { lineStyle: {} };
const TIP = {
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { fontFamily: MONO, fontSize: 12.5 },
  extraCssText: 'border-radius: 4px; box-shadow: 0 6px 22px rgba(0, 0, 0, 0.6);',
  confine: true,
  transitionDuration: stillPage ? 0 : 0.12,
  // Always near the top and beside the pointer, never on top of the value being read.
  position: (point, params, dom, rect, size) => {
    const [width] = size.contentSize;
    const right = point[0] + 18;
    return [right + width > size.viewSize[0] ? Math.max(4, point[0] - 18 - width) : right, 6];
  },
};
const BAND_POINTER = { type: 'shadow', shadowStyle: {} };

/** Reads the current theme's colors into the objects the charts use. */
function paint() {
  Object.assign(SERIES, { rejacked: token('--s1'), revived: token('--s2'), mxoemu: token('--s3') });
  Object.assign(INK, {
    text: token('--ink'),
    soft: token('--ink-2'),
    muted: token('--muted'),
    grid: token('--grid'),
    axis: token('--axis'),
    surface: token('--surface'),
    page: token('--page'),
    accent: token('--accent'),
    accentDim: token('--accent-dim'),
  });
  AXIS_TEXT.color = INK.muted;
  AXIS_LINE.lineStyle.color = INK.axis;
  SPLIT_LINE.lineStyle.color = INK.grid;
  TIP.backgroundColor = token('--tip');
  TIP.borderColor = token('--tip-border');
  TIP.textStyle.color = INK.text;
  BAND_POINTER.shadowStyle.color = fade(INK.accent, 0.07);
}
paint();

const charts = new Map();
function chartIn(node) {
  let chart = charts.get(node);
  if (!chart) {
    chart = echarts.init(node);
    charts.set(node, chart);
  }
  return chart;
}

/** The box shown on hover: when it was, what the numbers are, then one line per row as { id, name, value }. */
function tipBox(when, what, rows) {
  const box = html('div');
  box.append(html('div', 'tip-when', when), html('div', 'tip-what', what));
  for (const row of rows) {
    const line = html('div', row.sum ? 'tip-row sum' : 'tip-row');
    line.append(row.id ? key(row.id) : html('span'), html('span', 'name', row.name ?? ''), html('strong', '', row.value));
    box.append(line);
  }
  return box;
}

/**
 * The one hover box every chart uses: when it was, what the numbers are, then a row per server.
 * `values` has one entry per server: a number, null for no data, or undefined to leave the server out.
 * Averages can be added up into a "together" row. Peaks cannot, since they happen at different moments.
 */
function serversTip(when, what, values, together) {
  let sum = 0;
  let exact = 0;
  let known = 0;
  const rows = [];
  stats.servers.forEach((server, i) => {
    if (values[i] === undefined) return;
    if (values[i] !== null) {
      // The whole numbers shown are added up, so the rows always add up to the "together" row.
      sum += Math.round(values[i]);
      exact += values[i];
      known += 1;
    }
    rows.push({ id: server.id, name: server.name, value: values[i] === null ? '–' : whole(values[i]) });
  });
  if (together && known && rows.length > 1) rows.push({ name: 'together', value: sum === 0 && exact > 0 ? '<1' : String(sum), sum: true });
  return tipBox(when, what, rows);
}

/** Shows a chart's hover box at one of its x values, as if the pointer were there. */
function showTipAt(chart, value) {
  chart.dispatchAction({ type: 'showTip', x: chart.convertToPixel({ xAxisIndex: 0 }, value), y: chart.getHeight() / 3 });
}

/** Left and right arrow keys step through a chart's values, for readers without a mouse. */
function arrowKeys(node, count, show) {
  let index = null;
  node.addEventListener('keydown', (event) => {
    const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const total = count();
    if (!move || !total) return;
    event.preventDefault();
    // The first press starts at the newest value.
    index = Math.min(total - 1, Math.max(0, (index ?? total - 1 - move) + move));
    show(index);
  });
  node.addEventListener('blur', () => {
    index = null;
    charts.get(node)?.dispatchAction({ type: 'hideTip' });
  });
}

/** Uptime as a share of 1, colored like a status light: operational, partial outage or major outage. */
function uptimeMark(share) {
  return html('span', `uptime ${share >= 0.995 ? 'good' : share >= 0.95 ? 'warning' : 'critical'}`, percent(share));
}

/** What the status light and its label say for one server's latest answer. */
function statusOf(now) {
  if (!now || now.players === undefined) return { led: 'unknown', text: 'NO SIGNAL', counted: false };
  if (now.unsure) return { led: 'unsure', text: 'TRACING', counted: now.online };
  if (!now.ok) return { led: 'unknown', text: 'NO SIGNAL', counted: false };
  return now.online ? { led: 'good', text: 'ONLINE', counted: true } : { led: 'critical', text: 'OFFLINE', counted: false };
}

/** A small line of one server's player count over the selected range. */
function sparkline(server, column) {
  const svg = el('svg', { class: 'spark', viewBox: '0 0 190 44', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const { from, to, bucketMs, points } = stats.history;
  const values = points.map((row) => row[column + 1]);
  const top = Math.max(1, ...values.map((v) => v ?? 0));
  const X = (t) => Math.round(((t - from) / (to - from)) * 1880) / 10 + 1;
  const Y = (v) => Math.round((40 - (v / top) * 34) * 10) / 10;
  let line = '';
  let area = '';
  let open = false;
  let lastX = 0;
  points.forEach((row, i) => {
    const v = values[i];
    const x0 = X(Math.max(row[0], from));
    const x1 = X(Math.min(row[0] + bucketMs, to));
    if (v === null || x1 <= x0) {
      if (open) area += `V42Z`;
      open = false;
      return;
    }
    line += open ? `V${Y(v)}H${x1}` : `M${x0},${Y(v)}H${x1}`;
    area += open ? `V${Y(v)}H${x1}` : `M${x0},42V${Y(v)}H${x1}`;
    open = true;
    lastX = x1;
  });
  if (open) area += 'V42Z';
  if (area) el('path', { d: area, fill: colorOf(server.id), 'fill-opacity': 0.12 }, svg);
  if (line) el('path', { d: line, fill: 'none', stroke: colorOf(server.id), 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }, svg);
  return svg;
}

function serverCard(server, column) {
  const card = html('div', 'card server');
  card.style.setProperty('--c', colorOf(server.id));
  const now = server.now;
  const status = statusOf(now);

  const head = html('div', 'server-head');
  const badge = html('span', 'status');
  badge.append(html('span', `led ${status.led}`), status.text);
  head.dataset.server = server.id;
  // Status, name and world, stacked.
  const titles = html('div', 'server-titles');
  titles.append(badge, link(server.name, server.site));
  if (server.about?.glance?.world) titles.append(html('div', 'world', `World ${server.about.glance.world}`));
  head.append(titles);

  const body = html('div', 'server-body');
  const count = html('div');
  const known = now && now.players !== undefined;
  count.append(html('div', 'tile-value', known ? String(now.players) : '–'));
  const live = status.led === 'good' || status.led === 'critical';
  count.append(html('div', 'unit', !known ? 'no signal yet' : live ? `${now.players === 1 ? 'operative' : 'operatives'} jacked in` : 'last known count'));
  body.append(count);
  if (stats.storage && stats.history.points.length > 1) body.append(sparkline(server, column));

  const lines = [];
  if (now?.unsure) {
    const since = now.unsureSince ? ` since ${timeFmt.format(now.unsureSince)}` : '';
    lines.push(`Odd answer${since}${now.unsureDetail ? ` ("${now.unsureDetail}")` : ''}. Showing the last count while it is checked.`);
  }
  else if (now && !now.ok && known) lines.push(`No answer since ${timeFmt.format(now.failedAt)}`);
  else if (known) {
    // The world is already under the name.
    const parts = (now.details ?? []).filter((detail) => detail.label !== 'World' || !server.about?.glance?.world).map((detail) => `${detail.label}: ${detail.value}`);
    parts.push(`checked ${timeFmt.format(now.checkedAt ? new Date(now.checkedAt) : now.at)}`);
    lines.push(parts.join(' · '));
  }
  const peaks = html('div', 'peaks');
  const recordAt = server.allTime?.recordAt;
  for (const [value, label] of [[server.allTime?.peak24, '24-hour peak'], [server.allTime?.recordPeak, `all-time peak${recordAt ? `, ${ago(recordAt)}` : ''}`]]) {
    if (value === null || value === undefined) continue;
    const item = html('span');
    item.append(html('strong', '', String(value)), ` ${label}`);
    peaks.append(item);
  }
  card.append(head, body, peaks, ...lines.map((line) => html('div', 'note', line)));
  return card;
}

function renderNow() {
  const counted = stats.servers.filter((server) => statusOf(server.now).counted);
  const silent = stats.servers.filter((server) => statusOf(server.now).text === 'NO SIGNAL').length;
  const total = counted.reduce((sum, server) => sum + server.now.players, 0);
  $('total-now').textContent = counted.length || !silent ? total : '–';
  $('total-note').textContent =
    `${counted.length} of ${stats.servers.length} servers online` + (silent ? `, ${silent} with no signal` : '');
  // The peaks count all servers together. A count that is higher right now is already the new peak.
  const peaks = stats.total ?? {};
  const beaten = counted.length && total > (peaks.recordPeak ?? -1);
  $('total-peak24').textContent = peaks.peak24 == null && !counted.length ? '–' : Math.max(peaks.peak24 ?? 0, counted.length ? total : 0);
  $('total-record').textContent = peaks.recordPeak == null && !counted.length ? '–' : Math.max(peaks.recordPeak ?? 0, counted.length ? total : 0);
  $('total-record-when').textContent = beaten ? 'right now' : peaks.recordAt ? ago(peaks.recordAt) : '';

  $('share').replaceChildren(
    ...counted
      .filter((server) => server.now.players > 0)
      .map((server) => {
        const part = html('span');
        part.style.background = colorOf(server.id);
        part.style.width = `${(server.now.players / total) * 100}%`;
        return part;
      }),
  );
  $('share').setAttribute('aria-label', total ? counted.map((s) => `${s.name} ${players(s.now.players)}`).join(', ') : 'Nobody jacked in right now');
  $('share-legend').replaceChildren(
    ...stats.servers.map((server) => {
      const item = html('span');
      const isCounted = counted.includes(server);
      item.append(key(server.id), server.name, html('strong', '', isCounted ? String(server.now.players) : '–'));
      if (isCounted && total) item.append(html('span', 'note', percent(server.now.players / total)));
      return item;
    }),
  );
  $('server-cards').replaceChildren(...stats.servers.map(serverCard));
}

/** A ranked list, best first. Equal values share a place. `full` is the value that fills the whole bar. */
function rankList(target, entries, format, full) {
  const known = entries
    .filter((entry) => entry.value !== null)
    .sort((a, b) => b.value - a.value || a.server.name.localeCompare(b.server.name));
  const scale = full ?? Math.max(0, ...known.map((entry) => entry.value));
  target.replaceChildren(
    ...[...known, ...entries.filter((entry) => entry.value === null)].map((entry) => {
      const item = html('li');
      const place = entry.value === null ? '–' : String(known.findIndex((other) => format(other.value) === format(entry.value)) + 1).padStart(2, '0');
      const line = html('div', 'rank-line');
      const name = html('span', 'rank-name');
      name.append(key(entry.server.id), entry.server.name);
      line.append(name, html('strong', '', entry.value === null ? '–' : format(entry.value)));
      const bar = html('div', 'rank-bar');
      const fill = html('span');
      fill.style.width = `${entry.value && scale ? Math.max(1.5, (entry.value / scale) * 100) : 0}%`;
      fill.style.background = colorOf(entry.server.id);
      bar.append(fill);
      const main = html('div', 'rank-main');
      main.append(line, bar, html('div', 'note', entry.note));
      if (place === '01') item.className = 'top';
      item.append(html('span', 'rank-no', place), main);
      return item;
    }),
  );
}

function renderRanking() {
  $('rank-sub').textContent = `over the ${RANGE_LABEL[stats.history.range]}`;
  rankList(
    $('rank-players'),
    stats.servers.map((server) => {
      const s = server.summary;
      const now = statusOf(server.now).counted ? `now: ${server.now.players}` : 'offline now';
      return { server, value: s.answered ? s.average : null, note: s.answered ? `most at once: ${s.peak}, ${now}` : 'No data yet' };
    }),
    (value) => `${whole(value)} on average`,
  );
  rankList(
    $('rank-uptime'),
    stats.servers.map((server) => {
      const s = server.summary;
      return { server, value: s.answered ? s.availability : null, note: s.answered ? downtime(s.answered, s.onlineChecks) : 'No data yet' };
    }),
    percent,
    1,
  );
}

function rowHead(server) {
  const th = html('th');
  th.scope = 'row';
  th.append(key(server.id), server.name);
  return th;
}

function cell(value, note) {
  const td = html('td', '', value);
  if (note) td.append(html('div', 'note', note));
  return td;
}

function uptimeCell(share, note) {
  const td = html('td');
  td.append(uptimeMark(share));
  if (note) td.append(html('div', 'note', note));
  return td;
}

function renderSummary() {
  $('summary-rows').replaceChildren(
    ...stats.servers.map((server) => {
      const s = server.summary;
      const row = html('tr');
      if (!s.answered) row.append(rowHead(server), cell('–'), cell('–'), cell('–', 'No data yet'));
      else row.append(rowHead(server), cell(String(s.peak), dayTimeFmt.format(s.peakAt)), cell(whole(s.average)), uptimeCell(s.availability, downtime(s.answered, s.onlineChecks)));
      return row;
    }),
  );
}

const legendValues = new Map(); // server id -> the number shown next to its name

/** The legend doubles as a switch and as the readout: click a server to hide or show it, hover the chart to see its numbers here. */
function renderLegend() {
  legendValues.clear();
  $('players-legend').replaceChildren(
    ...stats.servers.map((server) => {
      const item = html('button');
      item.type = 'button';
      item.setAttribute('aria-pressed', String(!hiddenServers.has(server.id)));
      const value = html('strong');
      legendValues.set(server.id, value);
      item.append(key(server.id), server.name, value);
      item.addEventListener('click', () => {
        if (hiddenServers.has(server.id)) hiddenServers.delete(server.id);
        else hiddenServers.add(server.id);
        if (hiddenServers.size === stats.servers.length) hiddenServers.clear();
        renderPlayers();
      });
      return item;
    }),
  );
}

const PLAYERS_GRID = { left: 40, right: 16, top: 14, bottom: 84 };
const sliderLook = () => ({
  type: 'slider',
  left: PLAYERS_GRID.left,
  right: PLAYERS_GRID.right,
  bottom: 10,
  height: 38,
  backgroundColor: fade(INK.grid, 0.5),
  borderColor: 'transparent',
  fillerColor: fade(INK.accent, 0.1),
  dataBackground: { lineStyle: { color: INK.accentDim, opacity: 0.5, width: 1 }, areaStyle: { color: INK.accentDim, opacity: 0.22 } },
  selectedDataBackground: { lineStyle: { color: INK.accent, opacity: 0.9, width: 1 }, areaStyle: { color: INK.accent, opacity: 0.3 } },
  handleSize: '70%',
  handleStyle: { color: INK.accent, borderColor: INK.accent },
  moveHandleSize: 5,
  moveHandleStyle: { color: INK.accentDim, opacity: 0.7 },
  brushStyle: { color: fade(INK.accent, 0.2) },
  emphasis: { handleStyle: { color: INK.text, borderColor: INK.text }, moveHandleStyle: { color: INK.accent, opacity: 1 } },
  textStyle: { color: INK.soft, fontFamily: MONO, fontSize: 11 },
  labelFormatter: (value) => dayTimeFmt.format(value),
});
// How wide one point of the chart may be. All of them line up with the clock and the calendar.
const MINUTE = 60e3;
const STEP_WIDTHS = [2, 4, 6, 10, 20, 30, 60, 120, 180, 360, 1440, 2 * 1440, 7 * 1440, 14 * 1440, 28 * 1440].map((minutes) => minutes * MINUTE);

let shownRange = null; // the range the chart was last drawn for
let settle = null; // timer: the chart is redrawn once zooming stops
let steps = []; // what the chart is drawing, see joinSteps
let stepMs = 0;

const isZoomed = () => zoom.start > 0.01 || zoom.end < 99.99;
/** 5.0 reads as 5, anything else keeps one decimal. */
const amount = (value) => String(Math.round(value * 10) / 10);


/** The stretch of time the chart covers: the loaded range, starting where the data starts. */
function chartSpan() {
  const { from, to, points } = stats.history;
  return { from: points.length ? Math.max(from, points[0][0]) : from, to };
}

/** The period the chart is zoomed to. */
function shownWindow() {
  const { from, to } = chartSpan();
  return { from: from + ((to - from) * zoom.start) / 100, to: from + ((to - from) * zoom.end) / 100 };
}

/**
 * The saved steps of time, joined into wider ones so the chart never draws more than about ninety points,
 * however far it is zoomed out. Zooming in brings the detail back. Each joined step is
 * { start, end, mean, peak }, with one entry per server and null where nothing is known.
 */
function joinSteps() {
  const { bucketMs, points, means, to } = stats.history;
  const view = shownWindow();
  // The finest choice is the saved step itself.
  const fits = [bucketMs, ...STEP_WIDTHS.filter((size) => size > bucketMs && size % bucketMs === 0)];
  const width = fits.find((size) => (view.to - view.from) / size <= 90) ?? fits.at(-1);
  // Joined steps start on local clock times, so a day-wide step is a local day.
  const shift = -new Date().getTimezoneOffset() * MINUTE;
  const joined = [];
  points.forEach((row, k) => {
    const start = Math.floor((row[0] + shift) / width) * width - shift;
    let step = joined.at(-1);
    if (!step || step.start !== start) {
      const blank = (fill) => row.slice(1).map(() => fill);
      step = { start, end: Math.min(start + width, to), sum: blank(0), count: blank(0), peak: blank(null) };
      joined.push(step);
    }
    row.slice(1).forEach((peak, i) => {
      if (peak === null) return;
      // Data saved by an older version of the page has no averages. The peak stands in.
      step.sum[i] += means?.[k]?.[i] ?? peak;
      step.count[i] += 1;
      step.peak[i] = Math.max(step.peak[i] ?? 0, peak);
    });
  });
  for (const step of joined) step.mean = step.sum.map((sum, i) => (step.count[i] ? sum / step.count[i] : null));
  return { joined, width };
}

function resetZoom() {
  charts.get($('players-chart'))?.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 });
}

/** A length of time in words, for "averaged over ...". */
function lengthWords(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes < 1440) return minutes === 60 ? 'an hour' : `${amount(minutes / 60)} hours`;
  return minutes === 1440 ? 'a day' : `${amount(minutes / 1440)} days`;
}

/** The line above the chart: which period is on show, and how fine the steps are. */
function renderPlayersHead() {
  const { range: name, bucketMs, from } = stats.history;
  const view = shownWindow();
  // Say so when the saved history is shorter than the selected range.
  const partial = !isZoomed() && name !== 'all' && stats.since && stats.since - from > 2 * bucketMs;
  $('players-sub').textContent =
    (isZoomed() ? `${dayTimeFmt.format(view.from)} to ${dayTimeFmt.format(view.to)}` : RANGE_LABEL[name]) +
    (stepMs ? `, averaged over ${lengthWords(stepMs)}` : '') +
    (partial ? `, counting since ${dayTimeFmt.format(stats.since)}` : '');
  $('zoom-reset').hidden = !isZoomed();
}

function timeLabel(value) {
  const date = new Date(value);
  if (date.getHours() || date.getMinutes()) return timeFmt.format(date);
  const view = shownWindow();
  return view.to - view.from > 14 * DAY ? monthDayFmt.format(date) : dayLabel(date);
}

/** The numbers beside the names in the legend: the count on each server right now. */
function renderReadout() {
  let sum = 0;
  let known = 0;
  for (const server of stats.servers) {
    const value = statusOf(server.now).counted ? server.now.players : null;
    legendValues.get(server.id)?.replaceChildren(value === null ? '–' : String(value));
    if (value === null || hiddenServers.has(server.id)) continue;
    sum += value;
    known += 1;
  }
  $('players-readout').textContent = `right now: ${known ? `${sum} together` : 'no data'}`;
}

/** The hover box for one moment of the main chart. */
function playersTip(t) {
  const step = steps.find((item) => t >= item.start && t < item.end);
  if (!step) return tipBox(dayTimeFmt.format(t), 'not recorded', []);
  const down = stats.servers.filter((server) => !hiddenServers.has(server.id) && server.allTime.outages.some((o) => o.from < step.end && o.to > step.start));
  return serversTip(
    `${dayTimeFmt.format(step.start)} to ${timeFmt.format(step.end)}`,
    'average' + (down.length ? `, outage on ${down.map((server) => server.name).join(', ')}` : ''),
    stats.servers.map((server, i) => (hiddenServers.has(server.id) ? undefined : step.mean[i])),
    true,
  );
}

/** Zoom by dragging across the chart. Touch is left alone so the page can still scroll. */
function wirePlayers(chart, node) {
  chart.on('datazoom', (event) => {
    const { start, end } = event.batch?.[0] ?? event;
    if (typeof start !== 'number' || typeof end !== 'number') return;
    zoom = { start, end };
    renderPlayersHead();
    // Once zooming stops, redraw so the scale and the detail fit what is on show.
    clearTimeout(settle);
    settle = setTimeout(renderPlayers, 180);
  });

  const box = $('zoom-box');
  let drag = null;
  const xOf = (event) => event.clientX - node.getBoundingClientRect().left;
  node.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.button !== 0 || !stats) return;
    const y = event.clientY - node.getBoundingClientRect().top;
    if (!chart.containPixel({ gridIndex: 0 }, [xOf(event), y])) return;
    drag = { x: xOf(event), to: null, id: event.pointerId };
  });
  node.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const x = Math.min(node.clientWidth - PLAYERS_GRID.right, Math.max(PLAYERS_GRID.left, xOf(event)));
    if (drag.to === null && Math.abs(x - drag.x) < 6) return;
    if (drag.to === null) node.setPointerCapture(drag.id);
    drag.to = x;
    box.hidden = false;
    box.style.left = `${Math.min(drag.x, x)}px`;
    box.style.width = `${Math.abs(x - drag.x)}px`;
    box.style.top = `${PLAYERS_GRID.top}px`;
    box.style.height = `${chart.getHeight() - PLAYERS_GRID.top - PLAYERS_GRID.bottom}px`;
  });
  const finish = (apply) => {
    const done = drag;
    drag = null;
    box.hidden = true;
    if (!apply || !done || done.to === null) return;
    const { from, to } = chartSpan();
    const { bucketMs } = stats.history;
    let a = chart.convertFromPixel({ xAxisIndex: 0 }, Math.min(done.x, done.to));
    let b = chart.convertFromPixel({ xAxisIndex: 0 }, Math.max(done.x, done.to));
    // Never closer than two steps.
    if (b - a < 2 * bucketMs) {
      const middle = (a + b) / 2;
      a = middle - bucketMs;
      b = middle + bucketMs;
    }
    const share = (t) => Math.min(100, Math.max(0, ((t - from) / (to - from)) * 100));
    chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: share(a), end: share(b) });
  };
  node.addEventListener('pointerup', () => finish(true));
  node.addEventListener('pointercancel', () => finish(false));
  node.addEventListener('dblclick', resetZoom);

  const inView = () => {
    const view = shownWindow();
    return steps.filter((step) => step.end > view.from && step.start < view.to);
  };
  arrowKeys(
    node,
    () => inView().length,
    (index) => {
      const view = shownWindow();
      const step = inView()[index];
      showTipAt(chart, Math.min(view.to, Math.max(view.from, (step.start + step.end) / 2)));
    },
  );
}

function renderPlayers() {
  const node = $('players-chart');
  const isNew = !charts.has(node);
  const chart = chartIn(node);
  if (isNew) wirePlayers(chart, node);
  clearTimeout(settle);

  const servers = stats.servers;
  const { range: name, bucketMs } = stats.history;
  const { from, to } = chartSpan();
  // A newly loaded range starts zoomed all the way out.
  const fresh = shownRange !== name;
  shownRange = name;
  if (fresh) zoom = { start: 0, end: 100 };
  const { joined, width } = joinSteps();
  steps = joined;
  stepMs = width;
  const view = shownWindow();
  const shown = servers.map((_, i) => i).filter((i) => !hiddenServers.has(servers[i].id));
  renderLegend();
  renderReadout();
  renderPlayersHead();
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-pressed', String((button.dataset.mode === 'stacked') === stacked));
  }

  // The scale fits what is on show, so zooming in on a quiet period still fills the chart.
  const topOf = (step) => (stacked ? shown.reduce((sum, i) => sum + (step.mean[i] ?? 0), 0) : Math.max(0, ...shown.map((i) => step.mean[i] ?? 0)));
  const peak = Math.max(4, ...steps.filter((step) => step.end > view.from && step.start < view.to).map(topOf));
  const tick = niceStep(peak / 4, true);
  const yMax = Math.ceil(peak / tick) * tick;
  const ticks = Array.from({ length: Math.round(yMax / tick) + 1 }, (_, i) => i * tick);
  // A few pixels of room above and below, so a line on the edge is not cut.
  const plotHeight = Math.max(60, chart.getHeight() - PLAYERS_GRID.top - PLAYERS_GRID.bottom);
  const pixel = yMax / (plotHeight - 10);
  // Lines that sit on the same value are nudged a couple of pixels apart so each stays visible.
  const nudge = (k) => (stacked ? 0 : (k - (shown.length - 1) / 2) * 2 * pixel);

  // One point per joined step, in the middle of it.
  const tracks = shown.map(() => []);
  const totals = [[from, null]];
  for (const step of steps) {
    const x = (Math.max(step.start, from) + step.end) / 2;
    let sum = 0;
    let known = false;
    shown.forEach((i, k) => {
      const value = step.mean[i];
      if (value === null) {
        tracks[k].push([x, null]);
        return;
      }
      known = true;
      sum += value;
      // In the stacked view each server sits on top of the ones before it.
      tracks[k].push([x, stacked ? sum : value + nudge(k)]);
    });
    totals.push([x, known ? sum : null]);
  }
  totals.push([to, null]);

  // A dot marks where each line is now.
  const live = [];
  if (!stacked && zoom.end > 99.9) {
    shown.forEach((i, k) => {
      const last = tracks[k].at(-1);
      if (last && last[1] !== null) live.push({ value: last, itemStyle: { color: colorOf(servers[i].id) } });
    });
  }

  const series = [
    // Never drawn. It gives the strip under the chart its shape.
    { id: 'total', type: 'line', data: totals, symbol: 'none', silent: true, animation: false, lineStyle: { opacity: 0 }, tooltip: { show: false } },
    ...shown.map((i, k) => {
      const server = servers[i];
      const color = colorOf(server.id);
      return {
        id: server.id,
        name: server.name,
        type: 'line',
        data: tracks[k],
        smooth: 0.4,
        smoothMonotone: 'x',
        showSymbol: false,
        symbol: 'circle',
        symbolSize: 9,
        z: stacked ? 10 - k : 3,
        itemStyle: { color, borderColor: INK.surface, borderWidth: 2 },
        lineStyle: stacked ? { width: 1.5, color: INK.surface } : { width: 2, color },
        areaStyle: stacked ? { opacity: 1, color: mix(color, INK.surface, 0.88) } : { opacity: 0 },
        emphasis: { lineStyle: { width: stacked ? 1.5 : 2 } },
      };
    }),
    {
      id: 'live',
      type: 'effectScatter',
      data: live,
      symbolSize: 7,
      silent: true,
      animation: false,
      z: 12,
      zlevel: 1,
      showEffectOn: stillPage ? 'emphasis' : 'render',
      rippleEffect: { scale: 2.6, brushType: 'stroke', period: 3.2 },
      tooltip: { show: false },
    },
  ];

  const zoomBase = { filterMode: 'none', minValueSpan: 2 * bucketMs, ...(fresh ? { start: 0, end: 100 } : {}) };
  chart.setOption(
    {
      animationDuration: stillPage ? 0 : 700,
      animationDurationUpdate: stillPage ? 0 : 300,
      grid: PLAYERS_GRID,
      tooltip: { ...TIP, trigger: 'axis', formatter: (params) => playersTip(params[0]?.axisValue ?? to), axisPointer: { type: 'line', snap: false, lineStyle: { color: INK.muted, width: 1, type: 'solid' }, label: { show: false } } },
      xAxis: {
        type: 'time',
        min: from,
        max: to,
        axisLine: AXIS_LINE,
        axisTick: { ...AXIS_LINE, length: 4 },
        splitLine: { show: false },
        axisLabel: { ...AXIS_TEXT, hideOverlap: true, formatter: timeLabel },
      },
      yAxis: {
        type: 'value',
        min: -5 * pixel,
        max: yMax + 5 * pixel,
        axisLine: { show: false },
        axisTick: { show: false, customValues: ticks },
        axisLabel: { ...AXIS_TEXT, customValues: ticks },
        splitLine: SPLIT_LINE,
      },
      dataZoom: [
        { type: 'inside', ...zoomBase, zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: 'shift', moveOnMouseMove: false, preventDefaultMouseMove: false },
        { ...sliderLook(), ...zoomBase },
      ],
      series,
    },
    { replaceMerge: ['series'] },
  );

  $('players-empty').hidden = steps.length >= 2;
  const most = Math.max(1, ...steps.flatMap((step) => step.mean.map((value) => value ?? 0)));
  $('players-head').replaceChildren(headCell('Time'), ...servers.map(serverHead));
  $('players-rows').replaceChildren(
    ...steps
      .slice()
      .reverse()
      .map((step) => serverRow(`${dayTimeFmt.format(step.start)} to ${timeFmt.format(step.end)}`, step.mean, most)),
  );
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    stacked = button.dataset.mode === 'stacked';
    renderPlayers();
  });
}
$('zoom-reset').addEventListener('click', resetZoom);

let dailyCount = 0;

/** Grouped bars: the most operatives each server had at once, day by day. */
function renderDaily() {
  const node = $('daily-chart');
  const isNew = !charts.has(node);
  const chart = chartIn(node);
  if (isNew) arrowKeys(node, () => dailyCount, (index) => showTipAt(chart, index));
  const servers = stats.servers;
  const today = todayKey();
  const byDay = servers.map((server) => new Map(server.allTime.days.map((day) => [day[0], day])));
  const firstDay = Math.min(today, ...servers.map((server) => server.allTime.days[0]?.[0] ?? today));
  dailyCount = Math.min(node.clientWidth < 560 ? 14 : 30, Math.max(7, (today - firstDay) / DAY + 1));
  const days = Array.from({ length: dailyCount }, (_, k) => today - (dailyCount - 1 - k) * DAY);
  const peak = Math.max(4, ...days.flatMap((t) => byDay.map((map) => map.get(t)?.[3] ?? 0)));
  const step = niceStep(peak / 3, true);
  chart.setOption({
    animationDuration: stillPage ? 0 : 600,
    grid: { left: 40, right: 12, top: 12, bottom: 26 },
    tooltip: {
      ...TIP,
      trigger: 'axis',
      axisPointer: BAND_POINTER,
      formatter: (params) => {
        const t = days[params[0]?.dataIndex ?? days.length - 1];
        return serversTip(dateFmt.format(t) + (t === today ? ', so far' : ''), 'most at once', servers.map((_, i) => byDay[i].get(t)?.[3] ?? null), false);
      },
    },
    xAxis: { type: 'category', data: days.map((t) => dateFmt.format(t)), axisLine: AXIS_LINE, axisTick: { show: false }, axisLabel: { ...AXIS_TEXT, hideOverlap: true } },
    yAxis: { type: 'value', min: 0, max: Math.ceil(peak / step) * step, interval: step, axisLabel: AXIS_TEXT, splitLine: SPLIT_LINE },
    series: servers.map((server, i) => ({
      id: server.id,
      name: server.name,
      type: 'bar',
      data: days.map((t) => byDay[i].get(t)?.[3] || null),
      barGap: '12%',
      barCategoryGap: '24%',
      barMaxWidth: 22,
      itemStyle: { color: colorOf(server.id), borderRadius: [4, 4, 0, 0] },
    })),
  });
}

/** One switch for the two views that show a single server. */
function renderPicker() {
  if (!stats.servers.some((server) => server.id === picked)) picked = stats.servers[0].id;
  $('server-picker').replaceChildren(
    ...stats.servers.map((server) => {
      const button = html('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(server.id === picked));
      button.append(key(server.id), server.name);
      button.addEventListener('click', () => {
        picked = server.id;
        renderPicker();
      });
      return button;
    }),
  );
  renderBreakdown();
  renderWeek();
}

const BREAKDOWN = [
  ['period', ''],
  ['peak', 'Peak'],
  ['gain', 'Gain'],
  ['gainPct', '% gain'],
  ['average', 'Average'],
  ['avgPct', 'Avg % gain'],
  ['online', 'Uptime'],
];

/** Adds day entries ([dayStart, answered, online, peak, sum]) up into one period. Null when there is nothing to add. */
function sumDays(days) {
  let answered = 0;
  let online = 0;
  let peak = 0;
  let sum = 0;
  for (const day of days) {
    answered += day[1];
    online += day[2];
    peak = Math.max(peak, day[3]);
    sum += day[4];
  }
  return answered ? { peak, average: sum / answered, online: online / answered } : null;
}

/** One table row: a period's numbers, and how they changed from the period before it. */
function compare(label, period, now, before) {
  return {
    label,
    period,
    peak: now.peak,
    average: now.average,
    online: now.online,
    gain: before ? now.peak - before.peak : null,
    gainPct: before?.peak ? (now.peak - before.peak) / before.peak : null,
    avgPct: before?.average ? (now.average - before.average) / before.average : null,
  };
}

/** A change, with its sign and a color: up or down. */
function changeCell(value, digits, unit = '') {
  if (value === null) return html('td', 'note', '–');
  const shown = Number(value.toFixed(digits));
  return html('td', shown > 0 ? 'up' : shown < 0 ? 'down' : '', `${shown > 0 ? '+' : shown < 0 ? '−' : ''}${Math.abs(shown).toFixed(digits)}${unit}`);
}

/** Peak, average and change for the picked server, by day or by month. Click a heading to sort. */
function renderBreakdown() {
  const server = stats.servers.find((item) => item.id === picked);
  const days = server.allTime.days;
  const today = todayKey();
  const byMonth = tableRows === 'month';
  for (const button of document.querySelectorAll('[data-rows]')) button.setAttribute('aria-pressed', String(button.dataset.rows === tableRows));
  $('breakdown-sub').textContent = `${server.name}, each ${byMonth ? 'month' : 'day'} compared with the one before`;

  let periods;
  if (byMonth) {
    const months = new Map();
    for (const day of days) {
      const date = new Date(day[0]);
      const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
      months.set(start, [...(months.get(start) ?? []), day]);
    }
    const thisMonth = Date.UTC(new Date(today).getUTCFullYear(), new Date(today).getUTCMonth(), 1);
    periods = [...months].map(([start, list]) => ({ start, label: monthFmt.format(start) + (start === thisMonth ? ', so far' : ''), total: sumDays(list) }));
  } else {
    periods = days.map((day) => ({ start: day[0], label: dateFmt.format(day[0]) + (day[0] === today ? ', so far' : ''), total: sumDays([day]) }));
  }
  const rows = periods.map((period, k) => compare(period.label, period.start, period.total, periods[k - 1]?.total ?? null));
  rows.sort((a, b) => {
    const x = a[sortBy.column];
    const y = b[sortBy.column];
    if (x === null || y === null) return (x === null) - (y === null);
    return sortBy.down ? y - x : x - y;
  });

  // The newest stretch, against the same number of days before it. These rows stay on top.
  const within = (from, to) => sumDays(days.filter((day) => day[0] >= from && day[0] <= to));
  const lastDays = (n) => {
    const now = within(today - (n - 1) * DAY, today);
    return now ? [compare(`Last ${n} days`, null, now, within(today - (2 * n - 1) * DAY, today - n * DAY))] : [];
  };
  const pinned = byMonth ? lastDays(30) : [...lastDays(7), ...lastDays(30)];

  $('breakdown-head').replaceChildren(
    ...BREAKDOWN.map(([column, label]) => {
      const th = html('th');
      th.scope = 'col';
      const button = html('button', 'sort', column === 'period' ? (byMonth ? 'Month' : 'Day') : label);
      button.type = 'button';
      if (sortBy.column === column) {
        th.setAttribute('aria-sort', sortBy.down ? 'descending' : 'ascending');
        button.append(html('span', 'sort-mark', sortBy.down ? ' ▾' : ' ▴'));
      }
      button.addEventListener('click', () => {
        sortBy = { column, down: sortBy.column === column ? !sortBy.down : true };
        renderBreakdown();
      });
      th.append(button);
      return th;
    }),
  );
  // Peak and average get a bar behind the number, as long as the number is big.
  const everything = [...pinned, ...rows];
  const most = { peak: Math.max(1, ...everything.map((row) => row.peak)), average: Math.max(0.01, ...everything.map((row) => row.average)) };
  const bar = (text, share) => {
    const td = html('td', 'bar', text);
    td.style.setProperty('--fill', `${Math.round(share * 100)}%`);
    return td;
  };
  $('breakdown-rows').closest('table').style.setProperty('--c', colorOf(server.id));
  const line = (row, className) => {
    const tr = html('tr', className);
    tr.append(
      html('td', '', row.label),
      bar(String(row.peak), row.peak / most.peak),
      changeCell(row.gain, 0),
      changeCell(row.gainPct === null ? null : row.gainPct * 100, 1, '%'),
      bar(whole(row.average), row.average / most.average),
      changeCell(row.avgPct === null ? null : row.avgPct * 100, 1, '%'),
      uptimeCell(row.online),
    );
    return tr;
  };
  const body = [...pinned.map((row) => line(row, 'pinned')), ...rows.map((row) => line(row, ''))];
  $('breakdown-rows').replaceChildren(...(body.length ? body : [tableRow('No data yet', '–', '–', '–', '–', '–', '–')]));
}

for (const button of document.querySelectorAll('[data-rows]')) {
  button.addEventListener('click', () => {
    tableRows = button.dataset.rows;
    sortBy = { column: 'period', down: true };
    renderBreakdown();
  });
}

/** Weekday by hour: when operatives are usually on, for the picked server. */
function renderWeek() {
  const server = stats.servers.find((item) => item.id === picked);
  const color = colorOf(server.id);
  // The totals arrive in UTC, Sunday first. Shift them to this time zone.
  const local = Array.from({ length: 168 }, () => [0, 0]);
  (server.allTime.weekUtc ?? []).forEach((slot, index) => {
    local[(index + TZ_HOURS + 168) % 168] = slot;
  });
  const averages = local.map(([sum, n]) => (n ? sum / n : null));
  // The hover box lists every server, so each one's week is worked out the same way.
  const everyone = stats.servers.map((item) => {
    const week = Array.from({ length: 168 }, () => null);
    (item.allTime.weekUtc ?? []).forEach(([sum, n], index) => {
      week[(index + TZ_HOURS + 168) % 168] = n ? sum / n : null;
    });
    return week;
  });
  const top = Math.max(0, ...averages.map((v) => v ?? 0));
  const dayName = (weekday) => weekdayFmt.format(new Date(2024, 0, 7 + weekday)); // 7 January 2024 was a Sunday
  const order = [1, 2, 3, 4, 5, 6, 0];
  // Hours with no data get -1, which falls outside the color scale and is drawn as an empty square.
  const cells = order.flatMap((weekday, row) => Array.from({ length: 24 }, (_, hour) => [hour, row, averages[weekday * 24 + hour] ?? -1]));
  const node = $('week');
  const every = node.clientWidth < 520 ? 6 : 3;
  chartIn(node).setOption({
    animationDuration: stillPage ? 0 : 500,
    grid: { left: 40, right: 4, top: 22, bottom: 4 },
    tooltip: {
      ...TIP,
      trigger: 'item',
      formatter: ({ value: [hour, row] }) =>
        serversTip(`${dayName(order[row])}, ${hourLabel(hour)} to ${hourLabel(hour + 1)}`, 'average', everyone.map((week) => week[order[row] * 24 + hour]), true),
    },
    xAxis: {
      type: 'category',
      position: 'top',
      data: Array.from({ length: 24 }, (_, hour) => hourLabel(hour)),
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: { ...AXIS_TEXT, interval: (index) => index % every === 0 },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: order.map(dayName),
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: { ...AXIS_TEXT, color: INK.soft },
    },
    visualMap: { type: 'continuous', show: false, dimension: 2, min: 0, max: top || 1, inRange: { color: [mix(color, INK.surface, 0.14), color] }, outOfRange: { color: [INK.grid] } },
    series: [{ type: 'heatmap', data: cells, itemStyle: { borderColor: INK.surface, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: INK.text, borderWidth: 1 } } }],
  });
  const filled = averages.filter((v) => v !== null).length;
  const best = averages.reduce((bestSlot, v, slot) => (v !== null && v > (averages[bestSlot] ?? 0) ? slot : bestSlot), -1);
  node.setAttribute('aria-label', `Average operatives on ${server.name} by weekday and hour.` + (best < 0 ? '' : ` Busiest: ${dayName(Math.floor(best / 24))} around ${hourLabel(best % 24)}.`));
  $('week-sub').textContent = `${server.name}, average operatives by weekday and hour, in your time zone`;
  $('week-note').textContent = filled < 168 ? `${filled} of 168 hours have data so far. It fills in over a week.` : '';
  $('week-key').style.setProperty('--c', color);
}

function headCell(text) {
  const th = html('th', '', text);
  th.scope = 'col';
  return th;
}

function tableRow(...cells) {
  const row = html('tr');
  for (const text of cells) row.append(html('td', '', String(text)));
  return row;
}

/** A column heading for one server: its color mark and its name. */
function serverHead(server) {
  const th = headCell('');
  th.append(key(server.id), ` ${server.name}`);
  return th;
}

/**
 * A table row with one number per server. Each number sits on a bar in that server's color,
 * as long as the number is big compared with `most`.
 */
function serverRow(label, values, most) {
  const row = html('tr');
  row.append(html('td', '', label));
  stats.servers.forEach((server, i) => {
    const value = values[i];
    const td = html('td', value === null ? 'note' : 'bar', value === null ? 'No data' : whole(value));
    if (value !== null) {
      td.style.setProperty('--c', colorOf(server.id));
      td.style.setProperty('--fill', `${Math.round((value / most) * 100)}%`);
    }
    row.append(td);
  });
  return row;
}

function renderUptime() {
  const today = todayKey();
  $('uptime').replaceChildren(
    ...stats.servers.map((server) => {
      const byDay = new Map(server.allTime.days.map(([t, answered, online]) => [t, { answered, online }]));
      let answered = 0;
      let online = 0;
      const strip = html('div', 'strip');
      for (let i = 89; i >= 0; i--) {
        const t = today - i * DAY;
        const day = byDay.get(t);
        const cellNode = html('i');
        const label = dateFmt.format(t);
        if (!day) {
          cellNode.title = `${label}: no data`;
        } else {
          answered += day.answered;
          online += day.online;
          const share = day.online / day.answered;
          cellNode.className = share >= 0.995 ? 'good' : share >= 0.95 ? 'warning' : 'critical';
          cellNode.title = `${label}: ${share >= 0.995 ? 'operational' : share >= 0.95 ? 'partial outage' : 'major outage'}, online ${percent(share)} of the time, ${downtime(day.answered, day.online)}`;
        }
        strip.append(cellNode);
      }
      const row = html('div', 'uptime-row');
      const head = html('div', 'uptime-head');
      const name = html('span', 'name');
      name.append(key(server.id), server.name);
      const total = html('span');
      if (answered) total.append(html('strong', '', percent(online / answered)), html('span', 'note', ` over ${byDay.size} ${byDay.size === 1 ? 'day' : 'days'}`));
      else total.append(html('span', 'note', 'no data yet'));
      head.append(name, total);
      strip.setAttribute('role', 'img');
      strip.setAttribute('aria-label', answered ? `${server.name}: online ${percent(online / answered)} of the time over ${byDay.size} days of data` : `${server.name}: no data yet`);
      row.append(head, strip);
      return row;
    }),
  );
}

function renderRecords() {
  $('alltime-scope').textContent = stats.since ? `counting since ${monthDayFmt.format(stats.since)}` : '';
  $('records-rows').replaceChildren(
    ...stats.servers.map((server) => {
      const a = server.allTime;
      const row = html('tr');
      const record = a.recordPeak === null ? cell('–', 'No data yet') : cell(String(a.recordPeak), dayTimeFmt.format(a.recordAt));
      let seen = cell('–', 'Nobody jacked in yet');
      if (statusOf(server.now).counted && server.now.players > 0) seen = cell('Now', `${players(server.now.players)} jacked in`);
      else if (a.lastPlayersAt) seen = cell(`${duration(stats.now - a.lastPlayersAt)} ago`, dayTimeFmt.format(a.lastPlayersAt));
      row.append(rowHead(server), record, seen);
      return row;
    }),
  );
}

/** Hourly totals come in UTC. This turns them into 24 local-time averages (null where there is no data). */
function localAverages(hoursUtc) {
  const slots = Array.from({ length: 24 }, () => [0, 0]);
  hoursUtc.forEach(([sum, n], utcHour) => {
    const at = new Date();
    at.setUTCHours(utcHour, 0, 0, 0);
    slots[at.getHours()][0] += sum;
    slots[at.getHours()][1] += n;
  });
  return slots.map(([sum, n]) => ({ average: n ? sum / n : null, checks: n }));
}

const hourBoxes = new Map();

/** One small chart per server, made the first time it is needed. */
function hourBox(server) {
  if (hourBoxes.has(server.id)) return hourBoxes.get(server.id);
  const root = html('div', 'mini');
  const head = html('div', 'mini-head');
  const peakNote = html('span', 'note');
  head.append(key(server.id), server.name, peakNote);
  const node = html('div', 'echart');
  node.tabIndex = 0;
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', `Average operatives by hour of day on ${server.name}. Use the left and right arrow keys to read values.`);
  root.append(head, node);
  $('hours-charts').append(root);
  const made = { peakNote, chart: chartIn(node) };
  arrowKeys(node, () => 24, (hour) => showTipAt(made.chart, hour));
  hourBoxes.set(server.id, made);
  return made;
}

function renderHours() {
  const perServer = stats.servers.map((server) => localAverages(server.allTime.hoursUtc));
  const covered = Math.max(...perServer.map((slots) => slots.filter((slot) => slot.average !== null).length));
  $('hours-note').textContent = covered < 24 ? `${24 - covered} of 24 hours have no data yet. They fill in over the first day.` : '';
  const every = $('hours-charts').clientWidth < 480 ? 6 : 3;
  stats.servers.forEach((server, s) => {
    const { chart, peakNote } = hourBox(server);
    const slots = perServer[s];
    const top = Math.max(...slots.map((slot) => slot.average ?? 0)) || 1;
    const step = niceStep(top / 3, true);
    chart.setOption({
      animationDuration: stillPage ? 0 : 600,
      grid: { left: 40, right: 12, top: 8, bottom: 24 },
      tooltip: {
        ...TIP,
        trigger: 'axis',
        axisPointer: BAND_POINTER,
        formatter: (params) => {
          const hour = params[0]?.dataIndex ?? 0;
          return serversTip(`${hourLabel(hour)} to ${hourLabel(hour + 1)}`, 'average', perServer.map((each) => each[hour].average), true);
        },
      },
      xAxis: {
        type: 'category',
        data: slots.map((_, hour) => hourLabel(hour)),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_TEXT, interval: (index) => index % every === 0 },
      },
      yAxis: { type: 'value', min: 0, max: Math.ceil(top / step - 1e-9) * step, interval: step, axisLabel: AXIS_TEXT, splitLine: SPLIT_LINE },
      series: [
        {
          type: 'bar',
          data: slots.map((slot) => slot.average && Math.round(slot.average * 100) / 100),
          barWidth: '70%',
          barMaxWidth: 24,
          // Every hour has a faint slot, so an hour with no data reads as empty, not as a hole.
          showBackground: true,
          backgroundStyle: { color: fade(INK.grid, 0.6), borderRadius: [4, 4, 0, 0] },
          itemStyle: { color: colorOf(server.id), borderRadius: [4, 4, 0, 0] },
        },
      ],
    });
    const best = slots.reduce((bestHour, slot, hour) => (slot.average > (slots[bestHour]?.average ?? 0) ? hour : bestHour), -1);
    peakNote.textContent = best < 0 || covered < 24 ? '' : `busiest around ${hourLabel(best)}`;
  });

  const mostAnyHour = Math.max(1, ...perServer.flatMap((slots) => slots.map((slot) => slot.average ?? 0)));
  $('hours-head').replaceChildren(headCell('Hour'), ...stats.servers.map(serverHead));
  $('hours-rows').replaceChildren(
    ...Array.from({ length: 24 }, (_, hour) =>
      serverRow(`${hourLabel(hour)} to ${hourLabel(hour + 1)}`, perServer.map((slots) => slots[hour].average), mostAnyHour),
    ),
  );
}

function renderOutages() {
  const all = stats.servers
    .flatMap((server) => server.allTime.outages.map((outage) => ({ ...outage, server })))
    .sort((a, b) => b.from - a.from)
    .slice(0, 12);
  if (!all.length) {
    const since = stats.since ? `None since ${monthDayFmt.format(stats.since)}.` : 'No data yet.';
    $('outages').replaceChildren(html('li', 'note', since));
    return;
  }
  $('outages').replaceChildren(
    ...all.map((outage) => {
      const item = html('li');
      const what = html('span', 'state');
      const offline = outage.kind === 'offline';
      const why = outage.detail ? ` (${outage.detail})` : '';
      what.append(stateIcon(offline ? 'critical' : 'unknown'), `${outage.server.name}: ${offline ? 'server down' : 'no answer'}${why}`);
      const length = `${outage.ongoing ? 'still going after' : 'lasted'} ${duration(outage.to - outage.from)}`;
      item.append(what, html('span', 'note', `${dayTimeFmt.format(outage.from)}, ${length}`));
      return item;
    }),
  );
}

function renderAbout() {
  // One column per server, so the differences read across.
  const described = stats.servers.filter((server) => server.about?.glance);
  $('glance-card').hidden = !described.length;
  $('glance-head').replaceChildren(
    headCell(''),
    ...described.map((server) => {
      const th = headCell('');
      th.append(key(server.id), ` ${server.name}`);
      return th;
    }),
  );
  const discordSize = (server) => {
    const c = server.community;
    if (!c || c.members === undefined) return '–';
    return `${c.members.toLocaleString()}${c.shared ? ' (shared)' : ''}`;
  };
  const rows = [['World', 'world'], ['Since', 'since'], ['Who can jack in', 'access'], ['Fighting', 'combat'], ['Fighting other operatives', 'pvp'], ['In short', 'focus'], ['Discord members', discordSize]];
  $('glance-rows').replaceChildren(
    ...rows.map(([label, field]) => {
      const row = html('tr');
      const th = html('th', '', label);
      th.scope = 'row';
      row.append(th, ...described.map((server) => html('td', '', typeof field === 'function' ? field(server) : server.about.glance[field])));
      return row;
    }),
  );

  $('about').replaceChildren(
    ...stats.servers
      .filter((server) => server.about)
      .map((server) => {
        const about = server.about;
        const card = html('div', 'card');
        card.style.setProperty('--c', colorOf(server.id));

        // The same header as the cards at the top: portrait, then status, name and world.
        const head = html('div', 'server-head');
        const status = statusOf(server.now);
        const badge = html('span', 'status');
        badge.append(html('span', `led ${status.led}`), status.counted ? `${status.text} · ${server.now.players}` : status.text);
        const titles = html('div', 'server-titles');
        titles.append(badge, html('h3', '', server.name));
        if (about.glance?.world) titles.append(html('div', 'world', `World ${about.glance.world}`));
        head.dataset.server = server.id;
        head.append(titles);

        const chips = html('div', 'chips');
        for (const [label, field] of [['Join', 'access'], ['PvP', 'pvp'], ['Since', 'since']]) {
          if (!about.glance?.[field]) continue;
          const chip = html('span', 'chip');
          chip.append(html('span', 'chip-label', label), about.glance[field]);
          chips.append(chip);
        }

        const list = html('dl');
        for (const fact of about.facts) list.append(html('dt', '', fact.label), html('dd', '', fact.value));
        if (about.timeline) {
          const steps = html('ul', 'timeline');
          for (const [when, what] of about.timeline) {
            const step = html('li');
            step.append(html('span', 'when', when), html('span', '', what));
            steps.append(step);
          }
          const holder = html('dd');
          holder.append(steps);
          list.append(html('dt', '', 'Timeline'), holder);
        }
        const c = server.community;
        if (c) {
          const holder = html('dd', 'community');
          if (c.members !== undefined) {
            for (const [value, label] of [[c.members, 'members'], [c.online ?? 0, 'online now']]) {
              const stat = html('span');
              stat.append(html('strong', '', value.toLocaleString()), ` ${label}`);
              holder.append(stat);
            }
          }
          holder.append(html('span', 'note', c.shared ? `the shared fan Discord${c.name ? `, "${c.name}"` : ''}` : `its own Discord, opened ${monthYearFmt.format(new Date(c.opened))}`));
          list.append(html('dt', '', 'Community'), holder);
        }
        const links = html('div', 'links');
        links.append(...about.links.map((item) => link(item.label, item.url)));
        card.append(head, chips, html('div', 'prose', about.summary), list, links);
        return card;
      }),
  );
}

function renderFooter() {
  const sources = html('p', '', `numbers come from each server's own status page, checked every ${stats.sampleSeconds === 60 ? 'minute' : `${stats.sampleSeconds} seconds`}`);
  const rule = html('p', '', 'a server is called down only after 15 minutes without a live answer');
  const legal = html('p', '', 'fan page, not run by the server teams or the owners of The Matrix Online');
  $('footer').replaceChildren(sources, rule, legal);
  // A few facts about this page itself: how long it has been recording, and who came by.
  const facts = [];
  if (stats.since) facts.push(`recording since ${fullDateFmt.format(stats.since)}`);
  const page = stats.page;
  // Shown once there is something to show: a handful of visits says little.
  if (page?.visits30 >= 100) {
    const visits = [`${page.visits30.toLocaleString()} ${page.visits30 === 1 ? 'visit' : 'visits'} in 30 days`];
    if (page.countries30) visits.push(`${page.countries30} ${page.countries30 === 1 ? 'country' : 'countries'}`);
    if (page.phoneShare30 != null) visits.push(`${page.phoneShare30}% on phones`);
    visits.push('counted without cookies');
    facts.push(visits.join(' · '));
  }
  $('page-facts').replaceChildren(...facts.map((fact) => html('p', '', fact)));
  $('page-facts').hidden = !facts.length;
}

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
    stats = saved;
    loadedAt = saved.now;
    range = saved.history.range;
    renderAll();
  } catch (err) {
    stats = null;
    loadedAt = null;
  }
}

async function load({ dim = false } = {}) {
  const scoped = document.querySelectorAll('.scoped');
  if (dim) scoped.forEach((node) => node.classList.add('stale'));
  try {
    const res = await fetch(`/api/stats?range=${range}&tz=${TZ_HOURS}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const fresh = await res.json();
    stats = fresh;
    loadedAt = Date.now();
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
  range = next;
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

/**
 * Falling code behind the header: mirrored katakana and digits, as in the films, drawn as real text so it
 * stays sharp on any screen. A device with no Japanese font gets the digits and signs only.
 */
function startRain() {
  const canvas = $('rain');
  const ctx = canvas.getContext('2d');
  const CELL = 16;
  const KANA = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜﾝ';
  const PLAIN = '0123456789Z:.=*+-<>|';
  const FONT = `bold ${CELL}px "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", Meiryo, "MS Gothic", "Noto Sans CJK JP", "Noto Sans JP", monospace`;
  let drops = [];
  let w = 0;
  let h = 0;

  /** True when this device can draw katakana. Without a font for it, every glyph comes out as the same box. */
  const hasKana = () => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const look = (text) => {
      probe.clearRect(0, 0, 24, 24);
      probe.font = FONT;
      probe.fillText(text, 2, 18);
      return probe.getImageData(0, 0, 24, 24).data.join('');
    };
    return look('ﾊ') !== look('ﾘ') && look('ﾊ') !== look('\uffff');
  };

  const GLYPHS = hasKana() ? KANA + PLAIN : PLAIN;

  const resize = () => {
    const scale = Math.min(3, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * scale;
    canvas.height = h * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drops = Array.from({ length: Math.ceil(w / CELL) }, () => ({ row: Math.random() * -30 }));
  };
  /** One glyph, flipped left to right inside its cell. */
  const glyph = (column, row, color) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.translate((column + 1) * CELL, 0);
    ctx.scale(-1, 1);
    ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], CELL / 2, (row + 1) * CELL - 3);
    ctx.restore();
  };
  const step = () => {
    ctx.fillStyle = fade(INK.page, 0.09);
    ctx.fillRect(0, 0, w, h);
    ctx.font = FONT;
    ctx.textAlign = 'center';
    drops.forEach((drop, i) => {
      const row = Math.floor(drop.row);
      if (row >= 0) {
        // The glyph behind the newest one settles to green. The newest is nearly white.
        if (row > 0) {
          ctx.fillStyle = INK.page;
          ctx.fillRect(i * CELL, (row - 1) * CELL, CELL, CELL);
          glyph(i, row - 1, token('--rain'));
        }
        glyph(i, row, token('--rain-head'));
      }
      drop.row += 1;
      if (drop.row * CELL > h && Math.random() > 0.96) drop.row = 0;
    });
  };
  const run = () => {
    resize();
    window.addEventListener('resize', resize);
    // With reduced motion, draw one still frame and stop.
    if (stillPage) {
      for (let i = 0; i < 40; i++) step();
      return;
    }
    let timer = setInterval(step, 75);
    document.addEventListener('visibilitychange', () => {
      clearInterval(timer);
      if (!document.hidden) timer = setInterval(step, 75);
    });
  };

  run();
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
  const show = (theme) => {
    root.dataset.theme = theme;
    button.textContent = theme === 'light' ? 'Dark mode' : 'Light mode';
    paint();
    // The falling code starts over on the new background.
    const rain = $('rain');
    rain.getContext('2d').clearRect(0, 0, rain.width, rain.height);
    if (stats) renderAll();
  };
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
  stats = boot;
  loadedAt = boot.now;
  renderAll();
} else if (!linked) showSaved();
selectRange(range, { dim: !boot?.servers });
