// Turns the saved samples into the page's numbers: history, summaries, records, outages and the weekly pattern.
import { SERVERS, readAll } from './sources.js';
import { mgetRecent, storeKind } from './store.js';
import { CARRY_MS, CONFIRM_CHECKS, GAPS_KEPT, SAMPLE_MS, SILENCE_MS, STATE_KEY, collect, hoursKey, kindOf, newState, parseSaved, rawKey, totalOf } from './sampler.js';
import { DAY_MS, HOUR_MS, dayOf, daysBetween } from './time.js';

const STALE_MS = 90_000; // a page view takes a sample itself when the last one is older
const ALL_TIME_DAYS = 90;
const LONG_SPAN_MS = 180 * DAY_MS;
const DUE_GRACE_MS = 5_000; // how long after a reading is due the saved state is read again

export const RANGES = {
  '1h': { spanMs: HOUR_MS, bucketMs: 120_000 },
  '24h': { spanMs: DAY_MS, bucketMs: 300_000 },
  '7d': { spanMs: 7 * DAY_MS, bucketMs: 1_800_000 },
  '30d': { spanMs: 30 * DAY_MS, bucketMs: HOUR_MS },
  all: { spanMs: 365 * DAY_MS, bucketMs: HOUR_MS }, // spanMs only matters without storage. With it, "All" starts at the first reading
};

/** The most operatives seen at once on all servers together, and when. */
function totalPeak(samples) {
  const best = { recordPeak: null, recordAt: null };
  for (const { t, values } of samples) {
    const total = totalOf(values);
    if (total !== null && (best.recordPeak === null || total > best.recordPeak)) Object.assign(best, { recordPeak: total, recordAt: t });
  }
  return best;
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

const describe = (server) => ({ id: server.id, name: server.name, site: server.site, tone: server.tone, about: server.about ?? null });

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
export function daysOf(hourly, code, tzHours) {
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
  let state = parseSaved(saved, STATE_KEY) ?? null;
  // Once the next reading is due, the copy in memory may miss it, so it is read again. That is at most once a
  // minute, however many requests come in.
  const due = state?.lastT ? state.lastT + SAMPLE_MS + DUE_GRACE_MS : 0;
  if (due && Date.now() > due) {
    [saved] = await mgetRecent([STATE_KEY], { since: due });
    if (saved) state = parseSaved(saved, STATE_KEY) ?? state;
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
    const hours = parseSaved(saved, hoursKey(day));
    if (hours) hourly.set(day, hours);
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
