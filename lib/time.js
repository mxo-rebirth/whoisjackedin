// Days and hours in UTC, shared by the sampler, the statistics and the visit counter.
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const DAY_S = DAY_MS / 1000;
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** The UTC days from the day of `from` up to `to`, as "YYYY-MM-DD". */
export function daysBetween(from, to) {
  const days = [];
  for (let t = Date.parse(dayOf(from)); t <= to; t += DAY_MS) days.push(dayOf(t));
  return days;
}
