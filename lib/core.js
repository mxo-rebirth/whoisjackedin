// Takes samples of the servers, saves them, and turns the saved samples into the page's numbers.
import { SERVERS, readAll, readCommunities } from './sources.js';
import { lock, mget, mgetRecent, storeKind, write } from './store.js';
import { keepDailyTotals } from './visits.js';

export const SAMPLE_MS = 60_000;
// The feeds are never read more often than this, whoever asks. The outside sampler comes once a minute
// but drifts by a few seconds, and a longer gap here skipped the runs that came a little early.
const MIN_GAP_MS = 30_000;
const STALE_MS = 90_000; // a page view takes a sample itself when the last one is older
const SILENCE_MS = 3 * SAMPLE_MS; // longer than this without samples means "not recording", not an outage
const CONFIRM_CHECKS = 15; // bad answers in a row before a server counts as down: about 15 minutes
const CARRY_MS = 15 * 60_000; // how long the last real reading may stand in for a missing or doubtful one
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RAW_KEEP_DAYS = 9;
const ALL_TIME_DAYS = 90;
const LONG_SPAN_MS = 180 * DAY_MS;
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
  all: { spanMs: 365 * DAY_MS, bucketMs: HOUR_MS }, // spanMs only matters without storage. With it, "All" starts at the first reading
};

/**
 * Saved under STATE_KEY. `hours` holds the hourly totals of `today` (UTC) as
 * { code: { hour: [playerSum, answered, online, peak] } }. Finished days move to their own key.
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

/** Takes one stand-in reading back out of an hour's totals. A feed that gave no answer was not a reading at all. */
function takeOut(slot, { online, players, unknown }) {
  slot[0] -= players;
  slot[2] -= online;
  if (unknown) slot[1] -= 1;
}

/**
 * The saved lines with one server's stand-in readings between `from` and `to` replaced by what the outage turned
 * out to be: "-" for no answer, "0:0" for a server that said it was down. A stand-in is any reading of the server
 * as online inside a confirmed outage, since every real answer in it was a bad one.
 */
export function cleanStandIns(text, code, from, to, kind) {
  const entry = new RegExp(`(^|;)${code}1:\\d+(?=;|$)`);
  let changed = 0;
  const lines = (text ?? '').split('\n').map((line) => {
    const t = Number(line.split(';')[0]) * 1000;
    if (!t || t < from || t >= to || !entry.test(line)) return line;
    changed += 1;
    return line.replace(entry, `$1${code}${kind === 'offline' ? '0:0' : '-'}`);
  });
  return { text: lines.join('\n'), changed };
}

/**
 * Folds one round of answers into the state. Returns the line to save, any day that just ended, the outages
 * confirmed in this round (their stand-in lines need cleaning) and stand-ins on days already saved.
 */
export function applySample(state, now, results) {
  const confirmed = [];
  const late = [];
  const today = dayOf(now);
  const finished = state.today && state.today !== today ? { day: state.today, hours: state.hours } : null;
  if (state.today !== today) {
    state.today = today;
    state.hours = {};
  }
  const silence = state.lastT !== null && now - state.lastT > SILENCE_MS;
  const hour = new Date(now).getUTCHours();
  const parts = [Math.round(now / 1000)];
  let total = null;

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
      // Confirmed. The readings counted while it was in doubt are taken back out: from today's totals here, from
      // a day that ended meanwhile by the caller, which has that day's totals.
      if (run.checks === CONFIRM_CHECKS) {
        const unknown = kindOf(run) === 'unknown';
        for (const [day, at, online, players] of run.carried ?? []) {
          const fix = { code: server.code, day, at, online, players, unknown };
          const slot = day === today ? state.hours[server.code]?.[at] : day === finished?.day ? finished.hours[server.code]?.[at] : null;
          if (slot) takeOut(slot, fix);
          else if (day !== today) late.push(fix);
        }
        confirmed.push({ code: server.code, from: run.from, to: now, kind: kindOf(run) });
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

  if (total !== null && (state.total?.recordPeak ?? -1) < total) state.total = { recordPeak: total, recordAt: now };
  state.since ??= now;
  state.checks += 1;
  state.lastT = now;
  return { rawLine: `${parts.join(';')}\n`, finished, confirmed, late };
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
  }
  // Visit totals are no longer kept with the public numbers.
  delete state.page;
  // Neither the repair nor the cleaning may stop the reading itself from being saved.
  let repairs = [];
  if ((state.v ?? 2) < 3) {
    try {
      repairs = await repairStandIns(state, now);
      state.v = 3;
    } catch (err) {
      console.warn(`could not repair the saved stand-ins, trying again next time: ${err.message}`);
    }
  }
  const firstOfDay = state.today !== dayOf(now);
  const { rawLine, finished, confirmed, late } = applySample(state, now, results);
  const cleaning = await cleaningOps(confirmed, late, now).catch((err) => {
    console.warn(`could not clean the stand-ins of a new outage: ${err.message}`);
    return [];
  });
  const ops = [...repairs, ...cleaning, { append: [rawKey(dayOf(now)), rawLine, firstOfDay ? RAW_KEEP_DAYS * 86_400 : null] }, { set: [STATE_KEY, JSON.stringify(state)] }];
  // A finished day's hourly totals are small and are kept for good, and so are its visit totals.
  if (finished) {
    ops.push({ set: [hoursKey(finished.day), JSON.stringify(finished.hours)] });
    ops.push(...(await keepDailyTotals(now).catch((err) => (console.warn(`could not keep the visit totals: ${err.message}`), []))));
  }
  await write(ops);
  return { skipped: false, state };
}

/** Seconds a day's saved lines have left, so rewriting them does not keep them longer than the others. */
const rawTtl = (day, now) => Math.max(60, Math.round((Date.parse(day) + (RAW_KEEP_DAYS + 1) * DAY_MS - now) / 1000));

/** The writes that clean the lines of newly confirmed outages, and stand-ins left in a day already saved. */
async function cleaningOps(confirmed, late, now) {
  if (!confirmed.length && !late.length) return [];
  const rawDays = [...new Set(confirmed.flatMap((c) => daysBetween(c.from, c.to)))];
  const hourDays = [...new Set(late.map((fix) => fix.day))];
  const saved = await mget([...rawDays.map(rawKey), ...hourDays.map(hoursKey)]);
  const ops = [];
  rawDays.forEach((day, d) => {
    let text = saved[d];
    let changed = 0;
    for (const c of confirmed) {
      const result = cleanStandIns(text, c.code, c.from, c.to, c.kind);
      text = result.text;
      changed += result.changed;
    }
    if (changed) ops.push({ set: [rawKey(day), text, rawTtl(day, now)] });
  });
  hourDays.forEach((day, d) => {
    const hours = saved[rawDays.length + d] ? JSON.parse(saved[rawDays.length + d]) : null;
    if (!hours) return;
    for (const fix of late.filter((f) => f.day === day)) {
      const slot = hours[fix.code]?.[fix.at];
      if (slot) takeOut(slot, fix);
    }
    ops.push({ set: [hoursKey(day), JSON.stringify(hours)] });
  });
  return ops;
}

/**
 * One-time repair, run once on the saved data: the outages confirmed before stand-ins were cleaned at once still
 * have them in their lines, and one that crossed midnight UTC left them in the earlier day's totals. Rejacked's
 * outage of 18 Nov 2026 was saved as "no answer" because of a reader bug while its feed said "offline". It is
 * turned into the outage it was. Every entry it changes is copied under mxo:backup:v3:... for 30 days first.
 */
export async function repairStandIns(state, now) {
  const backupOf = (key, value) => ({ set: [`mxo:backup:v3:${key}`, value, 30 * 86_400] });
  const ops = [backupOf(STATE_KEY, JSON.stringify(state))];
  const jobs = [];
  for (const server of SERVERS) {
    for (const o of state.all[server.id]?.outages ?? []) {
      if (o.to < now - RAW_KEEP_DAYS * DAY_MS || (o.checks && o.checks < CONFIRM_CHECKS)) continue;
      const misread = server.id === 'rejacked' && o.detail === 'no usable status in the feed';
      if (misread) Object.assign(o, { kind: 'offline', detail: 'offline' });
      jobs.push({ code: server.code, from: o.from, to: o.to, kind: o.kind, misread });
    }
  }
  if (!jobs.length) return ops;
  const days = [...new Set(jobs.flatMap((job) => daysBetween(job.from, job.to)))];
  const pastDays = days.filter((day) => day !== state.today);
  const saved = await mget([...days.map(rawKey), ...pastDays.map(hoursKey)]);
  const raw = new Map(days.map((day, d) => [day, saved[d]]));
  const original = new Map(raw);
  const hours = new Map(pastDays.map((day, d) => [day, saved[days.length + d] ? JSON.parse(saved[days.length + d]) : null]));
  hours.set(state.today, state.hours);
  const touched = new Set();
  for (const job of jobs) {
    // When the outage was confirmed: the stand-ins before then were taken out of that day's totals only.
    const times = days
      .flatMap((day) => (raw.get(day) ?? '').split('\n'))
      .map((line) => [Number(line.split(';')[0]) * 1000, line])
      .filter(([t, line]) => t >= job.from && t < job.to && new RegExp(`(^|;)${job.code}[-01]`).test(line))
      .map(([t]) => t)
      .sort((a, b) => a - b);
    const confirmedAt = times[Math.min(CONFIRM_CHECKS - 1, times.length - 1)] ?? job.from;
    for (const day of daysBetween(job.from, job.to)) {
      const text = raw.get(day);
      if (!text) continue;
      const entry = new RegExp(`(^|;)${job.code}(-|([01]):(\\d+))(?=;|$)`);
      const lines = text.split('\n').map((line) => {
        const t = Number(line.split(';')[0]) * 1000;
        const found = entry.exec(line);
        if (!t || t < job.from || t >= job.to || !found) return line;
        const wasOnline = found[3] === '1';
        const wasDown = found[3] === '0';
        const now0 = job.misread ? 'down' : wasOnline ? (job.kind === 'offline' ? 'down' : 'none') : null;
        if (!now0) return line;
        // What this minute added to the hour's totals before, and what it adds now.
        const removed = wasOnline && dayOf(t) === dayOf(confirmedAt);
        const before = wasOnline && !removed ? [Number(found[4]), 1, 1] : wasDown ? [0, 1, 0] : [0, 0, 0];
        const after = now0 === 'down' ? [0, 1, 0] : [0, 0, 0];
        const slot = hours.get(dayOf(t))?.[job.code]?.[new Date(t).getUTCHours()];
        if (slot) {
          slot[0] += after[0] - before[0];
          slot[1] += after[1] - before[1];
          slot[2] += after[2] - before[2];
          if (dayOf(t) !== state.today) touched.add(dayOf(t));
        }
        return line.replace(entry, `$1${job.code}${now0 === 'down' ? '0:0' : '-'}`);
      });
      raw.set(day, lines.join('\n'));
    }
  }
  // Each entry is backed up once, as it was, and written once, as it ends up.
  for (const day of days) {
    if (raw.get(day) !== original.get(day)) ops.push(backupOf(rawKey(day), original.get(day)), { set: [rawKey(day), raw.get(day), rawTtl(day, now)] });
  }
  for (const day of touched) {
    const index = pastDays.indexOf(day);
    ops.push(backupOf(hoursKey(day), saved[days.length + index] ?? ''), { set: [hoursKey(day), JSON.stringify(hours.get(day))] });
  }
  return ops;
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

/**
 * While a bad streak is in doubt, the last count is saved in its place so a short blip leaves no dent.
 * Once it is a confirmed outage those stand-ins are wrong, so they are read as no answer or down.
 * `outages` holds each server's confirmed outages, in SERVERS order.
 */
function withoutStandIns(samples, outages) {
  for (const sample of samples) {
    sample.values.forEach((value, i) => {
      if (value === undefined) return; // no sample of this server at all
      // Only a reading of the server as online can be a stand-in: every real answer in an outage was a bad one.
      const outage = value?.online && outages[i].find((o) => sample.t >= o.from && sample.t < o.to);
      if (outage) sample.values[i] = outage.kind === 'offline' ? { online: false, players: 0 } : null;
    });
  }
  return samples;
}

function fromRaw(samples, bucketMs, outages) {
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
  // A short hole shows the last known value. Longer ones stay open, because nothing is known there, and so
  // does a hole that lies in a confirmed outage: there the line is meant to break.
  const means = totals.map((row) => row.map(([sum, n]) => (n ? round2(sum / n) : null)));
  SERVERS.forEach((server, i) => {
    let last = null;
    points.forEach((row, k) => {
      if (row[i + 1] !== null) last = { t: row[0], value: row[i + 1], mean: means[k][i] };
      else if (last && row[0] - last.t <= CARRY_MS && !outages[i].some((o) => row[0] < o.to && row[0] + bucketMs > o.from)) {
        row[i + 1] = last.value;
        means[k][i] = last.mean;
      }
    });
  });
  return { summaries, points, means };
}

/**
 * Points from the hourly totals. `stepMs` is a whole number of hours: an hour, or a day for long spans, where
 * a step's peak is the highest hourly peak in it and its mean is taken over all its readings.
 */
function fromHours(hourly, from, to, stepMs = HOUR_MS) {
  const summaries = SERVERS.map(emptySummary);
  const points = [];
  const means = [];
  let step = null;
  const flush = () => {
    if (!step) return;
    points.push([step.t, ...step.peak]);
    means.push(step.sum.map((sum, i) => (step.answered[i] ? round2(sum / step.answered[i]) : null)));
  };
  for (let t = Math.floor(from / HOUR_MS) * HOUR_MS; t <= to; t += HOUR_MS) {
    const start = Math.floor(t / stepMs) * stepMs;
    if (step?.t !== start) {
      flush();
      step = { t: start, peak: SERVERS.map(() => null), sum: SERVERS.map(() => 0), answered: SERVERS.map(() => 0) };
    }
    const hours = hourly.get(dayOf(t));
    const hour = new Date(t).getUTCHours();
    SERVERS.forEach((server, i) => {
      const slot = hours?.[server.code]?.[hour];
      if (!slot) return;
      if (step.peak[i] === null || slot[3] > step.peak[i]) step.peak[i] = slot[3];
      step.sum[i] += slot[0];
      step.answered[i] += slot[1];
      const s = summaries[i];
      s.sum += slot[0];
      s.answered += slot[1];
      s.onlineChecks += slot[2];
      if (s.peak === null || slot[3] > s.peak) {
        s.peak = slot[3];
        s.peakAt = t;
      }
    });
  }
  flush();
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
 * One entry per day with data: [dayStart, answeredChecks, onlineChecks, mostAtOnce, playerSum]. Days are
 * cut in the viewer's time zone (whole hours ahead of UTC), and `dayStart` is that date at midnight UTC.
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
  let [saved] = await mgetRecent([STATE_KEY]);
  let state = saved ? JSON.parse(saved) : null;
  // Once the next reading is due, the copy in memory may miss it, so it is read again. That is at most once a
  // minute, however many requests come in.
  const due = state?.lastT ? state.lastT + SAMPLE_MS + 5_000 : 0;
  if (due && Date.now() > due) {
    [saved] = await mgetRecent([STATE_KEY], { since: due });
    if (saved) state = JSON.parse(saved);
  }
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
  // "All" starts where the data starts. Past half a year it is drawn a day per step, which keeps the answer small.
  const from = range === 'all' ? Math.floor((state.since ?? now) / HOUR_MS) * HOUR_MS : now - spanMs;
  const stepMs = range === 'all' && now - from > LONG_SPAN_MS ? DAY_MS : bucketMs;
  // The last 24 hours of readings are always loaded, for the peak of all servers together.
  const rawFrom = byHour ? now - DAY_MS : Math.min(from, now - DAY_MS);
  const rawDays = daysBetween(rawFrom, now);
  const loadDays = range === 'all' ? Math.max(ALL_TIME_DAYS, Math.ceil((now - from) / DAY_MS) + 1) : ALL_TIME_DAYS;
  const hourDays = daysBetween(now - loadDays * DAY_MS, now).filter((day) => day !== state.today);
  const values = await mgetRecent([...rawDays.map(rawKey), ...hourDays.map(hoursKey)], { since: due });

  const hourly = new Map();
  hourDays.forEach((day, i) => {
    const saved = values[rawDays.length + i];
    if (saved) hourly.set(day, JSON.parse(saved));
  });
  if (state.today) hourly.set(state.today, state.hours);

  const outages = SERVERS.map((server) => outagesOf(state.all[server.id], now));
  const samples = withoutStandIns(parseRaw(values.slice(0, rawDays.length), rawFrom), outages);
  // `points` holds the most seen at once in each step of time, `means` the average, in the same order.
  const { summaries, points, means } = byHour ? fromHours(hourly, from, now, stepMs) : fromRaw(samples.filter((sample) => sample.t >= from), bucketMs, outages);
  const lastDay = totalPeak(samples.filter((sample) => sample.t >= now - DAY_MS));

  return {
    now,
    sampleSeconds: SAMPLE_MS / 1000,
    storage: true,
    since: state.since,
    checks: state.checks,
    total: { peak24: lastDay.recordPeak, ...(state.total ?? lastDay) },
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
    history: { range, from, to: now, bucketMs: stepMs, points, means },
  };
}
