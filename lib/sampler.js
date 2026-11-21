// Takes samples of the servers and saves them: the state with today's totals, and a line per minute.
import { SERVERS, readAll, readCommunities } from './sources.js';
import { lock, mget, unlock, write } from './store.js';
import { DAY_MS, DAY_S, HOUR_MS, dayOf, daysBetween } from './time.js';
import { LOCK_KEY, STATE_KEY, damagedKey, hoursKey, rawKey } from './keys.js';
import { keepDailyTotals } from './visits.js';
import { archiveDays } from './archive.js';

export const SAMPLE_MS = 60_000;
// The feeds are read at most this often, whoever asks. Under a minute, since the scheduler drifts a few seconds.
const MIN_GAP_MS = 30_000;
export const SILENCE_MS = 3 * SAMPLE_MS; // longer than this without samples means "not recording", not an outage
export const CONFIRM_CHECKS = 15; // bad answers in a row before a server counts as down: about 15 minutes
export const CARRY_MS = 15 * 60_000; // how long the last real reading may stand in for a missing or doubtful one
export const RAW_KEEP_DAYS = 9;
const COMMUNITY_MS = HOUR_MS; // how often the Discord sizes are refreshed
const COMMUNITY_RETRY_MS = 5 * 60_000; // how often, while a server has no size yet
const OUTAGES_KEPT = 20; // per server
const DAMAGED_KEEP_S = 30 * DAY_S; // a damaged saved value is set aside this long, for a look by hand

const LOCK_SECONDS = 25; // shorter than MIN_GAP_MS, so it never blocks the next sample
// The archive gets what is left of this after the reading is saved. The whole run stays inside the function's 20 s.
const ARCHIVE_WITHIN_MS = 15_000;

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
 * Replaces one server's stand-ins between `from` and `to` with what the outage was: "-" for no answer, "0:0" for
 * down. Any online reading inside a confirmed outage is a stand-in, since every real answer in it was bad.
 */
export function cleanStandIns(text, code, from, to, kind) {
  const entry = new RegExp(`(^|;)${code}1:\\d+(?=;|$)`);
  let changed = 0;
  const lines = (text ?? '').split('\n').map((line) => {
    const t = Number(line.split(';')[0]) * 1000;
    if (!t || t < from || t >= to || !entry.test(line)) return line;
    changed += 1;
    return line.replace(entry, (_, head) => `${head}${code}${kind === 'offline' ? '0:0' : '-'}`);
  });
  return { text: lines.join('\n'), changed };
}

/**
 * Folds one round of answers into the state. Returns the line to save, any day that just ended, the outages
 * confirmed in this round (their stand-in lines need cleaning) and stand-ins on days already saved.
 */
export function applySample(state, now, results) {
  const today = dayOf(now);
  const finished = state.today && state.today !== today ? { day: state.today, hours: state.hours } : null;
  if (state.today !== today) {
    state.today = today;
    state.hours = {};
  }
  const round = {
    state,
    now,
    today,
    finished,
    hour: new Date(now).getUTCHours(),
    silence: state.lastT !== null && now - state.lastT > SILENCE_MS,
    parts: [Math.round(now / 1000)],
    total: null,
    confirmed: [],
    late: [],
  };
  SERVERS.forEach((server, i) => applyAnswer(round, server, results[i]));

  if (round.total !== null && (state.total?.recordPeak ?? -1) < round.total) state.total = { recordPeak: round.total, recordAt: now };
  state.since ??= now;
  state.checks += 1;
  state.lastT = now;
  return { rawLine: `${round.parts.join(';')}\n`, finished, confirmed: round.confirmed, late: round.late };
}

/** What a bad answer says about the server: "unknown" without an answer, "offline" when it says so, null when fine. */
function badKind(answer) {
  if (!answer.ok) return 'unknown';
  return answer.online ? null : 'offline';
}

/** One server's answer in this round. */
function applyAnswer(round, server, answer) {
  const { state, now } = round;
  const all = (state.all[server.id] ??= { recordPeak: null, recordAt: null, lastPlayersAt: null, run: null, outages: [] });
  // "Asked too often" says nothing about the server: keep everything as it is. It is noted as a gap.
  if (answer.limited) {
    noteGap(all, { kind: 'limited', from: now, to: now + SAMPLE_MS, checks: 1, detail: 'asked too often' });
    carry(round, server);
    return;
  }
  const kind = badKind(answer);
  if (all.run && (round.silence || !kind)) closeRun(all, round.silence ? all.run.last + SAMPLE_MS : now);
  if (kind && !countBadAnswer(round, server, all, answer, kind)) return;
  if (!answer.ok) {
    // Confirmed: keep the last known numbers and say the feed is not answering.
    state.latest[server.id] = { ...state.latest[server.id], ok: false, unsure: false, error: answer.error, failedAt: now };
    round.parts.push(`${server.code}-`);
    return;
  }
  keepAnswer(round, server, all, answer);
}

/** Adds one counted reading to this hour's totals and to the saved line. */
function record(round, server, online, players, standIn = false) {
  const hours = (round.state.hours[server.code] ??= {});
  const slot = (hours[round.hour] ??= [0, 0, 0, 0]);
  slot[0] += players;
  slot[1] += 1;
  slot[2] += online ? 1 : 0;
  slot[3] = Math.max(slot[3], players);
  // A stand-in repeats an old count, so it cannot set the all-servers record.
  if (!standIn) round.total = (round.total ?? 0) + players;
  round.parts.push(`${server.code}${online ? 1 : 0}:${players}`);
}

/** With no usable answer, the last real reading stands in while it is still recent. True when it did. */
function carry(round, server) {
  const last = round.state.latest[server.id];
  const recent = Boolean(last?.ok && last.players !== undefined && round.now - last.at <= CARRY_MS);
  if (recent) record(round, server, last.online, last.players, true);
  else round.parts.push(`${server.code}-`);
  return recent;
}

/** Adds a bad answer to the server's streak. False while the streak is still too short to call an outage. */
function countBadAnswer(round, server, all, answer, kind) {
  const { state, now, today, hour } = round;
  // A stale page says when it stopped, so the streak starts there.
  const run = (all.run ??= { from: Math.min(now, answer.since ?? now), last: now, checks: 0, offline: 0, detail: null, carried: [] });
  run.last = now;
  run.checks += 1;
  run.offline = offlineCount({ ...run, checks: run.checks - 1 }) + (kind === 'offline' ? 1 : 0);
  run.detail ??= String(answer.ok ? (answer.details?.[0]?.value ?? 'not live') : answer.error).slice(0, 60);
  if (run.checks < CONFIRM_CHECKS) {
    // Not confirmed yet: keep showing the last known numbers, and count them for this sample too.
    const last = state.latest[server.id];
    state.latest[server.id] = { ...last, unsure: true, unsureSince: run.from, unsureDetail: run.detail };
    if (carry(round, server)) run.carried = [...(run.carried ?? []), [today, hour, last.online ? 1 : 0, last.players]];
    return false;
  }
  if (run.checks === CONFIRM_CHECKS) takeBackStandIns(round, server, run);
  return true;
}

/** The hour's totals a stand-in was counted in, when they are still at hand. */
function slotOf(round, code, day, at) {
  if (day === round.today) return round.state.hours[code]?.[at];
  if (day === round.finished?.day) return round.finished.hours[code]?.[at];
  return null;
}

/**
 * The outage is confirmed, so the readings counted while it was in doubt are taken back out: from today's totals
 * here, from a day that ended meanwhile by the caller, which has that day's totals.
 */
function takeBackStandIns(round, server, run) {
  const unknown = kindOf(run) === 'unknown';
  (run.carried ?? []).forEach(([day, at, online, players]) => {
    const fix = { code: server.code, day, at, online, players, unknown };
    const slot = slotOf(round, server.code, day, at);
    if (slot) takeOut(slot, fix);
    else if (day !== round.today) round.late.push(fix);
  });
  round.confirmed.push({ code: server.code, from: run.from, to: round.now, kind: kindOf(run) });
  run.carried = [];
}

/** A good answer: the latest numbers, the server's record and this hour's totals. */
function keepAnswer(round, server, all, answer) {
  const { state, now } = round;
  state.latest[server.id] = { ok: true, online: answer.online, players: answer.players, checkedAt: answer.checkedAt, details: answer.details, at: now };
  if (all.recordPeak === null || answer.players > all.recordPeak) {
    all.recordPeak = answer.players;
    all.recordAt = now;
  }
  if (answer.players > 0) all.lastPlayersAt = now;
  record(round, server, answer.online, answer.players);
}

/** A saved value, parsed. A damaged one is reported and read as missing (undefined), so one bad write cannot stop the site. */
export function parseSaved(text, key) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`the saved ${key} is damaged: ${err.message}`);
    return;
  }
}

/** The saved state. A damaged one is copied aside and the sampler starts afresh, rather than failing every minute. */
async function loadState() {
  const [saved] = await mget([STATE_KEY]);
  const state = parseSaved(saved, STATE_KEY);
  if (state !== undefined) return state;
  await write([{ set: [damagedKey(STATE_KEY, Date.now()), saved, DAMAGED_KEEP_S] }]);
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
  const started = Date.now();
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
    const totals = await keepDailyTotals(now).catch((err) => {
      console.warn(`could not keep the visit totals: ${err.message}`);
      return [];
    });
    ops.push(...totals);
  }
  await write(ops);
  // The archive comes after the reading is saved, so a slow or failing bucket can never cost a reading, and a
  // finished day's totals are written before the day is copied.
  const archived = await archiveDays(state, now, { until: started + ARCHIVE_WITHIN_MS });
  if (archived !== (state.archived ?? null)) {
    state.archived = archived;
    await write([{ set: [STATE_KEY, JSON.stringify(state)] }]).catch((err) => console.warn(`could not note the archive's progress: ${err.message}`));
  }
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
    const { text, changed } = confirmed.reduce(
      (done, c) => {
        const result = cleanStandIns(done.text, c.code, c.from, c.to, c.kind);
        return { text: result.text, changed: done.changed + result.changed };
      },
      { text: saved[d], changed: 0 },
    );
    if (changed) ops.push({ set: [rawKey(day), text, rawTtl(day, now)] });
  });
  hourDays.forEach((day, d) => {
    const hours = parseSaved(saved[rawDays.length + d], hoursKey(day));
    if (!hours) return;
    late
      .filter((fix) => fix.day === day && hours[fix.code]?.[fix.at])
      .forEach((fix) => takeOut(hours[fix.code][fix.at], fix));
    ops.push({ set: [hoursKey(day), JSON.stringify(hours)] });
  });
  return ops;
}
