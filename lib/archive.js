// Copies every finished day to a private bucket, so the minute log outlives its few days in the database and
// every view can be rebuilt from it. Visit lines stay out: only the daily visit totals are kept for good.
import { REQUEST_MS, bucketConfig, getObject, listObjects, putObject } from './helpers/bucket.js';
import { inOrder } from './helpers/in-order.js';
import { STATE_KEY, dayTotalsKey, hoursKey, rawKey } from './keys.js';
import { mget } from './store.js';
import { DAY_MS, daysBetween } from './time.js';

const DAYS_PER_RUN = 5;
const TEXT = 'text/plain; charset=utf-8';
const JSON_TYPE = 'application/json';

/** The folders of the bucket, each with the database key its files belong under and their type. */
const FOLDERS = {
  raw: { key: rawKey, ending: 'txt', type: TEXT },
  hours: { key: hoursKey, ending: 'json', type: JSON_TYPE },
  visits: { key: dayTotalsKey, ending: 'json', type: JSON_TYPE },
};
/** The latest state, replaced on every run that copies a day. */
export const STATE_FILE = 'state/latest.json';

const fileName = (folder, day) => `${folder}/${day}.${FOLDERS[folder].ending}`;

/**
 * The days to copy next, oldest first: from the start of the record, or the day after the last one copied, up
 * to the day before yesterday, and never the sampler's current day. By then every part of a day is final.
 */
export function daysToArchive(state, now) {
  if (!state.since) return [];
  const first = state.archived ? Date.parse(state.archived) + DAY_MS : state.since;
  const last = Math.min(now - 2 * DAY_MS, state.today ? Date.parse(state.today) - DAY_MS : now);
  return daysBetween(first, last).slice(0, DAYS_PER_RUN);
}

/** The files of one day, leaving out the parts the database no longer has. */
function filesOf(day, saved) {
  return Object.keys(FOLDERS)
    .map((folder, k) => [fileName(folder, day), saved[k], FOLDERS[folder].type])
    .filter(([, body]) => body);
}

/**
 * Copies the days that are due and gives back the last day copied, to be kept in the state. It never throws: a
 * failure stops the copying, is logged, and is tried again on the next run. Copying a day twice does no harm.
 * A day is only started if a whole request still fits before `until`.
 */
export async function archiveDays(state, now = Date.now(), { until = Infinity, cfg } = {}) {
  const copied = [];
  let step = 'the days due';
  try {
    const bucket = cfg === undefined ? bucketConfig() : cfg;
    const days = bucket ? daysToArchive(state, now) : [];
    if (!days.length) return state.archived ?? null;
    const folders = Object.values(FOLDERS);
    const saved = await mget(days.flatMap((day) => folders.map((folder) => folder.key(day))));
    const fits = () => Date.now() + REQUEST_MS <= until;
    await inOrder(days, async (day) => {
      if (!fits()) return;
      step = day;
      const k = days.indexOf(day) * folders.length;
      await Promise.all(filesOf(day, saved.slice(k, k + folders.length)).map(([name, body, type]) => putObject(bucket, name, body, type)));
      copied.push(day);
    });
    step = 'the state';
    if (copied.length && fits()) await putObject(bucket, STATE_FILE, JSON.stringify(state), JSON_TYPE);
  } catch (err) {
    console.warn(`could not archive ${step}: ${err.message}`);
  }
  return copied.at(-1) ?? state.archived ?? null;
}

/** The database key an archived file belongs under, with its folder, or null for anything else in the bucket. */
function placeOf(name) {
  if (name === STATE_FILE) return { folder: 'state', key: STATE_KEY };
  const found = /^(\w+)\/(\d{4}-\d{2}-\d{2})\.(\w+)$/.exec(name);
  const [, folder, day, ending] = found ?? [];
  if (!Object.hasOwn(FOLDERS, folder ?? '') || FOLDERS[folder].ending !== ending) return null;
  return { folder, key: FOLDERS[folder].key(day) };
}

/**
 * Every archived file as a write that puts it back where the database keeps it, and how many came from each
 * folder. A file that disappears between the listing and the reading is left out.
 */
export async function archivedWrites(cfg = bucketConfig()) {
  const wanted = (await listObjects(cfg)).map((name) => [name, placeOf(name)]).filter(([, place]) => place);
  const read = await inOrder(wanted, async ([name, place]) => ({ place, body: await getObject(cfg, name) }));
  const found = read.filter(({ body }) => body !== null);
  const counts = Object.fromEntries(['raw', 'hours', 'visits', 'state'].map((folder) => [folder, found.filter(({ place }) => place.folder === folder).length]));
  return { writes: found.map(({ place, body }) => ({ set: [place.key, body] })), counts };
}
