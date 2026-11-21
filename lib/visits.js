// Counts visits to the page. No cookies, and no addresses or names are kept: one short line per visit.
import { createHash } from 'node:crypto';
import { DAY_MS, DAY_S, dayOf } from './time.js';
import { dayTotalsKey, visitsKey } from './keys.js';
import { agentCode, namesOf } from './helpers/user-agent.js';
import { appendLine, mget, storeKind } from './store.js';

const KEEP_DAYS = 90;
const DAY_LIMIT_BYTES = 120_000; // about 3,000 visits. Past that the day is full, so a flood cannot use up the database.
const QUIET_MS = 30 * 60_000; // one visitor is counted once per half hour
const MEMORY_MAX = 5000; // visitors and addresses remembered in memory before the copy starts over
const ADDRESS_LIMIT = 20; // visits counted from one address in a day. A home or an office does not make more.
const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|curl|wget|python|node|axios|go-http/i;
const clean = (text, max) => String(text ?? '').replaceAll(/[^\w.-]/g, '').slice(0, max);

// Kept by this running copy of the server only. A new copy starts empty, which at worst counts someone twice.
const seen = new Map();
const perAddress = new Map();
let fullDay = null;
let expiryDay = null;

/**
 * Saves one line for a visit: time, country, phone or desktop, where the visitor came from, a short fingerprint,
 * and two letters for the browser and the system. The fingerprint changes every day and cannot be turned back into
 * an address. True when saved.
 */
export async function recordVisit({ ip, agent, country, referrer, host, secret, now = Date.now() }) {
  if (!storeKind() || !agent || BOT.test(agent)) return false;
  const day = dayOf(now);
  if (fullDay === day) return false;
  const visitor = createHash('sha256').update(`${day}|${ip}|${agent}|${secret}`).digest('hex').slice(0, 10);
  if (now - (seen.get(visitor) ?? 0) < QUIET_MS) return false;
  // One address pretending to be many browsers is stopped here. Only a scrambled form of the address is
  // held, in memory, for the day.
  const address = createHash('sha256').update(`${day}|${ip}|${secret}`).digest('hex').slice(0, 12);
  const counted = perAddress.get(address) ?? 0;
  if (counted >= ADDRESS_LIMIT) return false;
  if (seen.size > MEMORY_MAX) seen.clear();
  if (perAddress.size > MEMORY_MAX) perAddress.clear();
  seen.set(visitor, now);
  perAddress.set(address, counted + 1);

  let from = '';
  try {
    from = referrer ? new URL(referrer).hostname.replace(/^www\./, '') : '';
  } catch {}
  if (from === String(host ?? '').replace(/:\d+$/, '')) from = ''; // a reload of this page is not a referrer
  const device = /Mobi|Android|iPhone|iPad/i.test(agent) ? 'm' : 'd';
  const line = [new Date(now).toISOString().slice(11, 16), clean(country, 2) || '??', device, clean(from, 60), visitor, agentCode(agent)].join(';');
  const size = await appendLine(visitsKey(day), `${line}\n`, expiryDay === day ? null : KEEP_DAYS * DAY_S);
  expiryDay = day;
  if (size > DAY_LIMIT_BYTES) fullDay = day;
  return true;
}

const tally = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
const UNKNOWN = '(unknown)';

/** Counts by name, with the visits they leave out added under "(unknown)". */
function withUnknown(counts = {}, visits = 0) {
  const missing = visits - Object.values(counts).reduce((sum, n) => sum + n, 0);
  return missing > 0 ? { ...counts, [UNKNOWN]: (counts[UNKNOWN] ?? 0) + missing } : counts;
}
const ranked = (map, most = 15) => [...map].toSorted((a, b) => b[1] - a[1]).slice(0, most);

/** One day's visit lines added up: { visits, visitors, countries, devices, referrers, browsers, systems, hours }. */
export function dayTotals(text) {
  const visitors = new Set();
  const totals = { visits: 0, visitors: 0, countries: {}, devices: {}, referrers: {}, browsers: {}, systems: {}, hours: Array(24).fill(0) };
  const add = (bag, key) => (bag[key] = (bag[key] ?? 0) + 1);
  (text ?? '').split('\n').forEach((line) => {
    const [time, country, device, from, visitor, agent] = line.split(';');
    if (!visitor) return;
    totals.visits += 1;
    visitors.add(visitor);
    add(totals.countries, country);
    add(totals.devices, device === 'm' ? 'phone' : 'desktop');
    add(totals.referrers, from || '(direct)');
    // Lines from before browsers and systems were noted have no letters for them.
    const { browser, system } = agent ? namesOf(agent) : { browser: UNKNOWN, system: UNKNOWN };
    add(totals.browsers, browser);
    add(totals.systems, system);
    totals.hours[Number(time.slice(0, 2))] += 1;
  });
  totals.visitors = visitors.size;
  return totals;
}

/**
 * The writes that keep each finished day's totals for good: every day of the last KEEP_DAYS that has visit
 * lines but no saved totals yet. Run once a day, so the first run also fills in the days before it.
 */
export async function keepDailyTotals(now = Date.now()) {
  if (!storeKind()) return [];
  const days = Array.from({ length: KEEP_DAYS }, (_, k) => dayOf(now - (k + 1) * DAY_MS));
  const saved = await mget(days.map(dayTotalsKey));
  const missing = days.filter((_, k) => !saved[k]);
  if (!missing.length) return [];
  const texts = await mget(missing.map(visitsKey));
  return missing.flatMap((day, k) => (texts[k] ? [{ set: [dayTotalsKey(day), JSON.stringify(dayTotals(texts[k]))] }] : []));
}

/** A day's totals: counted from its visit lines while they are kept, then from the totals saved for it. */
function totalsOf(text, kept) {
  if (text) return dayTotals(text);
  return kept ? JSON.parse(kept) : dayTotals('');
}

/**
 * Visits per day for the last `days` days, with countries, devices, referrers, browsers and systems added up. Times are UTC.
 * Recent days are read from their visit lines, older ones from the totals kept for good.
 */
export async function visitSummary(days, now = Date.now()) {
  const names = Array.from({ length: days }, (_, k) => dayOf(now - k * DAY_MS));
  const [texts, kept] = storeKind() ? await Promise.all([mget(names.map(visitsKey)), mget(names.map(dayTotalsKey))]) : [names.map(() => null), names.map(() => null)];
  const countries = new Map();
  const referrers = new Map();
  const devices = new Map();
  const browsers = new Map();
  const systems = new Map();
  const hours = Array.from({ length: 24 }, () => 0);
  const perDay = names.map((day, k) => {
    const totals = totalsOf(texts[k], kept[k]);
    Object.entries(totals.countries).forEach(([key, n]) => tally(countries, key, n));
    Object.entries(totals.devices).forEach(([key, n]) => tally(devices, key, n));
    Object.entries(totals.referrers).forEach(([key, n]) => tally(referrers, key, n));
    // Visits from before browsers and systems were noted count as unknown, so each list adds up to the visits.
    Object.entries(withUnknown(totals.browsers, totals.visits)).forEach(([key, n]) => tally(browsers, key, n));
    Object.entries(withUnknown(totals.systems, totals.visits)).forEach(([key, n]) => tally(systems, key, n));
    totals.hours.forEach((n, hour) => {
      hours[hour] += n;
    });
    return { day, visits: totals.visits, visitors: totals.visitors };
  });
  return {
    days,
    visits: perDay.reduce((sum, day) => sum + day.visits, 0),
    // The fingerprint changes daily, so someone who comes on two days counts once on each.
    visitors: perDay.reduce((sum, day) => sum + day.visitors, 0),
    perDay,
    countries: ranked(countries),
    countryCount: [...countries.keys()].filter((code) => code !== '??').length,
    phoneVisits: devices.get('phone') ?? 0,
    referrers: ranked(referrers),
    devices: ranked(devices),
    browsers: ranked(browsers),
    systems: ranked(systems),
    hoursUtc: hours,
  };
}
