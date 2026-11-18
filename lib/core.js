// Takes samples of the servers, saves them, and turns the saved samples into the page's numbers.
import { SERVERS, readAll, readCommunities } from './sources.js';
import { lock, mget, mgetRecent, storeKind, write } from './store.js';
import { visitSummary } from './visits.js';

export const SAMPLE_MS = 60_000;
// The feeds are never read more often than this, whoever asks. The outside sampler comes once a minute
// but drifts by a few seconds; a longer gap here skipped the runs that came a little early.
const MIN_GAP_MS = 30_000;
const STALE_MS = 90_000; // a page view takes a sample itself when the last one is older
const SILENCE_MS = 3 * SAMPLE_MS; // longer than this without samples means "not recording", not an outage
const CONFIRM_CHECKS = 15; // bad answers in a row before a server counts as down: about 15 minutes
const CARRY_MS = 15 * 60_000; // how long the last real reading may stand in for a missing or doubtful one
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RAW_KEEP_DAYS = 9;
const ALL_TIME_DAYS = 90;
const COMMUNITY_MS = HOUR_MS; // how often the Discord sizes are refreshed
const COMMUNITY_RETRY_MS = 5 * 60_000; // how often, while a server has no size yet

export const STATE_KEY = 'mxo:state';
const LOCK_KEY = 'mxo:lock';
const LOCK_SECONDS = 25; // shorter than MIN_GAP_MS, so it never blocks the next sample
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
export const rawKey = (day) => `mxo:raw:${day}`;
export const hoursKey = (day) => `mxo:hours:${day}`;

export const RANGES = {
  '1h': { spanMs: HOUR_MS, bucketMs: 120_000 },
  '24h': { spanMs: DAY_MS, bucketMs: 300_000 },
  '7d': { spanMs: 7 * DAY_MS, bucketMs: 1_800_000 },
  '30d': { spanMs: 30 * DAY_MS, bucketMs: HOUR_MS },
  all: { spanMs: 365 * DAY_MS, bucketMs: HOUR_MS },
};

/**
 * Saved under STATE_KEY. `hours` holds the hourly totals of `today` (UTC) as
 * { code: { hour: [playerSum, answered, online, peak] } }; finished days move to their own key.
 */
export function newState() {
  return { v: 2, since: null, checks: 0, lastT: null, today: null, hours: {}, latest: {}, all: {}, total: null };
}

/** All servers together in one sample. Null when no server gave a number. */
const totalOf = (values) => (values.some(Boolean) ? values.reduce((sum, value) => sum + (value ? value.players : 0), 0) : null);

/** The most operatives seen at once on all servers together, and when. */
function totalPeak(samples) {
  const best = { recordPeak: null, recordAt: null };
  for (const { t, values } of samples) {
    const total = totalOf(values);
    if (total !== null && (best.recordPeak === null || total > best.recordPeak)) Object.assign(best, { recordPeak: total, recordAt: t });
  }
  return best;
}

/** A run is a streak of bad answers. Older saved runs have a single `kind` and no `offline` count. */
const offlineCount = (run) => run.offline ?? (run.kind === 'offline' ? run.checks : 0);
const kindOf = (run) => (offlineCount(run) * 2 >= run.checks ? 'offline' : 'unknown');

const GAPS_KEPT = 40;

/** Remembers a short gap: a few checks in a row without a clear answer. The newest comes first. */
function noteGap(all, gap) {
  const gaps = (all.gaps ??= []);
  const last = gaps[0];
  // "Asked too often" answers that follow each other closely are one gap.
  if (gap.kind === 'limited' && last?.kind === 'limited' && gap.from - last.to <= 2 * SAMPLE_MS) {
    last.to = gap.to;
    last.checks += gap.checks;
    return;
  }
  gaps.unshift(gap);
  gaps.length = Math.min(gaps.length, GAPS_KEPT);
}

function closeRun(all, to) {
  const run = all.run;
  all.run = null;
  // A short streak of bad answers is a gap, not an outage. It is still worth showing: the count stood
  // still during it, so a peak in that moment was missed.
  if (run.checks < CONFIRM_CHECKS) {
    noteGap(all, { kind: kindOf(run), from: run.from, to, checks: run.checks, detail: run.detail ?? null });
    return;
  }
  all.outages.unshift({ kind: kindOf(run), from: run.from, to, checks: run.checks, detail: run.detail ?? null });
  all.outages.length = Math.min(all.outages.length, 20);
}

/** Folds one round of answers into the state. Returns the line to save and any day that just ended. */
export function applySample(state, now, results) {
  const today = dayOf(now);
  const finished = state.today && state.today !== today ? { day: state.today, hours: state.hours } : null;
  if (state.today !== today) {
    state.today = today;
    state.hours = {};
  }
  const silence = state.lastT !== null && now - state.lastT > SILENCE_MS;
  const hour = new Date(now).getUTCHours();
  const parts = [Math.round(now / 1000)];
  let total = null; // all servers together in this sample

  SERVERS.forEach((server, i) => {
    const r = results[i];
    const all = (state.all[server.id] ??= { recordPeak: null, recordAt: null, lastPlayersAt: null, run: null, outages: [] });
    const last = state.latest[server.id];
    /** Adds one counted reading to this hour's totals and to the saved line. */
    const save = (online, players) => {
      const slot = ((state.hours[server.code] ??= {})[hour] ??= [0, 0, 0, 0]);
      slot[0] += players;
      slot[1] += 1;
      slot[2] += online ? 1 : 0;
      slot[3] = Math.max(slot[3], players);
      total = (total ?? 0) + players;
      parts.push(`${server.code}${online ? 1 : 0}:${players}`);
    };
    /** With no usable answer, the last real reading stands in while it is still recent. True when it did. */
    const carry = () => {
      const recent = Boolean(last?.ok && last.players !== undefined && now - last.at <= CARRY_MS);
      if (recent) save(last.online, last.players);
      else parts.push(`${server.code}-`);
      return recent;
    };
    // "Asked too often" says nothing about the server: keep everything as it is. It is noted as a gap.
    if (r.limited) {
      noteGap(all, { kind: 'limited', from: now, to: now + SAMPLE_MS, checks: 1, detail: 'asked too often' });
      carry();
      return;
    }
    const kind = !r.ok ? 'unknown' : r.online ? null : 'offline';
    if (all.run && (silence || !kind)) closeRun(all, silence ? all.run.last + SAMPLE_MS : now);
    if (kind) {
      const run = (all.run ??= { from: now, last: now, checks: 0, offline: 0, detail: null, carried: [] });
      run.last = now;
      run.checks += 1;
      run.offline = offlineCount({ ...run, checks: run.checks - 1 }) + (kind === 'offline' ? 1 : 0);
      run.detail ??= String(r.ok ? (r.details?.[0]?.value ?? 'not live') : r.error).slice(0, 60);
      if (run.checks < CONFIRM_CHECKS) {
        // Not confirmed yet: keep showing the last known numbers, and count them for this sample too.
        state.latest[server.id] = { ...last, unsure: true, unsureSince: run.from, unsureDetail: run.detail };
        if (carry()) (run.carried ??= []).push([today, hour, last.online ? 1 : 0, last.players]);
        return;
      }
      // Confirmed. The readings counted while it was in doubt are taken back out of today's totals.
      if (run.checks === CONFIRM_CHECKS) {
        for (const [day, at, online, players] of run.carried ?? []) {
          const slot = day === today ? state.hours[server.code]?.[at] : null;
          if (!slot) continue;
          slot[0] -= players;
          slot[2] -= online;
          if (kindOf(run) === 'unknown') slot[1] -= 1; // no answer at all is not counted as a reading
        }
        run.carried = [];
      }
    }

    if (!r.ok) {
      // Confirmed: keep the last known numbers and say the feed is not answering.
      state.latest[server.id] = { ...state.latest[server.id], ok: false, unsure: false, error: r.error, failedAt: now };
      parts.push(`${server.code}-`);
      return;
    }
    state.latest[server.id] = { ok: true, online: r.online, players: r.players, checkedAt: r.checkedAt, details: r.details, at: now };
    if (all.recordPeak === null || r.players > all.recordPeak) {
      all.recordPeak = r.players;
      all.recordAt = now;
    }
    if (r.players > 0) all.lastPlayersAt = now;
    save(r.online, r.players);
  });

  // One-time repair. For a day one server was kept off the page and a second record counted it in.
  // That record is the real one for all servers together, so it is folded back.
  if (state.totalAll) {
    if ((state.totalAll.recordPeak ?? -1) > (state.total?.recordPeak ?? -1)) state.total = state.totalAll;
    delete state.totalAll;
  }
  if (total !== null && (state.total?.recordPeak ?? -1) < total) state.total = { recordPeak: total, recordAt: now };
  state.since ??= now;
  state.checks += 1;
  state.lastT = now;
  return { rawLine: `${parts.join(';')}\n`, finished };
}

async function loadState() {
  const [saved] = await mget([STATE_KEY]);
  return saved ? JSON.parse(saved) : null;
}

let sampling = false;

/** Reads the feeds and saves one sample, unless one was taken moments ago or is being taken right now. */
export async function collect({ force = false } = {}) {
  const state = (await loadState()) ?? newState();
  if (!force && state.lastT && Date.now() - state.lastT < MIN_GAP_MS) return { skipped: true, state };
  // Two requests can arrive together. Only one of them takes the sample.
  if (sampling || !(await lock(LOCK_KEY, LOCK_SECONDS))) return { skipped: true, state };
  sampling = true;
  try {
    return await takeSample(state);
  } finally {
    sampling = false;
  }
}

/**
 * One-time repair. Under the old three-checks rule, a few minutes of "maintenance" answers were saved as an
 * empty, offline server. Those readings are rewritten to the count seen just before them, which is what the
 * current rule saves. Returns the writes to make. Safe to run twice: a fixed reading is not touched again.
 */
export async function repairShortRuns(state, now) {
  const fixes = [];
  for (const server of SERVERS) {
    const all = state.all[server.id];
    if (!all) continue;
    for (const o of all.outages) if (o.kind === 'offline' && o.checks && o.checks < CONFIRM_CHECKS) fixes.push([server, o.from, o.to]);
    all.outages = all.outages.filter((o) => !o.checks || o.checks >= CONFIRM_CHECKS);
  }
  const days = [...new Set(fixes.flatMap(([, from, to]) => daysBetween(from, to)))].filter((day) => Date.parse(day) > now - RAW_KEEP_DAYS * DAY_MS);
  if (!days.length) return [];
  const saved = await mget([...days.map(rawKey), ...days.map(hoursKey)]);
  const ops = [];
  days.forEach((day, d) => {
    if (!saved[d]) return;
    const savedHours = saved[days.length + d];
    const hours = day === state.today ? state.hours : savedHours ? JSON.parse(savedHours) : null;
    const lines = saved[d].split('\n');
    let changed = false;
    for (const [server, from, to] of fixes) {
      const entry = new RegExp(`(^|;)${server.code}([01]):(\\d+)(?=;|$)`);
      let before = null; // the last count read while the server was live
      lines.forEach((line, k) => {
        const t = Number(line.split(';')[0]) * 1000;
        const found = entry.exec(line);
        if (!t || !found) return;
        if (found[2] === '1') {
          before = Number(found[3]);
          return;
        }
        if (t < from - 1000 || t > to || before === null) return;
        lines[k] = line.replace(entry, `$1${server.code}1:${before}`);
        changed = true;
        const slot = hours?.[server.code]?.[new Date(t).getUTCHours()];
        if (!slot) return;
        slot[0] += before - Number(found[3]);
        slot[2] += 1;
        slot[3] = Math.max(slot[3], before);
      });
    }
    if (!changed) return;
    ops.push({ set: [rawKey(day), lines.join('\n'), RAW_KEEP_DAYS * 86_400] });
    if (day !== state.today && hours) ops.push({ set: [hoursKey(day), JSON.stringify(hours)] });
  });
  return ops;
}

async function takeSample(state) {
  // A server whose Discord size has never been read, as with one just added, does not wait for the hourly
  // round: it is tried again every few minutes until it has one.
  const unread = SERVERS.some((server) => server.discord && !state.community?.byId?.[server.id]);
  const communityDue = !state.community || Date.now() - state.community.triedAt > (unread ? COMMUNITY_RETRY_MS : COMMUNITY_MS);
  const [results, communities] = await Promise.all([readAll(), communityDue ? readCommunities() : null]);
  const now = Date.now();
  if (communities) {
    state.community = { triedAt: now, byId: state.community?.byId ?? {} };
    SERVERS.forEach((server, i) => {
      if (communities[i]) state.community.byId[server.id] = { ...communities[i], at: now };
    });
    // The same hourly round adds up the visits shown at the foot of the page.
    try {
      const visits = await visitSummary(30, now);
      state.page = { visits: visits.visits, visitors: visits.visitors, countries: visits.countryCount, phones: visits.phoneVisits, at: now };
    } catch (err) {
      console.warn(`could not add up the visits: ${err.message}`);
    }
  }
  // The record for all servers together was added later. The first time, it is worked out from the saved readings.
  if (!state.total && state.since) {
    const texts = await mget(daysBetween(now - RAW_KEEP_DAYS * DAY_MS, now).map(rawKey));
    state.total = totalPeak(parseRaw(texts, 0));
  }
  const repairs = (state.v ?? 1) < 2 ? await repairShortRuns(state, now) : [];
  state.v = 2;
  const firstOfDay = state.today !== dayOf(now);
  const { rawLine, finished } = applySample(state, now, results);
  const ops = [
    ...repairs,
    { append: [rawKey(dayOf(now)), rawLine, firstOfDay ? RAW_KEEP_DAYS * 86_400 : null] },
    { set: [STATE_KEY, JSON.stringify(state)] },
  ];
  // A finished day's hourly totals are small and are kept for good.
  if (finished) ops.push({ set: [hoursKey(finished.day), JSON.stringify(finished.hours)] });
  await write(ops);
  return { skipped: false, state };
}

function daysBetween(from, to) {
  const days = [];
  for (let t = Date.parse(dayOf(from)); t <= to; t += DAY_MS) days.push(dayOf(t));
  return days;
}

/** Saved lines look like "1794306217;r1:2;v1:4;e-": seconds, then code + online flag + players, or "-" for no answer. */
function parseRaw(texts, from) {
  const index = new Map(SERVERS.map((server, i) => [server.code, i]));
  const samples = [];
  for (const text of texts) {
    for (const line of (text ?? '').split('\n')) {
      const parts = line.split(';');
      const t = Number(parts[0]) * 1000;
      if (!t || t < from) continue;
      const values = new Array(SERVERS.length); // undefined = no sample, null = no answer
      for (const part of parts.slice(1)) {
        const i = index.get(part[0]);
        if (i === undefined) continue;
        if (part[1] === '-') values[i] = null;
        else values[i] = { online: part[1] === '1', players: Number(part.slice(3)) || 0 };
      }
      samples.push({ t, values });
    }
  }
  return samples.sort((a, b) => a.t - b.t);
}

const round2 = (n) => Math.round(n * 100) / 100;
const emptySummary = () => ({ peak: null, peakAt: null, sum: 0, answered: 0, onlineChecks: 0 });

function finishSummary(s) {
  return {
    peak: s.peak,
    peakAt: s.peakAt,
    average: s.answered ? s.sum / s.answered : null,
    availability: s.answered ? s.onlineChecks / s.answered : null,
    answered: s.answered,
    onlineChecks: s.onlineChecks,
  };
}

function fromRaw(samples, bucketMs) {
  const summaries = SERVERS.map(emptySummary);
  const points = [];
  if (!samples.length) return { summaries, points, means: [] };
  const first = Math.floor(samples[0].t / bucketMs);
  const last = Math.floor(samples.at(-1).t / bucketMs);
  for (let b = first; b <= last; b++) points.push([b * bucketMs, ...SERVERS.map(() => null)]);
  const totals = points.map(() => SERVERS.map(() => [0, 0])); // player sum and readings, per step and server
  for (const { t, values } of samples) {
    const row = points[Math.floor(t / bucketMs) - first];
    values.forEach((value, i) => {
      if (!value) return;
      const total = totals[Math.floor(t / bucketMs) - first][i];
      total[0] += value.players;
      total[1] += 1;
      const s = summaries[i];
      s.answered += 1;
      s.onlineChecks += value.online ? 1 : 0;
      s.sum += value.players;
      if (s.peak === null || value.players > s.peak) {
        s.peak = value.players;
        s.peakAt = t;
      }
      if (row[i + 1] === null || value.players > row[i + 1]) row[i + 1] = value.players;
    });
  }
  // A short hole shows the last known value. Longer ones stay open, because nothing is known there.
  const means = totals.map((row) => row.map(([sum, n]) => (n ? round2(sum / n) : null)));
  SERVERS.forEach((server, i) => {
    let last = null;
    points.forEach((row, k) => {
      if (row[i + 1] !== null) last = { t: row[0], value: row[i + 1], mean: means[k][i] };
      else if (last && row[0] - last.t <= CARRY_MS) {
        row[i + 1] = last.value;
        means[k][i] = last.mean;
      }
    });
  });
  return { summaries, points, means };
}

function fromHours(hourly, from, to) {
  const summaries = SERVERS.map(emptySummary);
  const points = [];
  const means = [];
  for (let t = Math.floor(from / HOUR_MS) * HOUR_MS; t <= to; t += HOUR_MS) {
    const hours = hourly.get(dayOf(t));
    const hour = new Date(t).getUTCHours();
    const row = [t];
    const mean = [];
    SERVERS.forEach((server, i) => {
      const slot = hours?.[server.code]?.[hour];
      row.push(slot ? slot[3] : null);
      mean.push(slot?.[1] ? round2(slot[0] / slot[1]) : null);
      if (!slot) return;
      const s = summaries[i];
      s.sum += slot[0];
      s.answered += slot[1];
      s.onlineChecks += slot[2];
      if (s.peak === null || slot[3] > s.peak) {
        s.peak = slot[3];
        s.peakAt = t;
      }
    });
    points.push(row);
    means.push(mean);
  }
  const hasData = (row) => row.slice(1).some((v) => v !== null);
  while (points.length && !hasData(points[0])) {
    points.shift();
    means.shift();
  }
  while (points.length && !hasData(points.at(-1))) {
    points.pop();
    means.pop();
  }
  return { summaries, points, means };
}

/** Short gaps for the page, newest first. One that is still going, and not yet an outage, comes on top. */
function gapsOf(all, now) {
  const list = (all?.gaps ?? []).map((gap) => ({ ...gap, ongoing: false }));
  const run = all?.run;
  if (run && run.checks < CONFIRM_CHECKS && now - run.last < SILENCE_MS) {
    list.unshift({ kind: kindOf(run), from: run.from, to: now, checks: run.checks, detail: run.detail ?? null, ongoing: true });
  }
  return list.slice(0, GAPS_KEPT);
}

function outagesOf(all, now) {
  // Entries saved before the three-in-a-row rule have no `checks`. Those are judged by how long they lasted.
  const list = (all?.outages ?? [])
    .filter((o) => (o.checks ? o.checks >= CONFIRM_CHECKS : o.to - o.from >= (CONFIRM_CHECKS - 0.5) * SAMPLE_MS))
    .map((o) => ({ ...o, ongoing: false }));
  const run = all?.run;
  if (run && run.checks >= CONFIRM_CHECKS) {
    const ongoing = now - run.last < SILENCE_MS;
    list.unshift({ kind: kindOf(run), from: run.from, to: ongoing ? now : run.last + SAMPLE_MS, detail: run.detail ?? null, ongoing });
  }
  return list;
}

const describe = (server) => ({ id: server.id, name: server.name, site: server.site, about: server.about ?? null });

/** The server's Discord: static facts plus the last counts read, when there are any. */
function communityOf(server, state) {
  if (!server.discord) return null;
  const { invite, opened, shared } = server.discord;
  return { url: `https://discord.gg/${invite}`, opened, shared, ...(state?.community?.byId?.[server.id] ?? {}) };
}

/**
 * One entry per day with data: [dayStart, answeredChecks, onlineChecks, mostAtOnce, playerSum].
 * Days are cut in the viewer's time zone, given as whole hours ahead of UTC. `dayStart` is that
 * calendar date at midnight UTC.
 */
function daysOf(hourly, code, tzHours) {
  const days = new Map();
  for (const [day, hours] of hourly) {
    for (const [hour, slot] of Object.entries(hours[code] ?? {})) {
      const start = Math.floor((Date.parse(day) + (Number(hour) + tzHours) * HOUR_MS) / DAY_MS) * DAY_MS;
      const total = days.get(start) ?? [start, 0, 0, 0, 0];
      total[1] += slot[1];
      total[2] += slot[2];
      total[3] = Math.max(total[3], slot[3]);
      total[4] += slot[0];
      days.set(start, total);
    }
  }
  return [...days.values()].filter((day) => day[1]).sort((a, b) => a[0] - b[0]);
}

/** Totals for each hour of the week in UTC: 168 entries of [playerSum, readings], Sunday 00:00 first. */
function weekOf(hourly, code) {
  const week = Array.from({ length: 168 }, () => [0, 0]);
  for (const [day, hours] of hourly) {
    const weekday = new Date(day).getUTCDay();
    for (const [hour, slot] of Object.entries(hours[code] ?? {})) {
      week[weekday * 24 + Number(hour)][0] += slot[0];
      week[weekday * 24 + Number(hour)][1] += slot[1];
    }
  }
  return week;
}

/** The most seen at once in the last 24 hours, from the hourly totals. */
function peak24Of(hourly, code, now) {
  let peak = null;
  for (let t = Math.floor((now - DAY_MS) / HOUR_MS) * HOUR_MS; t <= now; t += HOUR_MS) {
    const slot = hourly.get(dayOf(t))?.[code]?.[new Date(t).getUTCHours()];
    if (slot && (peak === null || slot[3] > peak)) peak = slot[3];
  }
  return peak;
}

/** With no storage connected the page still shows live numbers, just no history. */
async function liveOnly(range) {
  const results = await readAll();
  const now = Date.now();
  return {
    now,
    sampleSeconds: SAMPLE_MS / 1000,
    storage: false,
    since: null,
    checks: 0,
    total: { peak24: null, recordPeak: null, recordAt: null },
    page: { visits30: null, visitors30: null, countries30: null, phoneShare30: null },
    servers: SERVERS.map((server, i) => ({
      ...describe(server),
      community: communityOf(server, null),
      now: results[i].ok ? { ...results[i], at: now } : { ok: false, error: results[i].error, failedAt: now },
      summary: finishSummary(emptySummary()),
      allTime: { recordPeak: null, recordAt: null, lastPlayersAt: null, hoursUtc: [], weekUtc: [], peak24: null, days: [], outages: [], gaps: [] },
    })),
    history: { range, from: now - RANGES[range].spanMs, to: now, bucketMs: RANGES[range].bucketMs, points: [], means: [] },
  };
}

/** `tzHours` is the viewer's time zone as whole hours ahead of UTC. It decides where one day ends and the next begins. */
export async function buildStats(rangeKey, tzHours = 0) {
  const range = Object.hasOwn(RANGES, rangeKey) ? rangeKey : '24h';
  if (!storeKind()) return liveOnly(range);

  // Reads for the page may be up to half a minute old. Taking a sample always reads fresh.
  const [saved] = await mgetRecent([STATE_KEY]);
  let state = saved ? JSON.parse(saved) : null;
  if (!state || Date.now() - state.lastT > STALE_MS) {
    try {
      state = (await collect()).state;
    } catch (err) {
      console.warn(`could not take a sample: ${err.message}`);
      state ??= newState();
    }
  }

  const now = Date.now();
  const { spanMs, bucketMs } = RANGES[range];
  const byHour = range === '30d' || range === 'all';
  // "All" starts where the data starts, not a year back.
  const from = range === 'all' ? Math.max(now - spanMs, Math.floor((state.since ?? now) / HOUR_MS) * HOUR_MS) : now - spanMs;
  // The last 24 hours of readings are always loaded, for the peak of all servers together.
  const rawFrom = byHour ? now - DAY_MS : Math.min(from, now - DAY_MS);
  const rawDays = daysBetween(rawFrom, now);
  const loadDays = range === 'all' ? 365 : ALL_TIME_DAYS;
  const hourDays = daysBetween(now - loadDays * DAY_MS, now).filter((day) => day !== state.today);
  const values = await mgetRecent([...rawDays.map(rawKey), ...hourDays.map(hoursKey)]);

  const hourly = new Map();
  hourDays.forEach((day, i) => {
    const saved = values[rawDays.length + i];
    if (saved) hourly.set(day, JSON.parse(saved));
  });
  if (state.today) hourly.set(state.today, state.hours);

  const samples = parseRaw(values.slice(0, rawDays.length), rawFrom);
  // `points` holds the most seen at once in each step of time, `means` the average, in the same order.
  const { summaries, points, means } = byHour ? fromHours(hourly, from, now) : fromRaw(samples.filter((sample) => sample.t >= from), bucketMs);
  const lastDay = totalPeak(samples.filter((sample) => sample.t >= now - DAY_MS));

  return {
    now,
    sampleSeconds: SAMPLE_MS / 1000,
    storage: true,
    since: state.since,
    checks: state.checks,
    total: { peak24: lastDay.recordPeak, ...(state.total ?? lastDay) },
    page: {
      visits30: state.page?.visits ?? null,
      visitors30: state.page?.visitors ?? null,
      countries30: state.page?.countries ?? null,
      // The share of visits made on a phone, as a whole percent.
      phoneShare30: state.page?.visits && state.page.phones != null ? Math.round((100 * state.page.phones) / state.page.visits) : null,
    },
    servers: SERVERS.map((server, i) => {
      const all = state.all[server.id];
      const hoursUtc = Array.from({ length: 24 }, () => [0, 0]);
      for (const hours of hourly.values()) {
        for (const [hour, slot] of Object.entries(hours[server.code] ?? {})) {
          hoursUtc[hour][0] += slot[0];
          hoursUtc[hour][1] += slot[1];
        }
      }
      return {
        ...describe(server),
        community: communityOf(server, state),
        now: state.latest[server.id] ?? null,
        summary: finishSummary(summaries[i]),
        allTime: {
          recordPeak: all?.recordPeak ?? null,
          recordAt: all?.recordAt ?? null,
          lastPlayersAt: all?.lastPlayersAt ?? null,
          hoursUtc,
          weekUtc: weekOf(hourly, server.code),
          peak24: peak24Of(hourly, server.code, now),
          days: daysOf(hourly, server.code, tzHours),
          outages: outagesOf(all, now),
          gaps: gapsOf(all, now),
        },
      };
    }),
    history: { range, from, to: now, bucketMs, points, means },
  };
}
