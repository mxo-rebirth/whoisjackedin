// The top of the page: one card per server, the ranking and the summary table.
import { RANGE_LABEL, stats } from './state.js';
import { ago, dayTimeFmt, downtime, percent, players, timeFmt, whole } from './format.js';
import { $, el, html, link } from './dom.js';
import { cell, colorOf, key, rowHead, uptimeCell } from './look.js';

/** What the status light and its label say for one server's latest answer. */

export function statusOf(now) {
  if (!now || now.players === undefined) return { led: 'unknown', text: 'NO SIGNAL', counted: false };
  if (now.unsure) return { led: 'unsure', text: 'TRACING', counted: now.online };
  if (!now.ok) return { led: 'unknown', text: 'NO SIGNAL', counted: false };
  return now.online ? { led: 'good', text: 'ONLINE', counted: true } : { led: 'critical', text: 'OFFLINE', counted: false };
}

/** A small line of one server's player count over the selected range. */

export function sparkline(server, column) {
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

export function serverCard(server, column) {
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

export function renderNow() {
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

export function rankList(target, entries, format, full) {
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

export function renderRanking() {
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

export function renderSummary() {
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
