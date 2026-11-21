// What the charts share: colors from the page's styles, axis and hover-box styles, and the chart
// library with only the parts the page uses.
import * as echarts from 'echarts/core';
import { BarChart, EffectScatterChart, HeatmapChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, MarkAreaComponent, TooltipComponent, VisualMapContinuousComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { inViewOrder, stats } from './state.js';
import { percent, whole } from './format.js';
import { headCell, html } from './dom.js';

echarts.use([BarChart, EffectScatterChart, HeatmapChart, LineChart, DataZoomComponent, GridComponent, MarkAreaComponent, TooltipComponent, VisualMapContinuousComponent, CanvasRenderer]);

// The charts are drawn on a canvas, which cannot read CSS variables. The page's colors are read into
// these objects, and read again whenever the theme changes (see paint()).
export const rootStyle = getComputedStyle(document.documentElement);

export const token = (name) => rootStyle.getPropertyValue(name).trim();

// Color follows the server, whatever order the list comes in.
export const SERIES = {};

/** A server's color: its tone, read from the theme once and kept until the theme changes. */
export const colorOf = (id) => {
  const tone = stats?.servers.find((server) => server.id === id)?.tone ?? '--muted';
  SERIES[tone] ??= token(tone);
  return SERIES[tone];
};

export function key(id) {
  const node = html('span', 'key');
  node.style.background = colorOf(id);
  return node;
}

export const INK = {};

export const MONO = token('--mono');

export const stillPage = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const channels = (hex) => [0, 1, 2].map((i) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16));

/** A see-through version of a hex color. */
export const fade = (hex, alpha) => `rgba(${channels(hex).join(', ')}, ${alpha})`;

/** A solid color between two hex colors. A share of 1 is all of the first. */
export const mix = (hex, other, share) => {
  const b = channels(other);
  return `rgb(${channels(hex)
    .map((a, i) => Math.round(a * share + b[i] * (1 - share)))
    .join(', ')})`;
};

export const AXIS_TEXT = { fontFamily: MONO, fontSize: 11 };

export const AXIS_LINE = { lineStyle: {} };

export const SPLIT_LINE = { lineStyle: {} };

export const TIP = {
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

export const BAND_POINTER = { type: 'shadow', shadowStyle: {} };

/** Reads the current theme's colors into the objects the charts use. */
export function paint() {
  Object.keys(SERIES).forEach((tone) => delete SERIES[tone]);
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

export const charts = new Map();

export function chartIn(node) {
  let chart = charts.get(node);
  if (!chart) {
    chart = echarts.init(node);
    charts.set(node, chart);
  }
  return chart;
}

/** The box shown on hover: when it was, what the numbers are, then one line per row as { id, name, value }. */
export function tipBox(when, what, rows, notes = []) {
  const box = html('div');
  box.append(html('div', 'tip-when', when), html('div', 'tip-what', what));
  box.append(
    ...notes.map((note) => html('div', 'tip-note', note)),
    ...rows.map((row) => {
      const line = html('div', row.sum ? 'tip-row sum' : 'tip-row');
      line.append(row.id ? key(row.id) : html('span'), html('span', 'name', row.name ?? ''), html('strong', '', row.value));
      return line;
    }),
  );
  return box;
}

/**
 * The hover box every chart uses. `values` has one entry per server: a number, null for no data, or
 * undefined to leave the server out. `together` adds a sum row, which only suits averages: peaks
 * happen at different moments, so they cannot be added up.
 */
export function serversTip(when, what, values, together, notes) {
  let sum = 0;
  let exact = 0;
  let known = 0;
  const rows = [];
  inViewOrder()
    .filter(([, i]) => values[i] !== undefined)
    .forEach(([server, i]) => {
      if (values[i] !== null) {
        // The whole numbers shown are added up, so the rows always add up to the "together" row.
        sum += Math.round(values[i]);
        exact += values[i];
        known += 1;
      }
      rows.push({ id: server.id, name: server.name, value: values[i] === null ? '–' : whole(values[i]) });
    });
  if (together && known && rows.length > 1) rows.push({ name: 'together', value: sum === 0 && exact > 0 ? '<1' : String(sum), sum: true });
  return tipBox(when, what, rows, notes);
}

/** Shows a chart's hover box at one of its x values, as if the pointer were there. */
export function showTipAt(chart, value) {
  chart.dispatchAction({ type: 'showTip', x: chart.convertToPixel({ xAxisIndex: 0 }, value), y: chart.getHeight() / 3 });
}

/** Left and right arrow keys step through a chart's values, for readers without a mouse. */
export function arrowKeys(node, count, show) {
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

/** How a share of time online reads, like a status light. */
export function uptimeLevel(share) {
  if (share >= 0.995) return { tone: 'good', words: 'operational' };
  if (share >= 0.95) return { tone: 'warning', words: 'partial outage' };
  return { tone: 'critical', words: 'major outage' };
}

/** Uptime as a share of 1, colored like a status light. */
export function uptimeMark(share) {
  return html('span', `uptime ${uptimeLevel(share).tone}`, percent(share));
}

export function rowHead(server) {
  const th = html('th');
  th.scope = 'row';
  th.append(key(server.id), server.name);
  return th;
}

export function cell(value, note) {
  const td = html('td', '', value);
  if (note) td.append(html('div', 'note', note));
  return td;
}

export function uptimeCell(share, note) {
  const td = html('td');
  td.append(uptimeMark(share));
  if (note) td.append(html('div', 'note', note));
  return td;
}

/** A column heading for one server: its color mark and its name. */
export function serverHead(server) {
  const th = headCell('');
  th.append(key(server.id), ` ${server.name}`);
  return th;
}

/**
 * A table row with one number per server. Each number sits on a bar in that server's color,
 * as long as the number is big compared with `most`.
 */
export function serverRow(label, values, most) {
  const row = html('tr');
  row.append(html('td', '', label));
  row.append(
    ...inViewOrder().map(([server, i]) => {
      const value = values[i];
      const td = html('td', value === null ? 'note' : 'bar', value === null ? 'No data' : whole(value));
      if (value !== null) {
        td.style.setProperty('--c', colorOf(server.id));
        td.style.setProperty('--fill', `${Math.round((value / most) * 100)}%`);
      }
      return td;
    }),
  );
  return row;
}

export { echarts };
