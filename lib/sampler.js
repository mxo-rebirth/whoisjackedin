// Takes samples of the servers and saves them: the state with today's totals, and a line per minute.
import { SERVERS, readAll, readCommunities } from './sources.js';
import { lock, mget, unlock, write } from './store.js';
import { DAY_MS, DAY_S, HOUR_MS, dayOf, daysBetween } from './time.js';
import { keepDailyTotals } from './visits.js';

export const SAMPLE_MS = 60_000;
// The feeds are never read more often than this, whoever asks. The outside sampler comes once a minute
// but drifts by a few seconds, and a longer gap here skipped the runs that came a little early.
const MIN_GAP_MS = 30_000;
export const SILENCE_MS = 3 * SAMPLE_MS; // longer than this without samples means "not recording", not an outage
export const CONFIRM_CHECKS = 15; // bad answers in a row before a server counts as down: about 15 minutes
export const CARRY_MS = 15 * 60_000; // how long the last real reading may stand in for a missing or doubtful one
export const RAW_KEEP_DAYS = 9;
const COMMUNITY_MS = HOUR_MS; // how often the Discord sizes are refreshed
const COMMUNITY_RETRY_MS = 5 * 60_000; // how often, while a server has no size yet
const OUTAGES_KEPT = 20; // per server
const DAMAGED_KEEP_S = 30 * DAY_S; // a damaged saved value is set aside this long, for a look by hand

export const STATE_KEY = 'mxo:state';
const LOCK_KEY = 'mxo:lock';
const LOCK_SECONDS = 25; // shorter than MIN_GAP_MS, so it never blocks the next sample
export const rawKey = (day) => `mxo:raw:${day}`;
export const hoursKey = (day) => `mxo:hours:${day}`;

/**
 * Saved under STATE_KEY. `hours` holds the hourly totals of `today` (UTC) as
 * { code: { hour: [playerSum, answered, online, peak] } }. Finished days move to their own key.
 */
export function newState() {
  return { v: 3, since: null, checks: 0, lastT: null, today: null, hours: {}, latest: {}, all: {}, total: null };
}

/** All servers together in one sample. Null when no server gave a number. */
export const totalOf = (values) => (values.some(Boolean) ? values.reduce((sum, value) => sum + (value ? value.players : 0), 0) : null);

/** A run is a streak of bad answers. Older saved runs have a single `kind` and no `offline` count. */
export const offlineCount = (run) => run.offline ?? (run.kind === 'offline' ? run.checks : 0);
export const kindOf = (run) => (offlineCount(run) * 2 >= run.checks ? 'offline' : 'unknown');

export const GAPS_KEPT = 40;

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
  all.outages.length = Math.min(all.outages.length, OUTAGES_KEPT);
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

/** A saved value, parsed. A damaged one is reported and read as missing (undefined), so one bad write cannot stop the site. */
export function parseSaved(text, key) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`the saved ${key} is damaged: ${err.message}`);
    return undefined;
  }
}

/** The saved state. A damaged one is copied aside and the sampler starts afresh, rather than failing every minute. */
async function loadState() {
  const [saved] = await mget([STATE_KEY]);
  const state = parseSaved(saved, STATE_KEY);
  if (state !== undefined) return state;
  await write([{ set: [`mxo:damaged:${STATE_KEY}:${Date.now()}`, saved, DAMAGED_KEEP_S] }]);
  return null;
}

let sampling = false;

/** Reads the feeds and saves one sample, unless one was taken moments ago or is being taken right now. */
export async function collect({ force = false } = {}) {
  // Two requests can arrive together. The lock comes first, so only one of them reads the state and samples.
  if (sampling || !(await lock(LOCK_KEY, LOCK_SECONDS))) return { skipped: true, state: (await loadState()) ?? newState() };
  sampling = true;
  try {
    const state = (await loadState()) ?? newState();
    if (!force && state.lastT && Date.now() - state.lastT < MIN_GAP_MS) {
      await unlock(LOCK_KEY);
      return { skipped: true, state };
    }
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
  // The cleaning may not stop the reading itself from being saved.
  const firstOfDay = state.today !== dayOf(now);
  const { rawLine, finished, confirmed, late } = applySample(state, now, results);
  const cleaning = await cleaningOps(confirmed, late, now).catch((err) => {
    console.warn(`could not clean the stand-ins of a new outage: ${err.message}`);
    return [];
  });
  const ops = [...cleaning, { append: [rawKey(dayOf(now)), rawLine, firstOfDay ? RAW_KEEP_DAYS * DAY_S : null] }, { set: [STATE_KEY, JSON.stringify(state)] }];
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
    const hours = parseSaved(saved[rawDays.length + d], hoursKey(day));
    if (!hours) return;
    for (const fix of late.filter((f) => f.day === day)) {
      const slot = hours[fix.code]?.[fix.at];
      if (slot) takeOut(slot, fix);
    }
    ops.push({ set: [hoursKey(day), JSON.stringify(hours)] });
  });
  return ops;
}
