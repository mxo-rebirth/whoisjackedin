// The longer views: day by day, one server at a time, the weekly pattern, uptime, busiest hours, records,
// outages and short gaps.
import { favourite, stats, todayKey } from './state.js';
import { dateFmt, DAY, dayTimeFmt, downtime, duration, hourLabel, monthDayFmt, monthFmt, niceStep, percent, players, TZ_HOURS, weekdayFmt, whole } from './format.js';
import { $, headCell, html, stateIcon, tableRow } from './dom.js';
import { arrowKeys, AXIS_LINE, AXIS_TEXT, BAND_POINTER, cell, chartIn, charts, colorOf, fade, INK, key, mix, rowHead, serverHead, serverRow, serversTip, showTipAt, SPLIT_LINE, stillPage, TIP, uptimeCell } from './look.js';
import { statusOf } from './cards.js';

export let picked = null; // the server shown in the breakdown table and the weekly pattern

export let tableRows = 'day'; // the breakdown table lists days or months

export let sortBy = { column: 'period', down: true };

export let dailyCount = 0;

/** Grouped bars: the most operatives each server had at once, day by day. */

export function renderDaily() {
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

// The favourite is only where these views start: a server the visitor picked here is not replaced by a new star.
let pickedByHand = false;

/** Lets the views follow a new favourite, unless the visitor chose a server here. `picked` cannot be set from outside. */
export function followFavourite() {
  if (!pickedByHand) picked = null;
}

/** One switch for the two views that show a single server. */

export function renderPicker() {
  const known = (id) => stats.servers.some((server) => server.id === id);
  if (!known(picked)) picked = known(favourite) ? favourite : stats.servers[0].id;
  $('server-picker').replaceChildren(
    ...stats.servers.map((server) => {
      const button = html('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(server.id === picked));
      button.append(key(server.id), server.name);
      button.addEventListener('click', () => {
        picked = server.id;
        pickedByHand = true;
        renderPicker();
      });
      return button;
    }),
  );
  renderBreakdown();
  renderWeek();
}

export const BREAKDOWN = [
  ['period', ''],
  ['peak', 'Peak'],
  ['gain', 'Gain'],
  ['gainPct', '% gain'],
  ['average', 'Average'],
  ['avgPct', 'Avg % gain'],
  ['online', 'Uptime'],
];

/** Adds day entries ([dayStart, answered, online, peak, sum]) up into one period. Null when there is nothing to add. */

export function sumDays(days) {
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

export function compare(label, period, now, before) {
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

export function changeCell(value, digits, unit = '') {
  if (value === null) return html('td', 'note', '–');
  const shown = Number(value.toFixed(digits));
  return html('td', shown > 0 ? 'up' : shown < 0 ? 'down' : '', `${shown > 0 ? '+' : shown < 0 ? '−' : ''}${Math.abs(shown).toFixed(digits)}${unit}`);
}

/** Peak, average and change for the picked server, by day or by month. Click a heading to sort. */

export function renderBreakdown() {
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

export function renderWeek() {
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
  $('week-sub').textContent = `${server.name}, average operatives by weekday and hour`;
  $('week-note').textContent = filled < 168 ? `${filled} of 168 hours have data so far. It fills in over a week.` : '';
  $('week-key').style.setProperty('--c', color);
}

export function renderUptime() {
  const today = todayKey();
  $('uptime').replaceChildren(
    ...stats.servers.map((server) => {
      const byDay = new Map(server.allTime.days.map(([t, answered, online]) => [t, { answered, online }]));
      let answered = 0;
      let online = 0;
      // The share covers the days in the strip, so the label counts those, not every day loaded.
      let counted = 0;
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
          counted += 1;
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
      if (answered) total.append(html('strong', '', percent(online / answered)), html('span', 'note', ` over ${counted} ${counted === 1 ? 'day' : 'days'}`));
      else total.append(html('span', 'note', 'no data yet'));
      head.append(name, total);
      strip.setAttribute('role', 'img');
      strip.setAttribute('aria-label', answered ? `${server.name}: online ${percent(online / answered)} of the time over ${counted} ${counted === 1 ? 'day' : 'days'} of data` : `${server.name}: no data yet`);
      row.append(head, strip);
      return row;
    }),
  );
}

export function renderRecords() {
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

export function localAverages(hoursUtc) {
  const slots = Array.from({ length: 24 }, () => [0, 0]);
  hoursUtc.forEach(([sum, n], utcHour) => {
    const at = new Date();
    at.setUTCHours(utcHour, 0, 0, 0);
    slots[at.getHours()][0] += sum;
    slots[at.getHours()][1] += n;
  });
  return slots.map(([sum, n]) => ({ average: n ? sum / n : null, checks: n }));
}

export const hourBoxes = new Map();

/** One small chart per server, made the first time it is needed. */

export function hourBox(server) {
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

export function renderHours() {
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

export function renderOutages() {
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

// Short gaps are always recorded, but only listed when the page's address asks for them with ?gaps.
export const SHOW_GAPS = new URLSearchParams(location.search).has('gaps');

/** Short gaps: a few checks in a row without a clear answer. Too short to be an outage, but the count stood still. */

export function renderGaps() {
  const DAY = 86_400_000;
  $('gaps-block').hidden = !SHOW_GAPS;
  if (!SHOW_GAPS) return;
  const all = stats.servers.flatMap((server) => (server.allTime.gaps ?? []).map((gap) => ({ ...gap, server }))).sort((a, b) => b.from - a.from);
  if (!all.length) {
    $('gaps').replaceChildren(html('li', 'note', 'None recorded yet.'));
    return;
  }
  const said = (gap) => {
    if (gap.kind === 'limited') return 'asked too often, no answer';
    if (gap.kind === 'offline') return gap.detail ? `status said "${gap.detail}"` : 'status said not live';
    return gap.detail ? `no answer (${gap.detail})` : 'no answer';
  };
  // One line per server on how often it happened in the last day, then the latest ones.
  const counts = stats.servers
    .map((server) => ({ server, count: (server.allTime.gaps ?? []).filter((gap) => gap.from > stats.now - DAY).length }))
    .filter((entry) => entry.count)
    .map((entry) => {
      const item = html('li');
      const what = html('span', 'state');
      what.append(key(entry.server.id), ` ${entry.server.name}`);
      item.append(what, html('span', 'note', `${entry.count} short ${entry.count === 1 ? 'gap' : 'gaps'} in the last 24 hours`));
      return item;
    });
  const latest = all.slice(0, 10).map((gap) => {
    const item = html('li');
    const what = html('span', 'state');
    what.append(stateIcon('unknown'), `${gap.server.name}: ${said(gap)}`);
    const checks = `${gap.checks} ${gap.checks === 1 ? 'check' : 'checks'}`;
    item.append(what, html('span', 'note', `${dayTimeFmt.format(gap.from)}, ${gap.ongoing ? 'still going, ' : ''}${checks} in a row`));
    return item;
  });
  $('gaps').replaceChildren(...counts, ...latest);
}
