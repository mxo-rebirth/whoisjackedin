// The main chart: operatives jacked in over the chosen range, with its legend, zoom and table view.
import { hiddenServers, inViewOrder, RANGE_LABEL, serversInView, stats } from './state.js';
import { amount, DAY, dayLabel, dayTimeFmt, MINUTE, monthDayFmt, niceStep, timeFmt } from './format.js';
import { $, headCell, html } from './dom.js';
import { pref, setPref } from './prefs.js';
import { arrowKeys, AXIS_LINE, AXIS_TEXT, chartIn, charts, colorOf, fade, INK, key, mix, MONO, serverHead, serverRow, serversTip, showTipAt, SPLIT_LINE, stillPage, TIP, tipBox } from './look.js';
import { statusOf } from './cards.js';

export let zoom = { start: 0, end: 100 }; // the part of the loaded period on show, in percent

export let stacked = false;

export const legendValues = new Map(); // server id -> the number shown next to its name

/** The legend is both a switch (click to hide or show a server) and the readout for the chart. */
export function renderLegend() {
  legendValues.clear();
  $('players-legend').replaceChildren(
    ...serversInView().map((server) => {
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

export const PLAYERS_GRID = { left: 40, right: 16, top: 14, bottom: 84 };
// Pixels kept above a peak's dot for its number.
const PEAK_LABEL_PX = 18;

export const sliderLook = () => ({
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
export const STEP_WIDTHS = [2, 4, 6, 10, 20, 30, 60, 120, 180, 360, 1440, 2 * 1440, 7 * 1440, 14 * 1440, 28 * 1440].map((minutes) => minutes * MINUTE);

export let shownRange = null; // the range the chart was last drawn for

export let settle = null; // timer: the chart is redrawn once zooming stops

export let steps = []; // what the chart is drawing, see joinSteps

export let stepMs = 0;

export const isZoomed = () => zoom.start > 0.01 || zoom.end < 99.99;

/** The stretch of time the chart covers: the loaded range, starting where the data starts. */
export function chartSpan() {
  const { from, to, points } = stats.history;
  return { from: points.length ? Math.max(from, points[0][0]) : from, to };
}

/** The period the chart is zoomed to. */
export function shownWindow() {
  const { from, to } = chartSpan();
  return { from: from + ((to - from) * zoom.start) / 100, to: from + ((to - from) * zoom.end) / 100 };
}

/**
 * Joins the saved steps so the chart draws about ninety points at most. Zooming in brings the detail back.
 * Each step is { start, end, mean, peak }, with one entry per server, null where nothing is known.
 */
export function joinSteps() {
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
  joined.forEach((step) => {
    step.mean = step.sum.map((sum, i) => (step.count[i] ? sum / step.count[i] : null));
  });
  return { joined, width };
}

export function resetZoom() {
  charts.get($('players-chart'))?.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 });
}

/** A length of time in words, for "averaged over ...". */
export function lengthWords(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes < 1440) return minutes === 60 ? 'an hour' : `${amount(minutes / 60)} hours`;
  return minutes === 1440 ? 'a day' : `${amount(minutes / 1440)} days`;
}

/** The line above the chart: which period is on show, and how fine the steps are. */
export function renderPlayersHead() {
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

export function timeLabel(value) {
  const date = new Date(value);
  if (date.getHours() || date.getMinutes()) return timeFmt.format(date);
  const view = shownWindow();
  return view.to - view.from > 14 * DAY ? monthDayFmt.format(date) : dayLabel(date);
}

/** The numbers beside the names in the legend: the count on each server right now. */
export function renderReadout() {
  const values = stats.servers.map((server) => (statusOf(server.now).counted ? server.now.players : null));
  stats.servers.forEach((server, i) => legendValues.get(server.id)?.replaceChildren(values[i] === null ? '–' : String(values[i])));
  const counted = values.filter((value, i) => value !== null && !hiddenServers.has(stats.servers[i].id));
  const sum = counted.reduce((total, value) => total + value, 0);
  const known = counted.length;
  $('players-readout').textContent = `right now: ${known ? `${sum} together` : 'no data'}`;
}

export function playersTip(t) {
  const step = steps.find((item) => t >= item.start && t < item.end);
  if (!step) return tipBox(dayTimeFmt.format(t), 'not recorded', []);
  const down = serversInView().filter((server) => !hiddenServers.has(server.id) && server.allTime.outages.some((o) => o.from < step.end && o.to > step.start));
  // A server with an outage at this moment gets a line of its own: "MxO Revived down".
  return serversTip(
    `${dayTimeFmt.format(step.start)} to ${timeFmt.format(step.end)}`,
    'average',
    stats.servers.map((server, i) => (hiddenServers.has(server.id) ? undefined : step.mean[i])),
    { together: true, notes: down.map((server) => `${server.name} down`), peaks: step.peak },
  );
}

/** Zoom by dragging across the chart. Touch is left alone so the page can still scroll. */
export function wirePlayers(chart, node) {
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

/** The legend, the readout, the table's head and the switches above the chart, in step with what is drawn. */
function syncControls() {
  renderLegend();
  renderReadout();
  renderPlayersHead();
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(stacked ? button.dataset.mode === 'stacked' : button.dataset.mode !== 'stacked'));
  });
  // The stacked view already shows the total as its top edge.
  $('together-switch-box').hidden = stacked;
  $('together-switch').setAttribute('aria-pressed', String(together));
}

/** The y scale for what is on show: its top, the tick values, how much one pixel is worth, and a small nudge
 * that keeps lines with the same value a couple of pixels apart. */
function scaleOf(chart, shown, view) {
  // The scale fits what is on show, so zooming in on a quiet period still fills the chart.
  const sumOf = (step) => shown.reduce((sum, i) => sum + (step.mean[i] ?? 0), 0);
  // The "together" line needs room too, which squeezes the servers' lines.
  const topOf = (step) => (stacked || together ? sumOf(step) : Math.max(0, ...shown.map((i) => step.mean[i] ?? 0)));
  const plotHeight = Math.max(60, chart.getHeight() - PLAYERS_GRID.top - PLAYERS_GRID.bottom);
  const highest = Math.max(4, ...steps.filter((step) => step.end > view.from && step.start < view.to).map(topOf));
  // The lines view keeps room above the highest line for a peak's number.
  const peak = stacked ? highest : highest / (1 - PEAK_LABEL_PX / plotHeight);
  const tick = niceStep(peak / 4, true);
  const yMax = Math.ceil(peak / tick) * tick;
  const ticks = Array.from({ length: Math.round(yMax / tick) + 1 }, (_, i) => i * tick);
  // A few pixels of room above and below, so a line on the edge is not cut.
  const pixel = yMax / (plotHeight - 10);
  // Lines that sit on the same value are nudged a couple of pixels apart so each stays visible.
  const nudge = (k) => (stacked ? 0 : (k - (shown.length - 1) / 2) * 2 * pixel);
  return { yMax, ticks, pixel, nudge };
}

/** Each shown server's line, one point per joined step, and the total of all of them. */
function tracksOf(shown, from, to, nudge) {
  // One point per joined step, in the middle of it.
  const tracks = shown.map(() => []);
  const totals = [[from, null]];
  steps.forEach((step) => {
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
  });
  totals.push([to, null]);
  return { tracks, totals };
}

/** Outages: bands in the stacked view, dotted stretches in the lines view. Reshapes `tracks` around them. */
function outageLines(servers, shown, tracks, { from, to, nudge }) {
  // A dotted stretch runs from the outage's exact start to its exact end: along zero when the server said it was
  // down, as a straight bridge when its feed gave no answer.
  const banded = shown.map((i) => (stacked ? servers[i].allTime.outages.filter((o) => o.to > from && o.from < to) : []));
  const dotted = shown.map((i, k) => {
    if (stacked) return [];
    const outages = servers[i].allTime.outages
      .filter((o) => o.to > from && o.from < to)
      .map((o) => ({ ...o, from: Math.max(o.from, from), to: Math.min(o.to, to) }))
      .toSorted((a, b) => a.from - b.from);
    if (!outages.length) return [];
    const known = tracks[k].filter(([, y]) => y !== null);
    const inside = (x) => outages.some((o) => x >= o.from && x <= o.to);
    const points = [];
    const solid = tracks[k].filter(([x]) => !inside(x));
    outages.forEach((o) => {
      const before = known.findLast(([x]) => x < o.from && !inside(x))?.[1] ?? null;
      const after = known.find(([x]) => x > o.to && !inside(x))?.[1] ?? null;
      const start = before ?? after ?? nudge(k);
      const end = after ?? (o.kind === 'offline' ? nudge(k) : start);
      // The solid line runs level to the edge, breaks, and starts again level at the other edge.
      solid.push([o.from, start], [(o.from + o.to) / 2, null]);
      if (after !== null) solid.push([o.to, after]);
      const ground = nudge(k);
      const path = o.kind === 'offline' ? [[o.from, start], [o.from, ground], [o.to, ground], [o.to, end]] : [[o.from, start], [o.to, end]];
      points.push(...path, [o.to + 1, null]);
    });
    tracks[k] = solid.toSorted((a, b) => a[0] - b[0]);
    return points;
  });
  return { banded, dotted };
}

/** The dots that mark where each line is now, when the view reaches the present. */
function liveDots(servers, shown, tracks) {
  const live = [];
  if (!stacked && zoom.end > 99.9) {
    shown.forEach((i, k) => {
      const last = tracks[k].at(-1);
      if (last && last[1] !== null) live.push({ value: last, itemStyle: { color: colorOf(servers[i].id) } });
    });
  }
  return live;
}

/**
 * Each shown server's highest moment in the part on show, where it had anyone on. A peak above the scale sits at
 * its top edge, marked as above. Servers that peak at the same moment with the same count share one number.
 */
function peaksOf(shown, view, { from, yMax, pixel, nudge }) {
  const xOf = (step) => (Math.max(step.start, from) + step.end) / 2;
  const inView = steps.filter((step) => xOf(step) >= view.from && xOf(step) <= view.to);
  const ceiling = yMax - PEAK_LABEL_PX * pixel;
  const marks = shown.map((i, k) => {
    const best = inView.reduce((top, step) => ((step.peak[i] ?? 0) > (top?.peak[i] ?? 0) ? step : top), null);
    if ((best?.peak[i] ?? 0) <= 0) return null;
    const value = best.peak[i];
    return { x: xOf(best), y: Math.min(value, ceiling) + nudge(k), value, above: value > yMax };
  });
  return marks.map((mark, k) => mark && { ...mark, labelled: !marks.slice(0, k).some((other) => other?.x === mark.x && other.value === mark.value) });
}

/** A dot with the number at a server's peak, since the line shows averages and would hide it. */
function peakMark(peak, color) {
  return {
    silent: true,
    animation: false,
    // Above the dots that mark where each line is now.
    zlevel: 1,
    z: 13,
    symbol: 'circle',
    symbolSize: 7,
    itemStyle: { color, borderColor: INK.surface, borderWidth: 1.5 },
    label: { show: Boolean(peak?.labelled), position: 'top', distance: 4, color: INK.text, fontFamily: MONO, fontSize: 11, formatter: () => (peak.above ? `↑${peak.value}` : String(peak.value)) },
    data: peak ? [{ coord: [peak.x, peak.y], value: peak.value }] : [],
  };
}

function seriesOf(servers, shown, { tracks, totals, banded, dotted, live, peaks, from, to }) {
  return [
    // Never drawn. It gives the strip under the chart its shape.
    { id: 'total', type: 'line', data: totals, symbol: 'none', silent: true, animation: false, lineStyle: { opacity: 0 }, tooltip: { show: false } },
    // All servers together: faint, behind the servers' own lines, and only when switched on.
    {
      id: 'together',
      type: 'line',
      data: !stacked && together ? totals : [],
      smooth: 0.4,
      smoothMonotone: 'x',
      showSymbol: false,
      silent: true,
      animation: false,
      z: 1,
      lineStyle: { width: 1.25, color: INK.muted, opacity: 0.35 },
      tooltip: { show: false },
    },
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
        // Paint order comes from the place in the list, not from the order the chart first saw the series in.
        z: stacked ? 10 - k : 3 + k,
        itemStyle: { color, borderColor: INK.surface, borderWidth: 2 },
        // Stacked layers: a bright line along each layer's top and a dim fill that fades towards the bottom,
        // so the shape reads from its edges instead of from blocks of solid color.
        lineStyle: { width: stacked ? 1.5 : 2, color },
        areaStyle: stacked
          ? { opacity: 1, color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: mix(color, INK.surface, 0.42) }, { offset: 1, color: mix(color, INK.surface, 0.14) }] } }
          : { opacity: 0 },
        emphasis: { lineStyle: { width: stacked ? 1.5 : 2 } },
        markPoint: peakMark(peaks[k], color),
        // Pointing at an outage, banded or dotted, adds a line like "MxO Revived down" to the hover box.
        markArea: {
          silent: true,
          animation: false,
          itemStyle: { color, opacity: 0.08 },
          label: { show: false },
          data: banded[k].map((o) => [{ xAxis: Math.max(o.from, from) }, { xAxis: Math.min(o.to, to) }]),
        },
      };
    }),
    ...shown.map((i, k) => ({
      id: `${servers[i].id}-down`,
      type: 'line',
      data: dotted[k],
      smooth: false,
      showSymbol: false,
      silent: true,
      animation: false,
      z: 3 + shown.length,
      lineStyle: { width: 2, type: [2, 4], cap: 'round', color: colorOf(servers[i].id) },
      tooltip: { show: false },
    })),
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
}

/** The table under "Show as table": one row per joined step, newest first. */
function renderPlayersTable() {
  $('players-empty').hidden = steps.length >= 2;
  const most = Math.max(1, ...steps.flatMap((step) => step.mean.map((value) => value ?? 0)));
  $('players-head').replaceChildren(headCell('Time'), ...serversInView().map(serverHead));
  $('players-rows').replaceChildren(
    ...steps
      .toReversed()
      .map((step) => serverRow(`${dayTimeFmt.format(step.start)} to ${timeFmt.format(step.end)}`, step.mean, most)),
  );
}

export function renderPlayers() {
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
  const shown = inViewOrder().map(([, i]) => i).filter((i) => !hiddenServers.has(servers[i].id));
  syncControls();

  const { yMax, ticks, pixel, nudge } = scaleOf(chart, shown, view);
  const { tracks, totals } = tracksOf(shown, from, to, nudge);
  const { banded, dotted } = outageLines(servers, shown, tracks, { from, to, nudge });
  const live = liveDots(servers, shown, tracks);
  const peaks = stacked ? shown.map(() => null) : peaksOf(shown, view, { from, yMax, pixel, nudge });
  const series = seriesOf(servers, shown, { tracks, totals, banded, dotted, live, peaks, from, to });

  const zoomBase = { filterMode: 'none', minValueSpan: 2 * bucketMs, ...(fresh ? { start: 0, end: 100 } : {}) };
  chart.setOption(
    {
      // Only the first draw comes in slowly. A server switched back on appears at once, like every other redraw.
      animationDuration: isNew && !stillPage ? 700 : 0,
      // A redraw often has a different number of points, and animating between them pairs the wrong ones,
      // so lines double up and stretch while zooming.
      animationDurationUpdate: 0,
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

  renderPlayersTable();
}

// On unless the visitor switched it off: the whole community first.
export let together = pref('together') !== 'off';
$('together-switch').addEventListener('click', () => {
  together = !together;
  setPref('together', together ? 'on' : 'off');
  renderPlayers();
});

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    stacked = button.dataset.mode === 'stacked';
    renderPlayers();
  });
});

$('zoom-reset').addEventListener('click', resetZoom);
