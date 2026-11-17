// Counts visits to the page. No cookies, and no addresses or names are kept: one short line per visit.
import { createHash } from 'node:crypto';
import { dayOf } from './core.js';
import { appendLine, mget, storeKind } from './store.js';

const KEEP_DAYS = 90;
const DAY_LIMIT_BYTES = 120_000; // about 3,000 visits. Past that the day is full, so a flood cannot use up the database.
const QUIET_MS = 30 * 60_000; // one visitor is counted once per half hour
const ADDRESS_LIMIT = 20; // visits counted from one address in a day. A home or an office does not make more.
const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|curl|wget|python|node|axios|go-http/i;
const visitsKey = (day) => `mxo:visits:${day}`;
const clean = (text, max) => String(text ?? '').replace(/[^\w.-]/g, '').slice(0, max);

// Kept by this running copy of the server only. A new copy starts empty, which at worst counts someone twice.
const seen = new Map();
const perAddress = new Map();
let fullDay = null;
let expiryDay = null;

/**
 * Saves one line for a visit: time, country, phone or desktop, where the visitor came from, and a short
 * fingerprint. The fingerprint changes every day and cannot be turned back into an address. True when saved.
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
  if (seen.size > 5000) seen.clear();
  if (perAddress.size > 5000) perAddress.clear();
  seen.set(visitor, now);
  perAddress.set(address, counted + 1);

  let from = '';
  try {
    from = referrer ? new URL(referrer).hostname.replace(/^www\./, '') : '';
  } catch {}
  if (from === String(host ?? '').replace(/:\d+$/, '')) from = ''; // a reload of this page is not a referrer
  const device = /Mobi|Android|iPhone|iPad/i.test(agent) ? 'm' : 'd';
  const line = [new Date(now).toISOString().slice(11, 16), clean(country, 2) || '??', device, clean(from, 60), visitor].join(';');
  const size = await appendLine(visitsKey(day), `${line}\n`, expiryDay === day ? null : KEEP_DAYS * 86_400);
  expiryDay = day;
  if (size > DAY_LIMIT_BYTES) fullDay = day;
  return true;
}

const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const ranked = (map, most = 15) => [...map].sort((a, b) => b[1] - a[1]).slice(0, most);

/** Visits per day for the last `days` days, with countries, devices and referrers added up. Times are UTC. */
export async function visitSummary(days, now = Date.now()) {
  const names = Array.from({ length: days }, (_, k) => dayOf(now - k * 86_400_000));
  const texts = storeKind() ? await mget(names.map(visitsKey)) : names.map(() => null);
  const countries = new Map();
  const referrers = new Map();
  const devices = new Map();
  const hours = Array.from({ length: 24 }, () => 0);
  const perDay = names.map((day, k) => {
    const visitors = new Set();
    let visits = 0;
    for (const line of (texts[k] ?? '').split('\n')) {
      const [time, country, device, from, visitor] = line.split(';');
      if (!visitor) continue;
      visits += 1;
      visitors.add(visitor);
      tally(countries, country);
      tally(devices, device === 'm' ? 'phone' : 'desktop');
      tally(referrers, from || '(direct)');
      hours[Number(time.slice(0, 2))] += 1;
    }
    return { day, visits, visitors: visitors.size };
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
    hoursUtc: hours,
  };
}
