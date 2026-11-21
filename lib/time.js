// Days and hours in UTC, shared by the sampler, the statistics and the visit counter.
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const DAY_S = DAY_MS / 1000;
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** The start of every hour from the one `from` falls in up to `to`, as times. */
export function hoursBetween(from, to) {
  const first = Math.floor(from / HOUR_MS) * HOUR_MS;
  return Array.from({ length: Math.max(0, Math.floor((to - first) / HOUR_MS) + 1) }, (_, k) => first + k * HOUR_MS);
}

/** The UTC days from the day of `from` up to `to`, as "YYYY-MM-DD". */
export function daysBetween(from, to) {
  const first = Date.parse(dayOf(from));
  const count = Math.max(0, Math.floor((to - first) / DAY_MS) + 1);
  return Array.from({ length: count }, (_, k) => dayOf(first + k * DAY_MS));
}
