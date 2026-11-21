// The top of the page: one card per server, the ranking and the summary table.
import { favourite, inViewOrder, RANGE_LABEL, serversInView, setFavourite, stats } from './state.js';
import { ago, dayTimeFmt, downtime, percent, players, timeFmt, whole } from './format.js';
import { $, el, html, link } from './dom.js';
import { cell, colorOf, key, rowHead, uptimeCell } from './look.js';
// What a server's latest answer means is decided in one place, shared with the server.
import { statusOf } from '../../lib/status.js';

export { statusOf };


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
  });
  if (open) area += 'V42Z';
  if (area) el('path', { d: area, fill: colorOf(server.id), 'fill-opacity': 0.12 }, svg);
  if (line) el('path', { d: line, fill: 'none', stroke: colorOf(server.id), 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }, svg);
  return svg;
}

// The server just starred, so only its new star plays the little animation, once.
let justStarred = null;

/** The star that marks a server as the visitor's favourite. Only one at a time, and a second click clears it. */
export function starButton(server) {
  const on = server.id === favourite;
  const star = html('button', on && server.id === justStarred ? 'star pop' : 'star');
  star.type = 'button';
  star.setAttribute('aria-pressed', String(on));
  // In a table row the star has no card around it to give it the server's color.
  star.dataset.server = server.id;
  star.style.setProperty('--c', colorOf(server.id));
  star.title = on ? 'Your favourite server' : 'Make this your favourite server';
  star.setAttribute('aria-label', `${server.name}: ${star.title.toLowerCase()}`);
  const icon = el('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, star);
  el('path', { d: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z' }, icon);
  star.addEventListener('click', () => {
    // The page is redrawn, so keyboard focus is put back on the same star, or it would fall to the top of the page.
    const where = star.closest('[id]')?.id;
    setFavourite(on ? null : server.id);
    justStarred = on ? null : server.id;
    document.dispatchEvent(new Event('mxo:favourite'));
    justStarred = null;
    document.querySelector(`#${where} .star[data-server="${CSS.escape(server.id)}"]`)?.focus({ preventScroll: true });
  });
  return star;
}

/** The line under a server's count. */
function unitOf(known, players, live) {
  if (!known) return 'no signal yet';
  if (!live) return 'last known count';
  return `${players === 1 ? 'operative' : 'operatives'} jacked in`;
}

const agoOrBlank = (t) => (t ? ago(t) : '');

export function serverCard(server, column) {
  const card = html('div', 'card server');
  card.style.setProperty('--c', colorOf(server.id));
  const now = server.now;
  const status = statusOf(now);

  const head = html('div', 'server-head');
  const badge = html('span', 'status');
  badge.append(html('span', `led ${status.led}`), status.text);
  head.dataset.server = server.id;
  const titles = html('div', 'server-titles');
  titles.append(badge, link(server.name, server.site));
  if (server.about?.glance?.world) titles.append(html('div', 'world', `World ${server.about.glance.world}`));
  head.append(titles, starButton(server));

  const body = html('div', 'server-body');
  const count = html('div');
  const known = now && now.players !== undefined;
  count.append(html('div', 'tile-value', known ? String(now.players) : '–'));
  const live = status.led === 'good' || status.led === 'critical';
  count.append(html('div', 'unit', unitOf(known, now?.players, live)));
  body.append(count);
  if (stats.storage && stats.history.points.length > 1) body.append(sparkline(server, column));

  const lines = [statusNote(server, now, known)].filter(Boolean);
  card.append(head, body, peaksOf(server), ...lines.map((line) => html('div', 'note', line)));
  return card;
}

/** The note under a card: a doubtful answer, a feed that stopped answering, or the latest details. */
function statusNote(server, now, known) {
  if (now?.unsure) {
    const since = now.unsureSince ? ` since ${timeFmt.format(now.unsureSince)}` : '';
    const detail = now.unsureDetail ? ` ("${now.unsureDetail}")` : '';
    return `Odd answer${since}${detail}. Showing the last count while it is checked.`;
  }
  if (!known) return null;
  if (!now.ok) return `No answer since ${timeFmt.format(now.failedAt)}`;
  // The world is already under the name.
  const parts = (now.details ?? []).filter((detail) => detail.label !== 'World' || !server.about?.glance?.world).map((detail) => `${detail.label}: ${detail.value}`);
  parts.push(`checked ${timeFmt.format(now.checkedAt ? new Date(now.checkedAt) : now.at)}`);
  return parts.join(' · ');
}

/** The 24-hour and all-time peaks, where known. */
function peaksOf(server) {
  const peaks = html('div', 'peaks');
  const recordAt = server.allTime?.recordAt;
  const when = recordAt ? `, ${ago(recordAt)}` : '';
  const known = [[server.allTime?.peak24, '24-hour peak'], [server.allTime?.recordPeak, `all-time peak${when}`]].filter(([value]) => value != null);
  peaks.append(
    ...known.map(([value, label]) => {
      const item = html('span');
      item.append(html('strong', '', String(value)), ` ${label}`);
      return item;
    }),
  );
  return peaks;
}

export function renderNow() {
  const counted = serversInView().filter((server) => statusOf(server.now).counted);
  const silent = stats.servers.filter((server) => statusOf(server.now).text === 'NO SIGNAL').length;
  const total = counted.reduce((sum, server) => sum + server.now.players, 0);
  $('total-now').textContent = counted.length || !silent ? total : '–';
  $('total-note').textContent =
    `${counted.length} of ${stats.servers.length} servers online${silent ? `, ${silent} with no signal` : ''}`;
  // The peaks count all servers together. A count that is higher right now is already the new peak.
  const peaks = stats.total ?? {};
  const beaten = counted.length && total > (peaks.recordPeak ?? -1);
  const liveTotal = counted.length ? total : null;
  const withLive = (peak) => (peak == null && liveTotal === null ? '–' : Math.max(peak ?? 0, liveTotal ?? 0));
  $('total-peak24').textContent = withLive(peaks.peak24);
  $('total-record').textContent = withLive(peaks.recordPeak);
  $('total-record-when').textContent = beaten ? 'right now' : agoOrBlank(peaks.recordAt);

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
    ...serversInView().map((server) => {
      const item = html('span');
      const isCounted = counted.includes(server);
      item.append(key(server.id), server.name, html('strong', '', isCounted ? String(server.now.players) : '–'));
      if (isCounted && total) item.append(html('span', 'note', percent(server.now.players / total)));
      return item;
    }),
  );
  $('server-cards').replaceChildren(...inViewOrder().map(([server, i]) => serverCard(server, i)));
}

/** A ranked list, best first. Equal values share a place. `full` is the value that fills the whole bar. */
export function rankList(target, entries, format, full) {
  const known = entries
    .filter((entry) => entry.value !== null)
    .toSorted((a, b) => b.value - a.value || a.server.name.localeCompare(b.server.name));
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
    ...serversInView().map((server) => {
      const s = server.summary;
      const row = html('tr');
      const head = rowHead(server);
      head.append(starButton(server));
      if (!s.answered) row.append(head, cell('–'), cell('–'), cell('–', 'No data yet'));
      else row.append(head, cell(String(s.peak), dayTimeFmt.format(s.peakAt)), cell(whole(s.average)), uptimeCell(s.availability, downtime(s.answered, s.onlineChecks)));
      return row;
    }),
  );
}
