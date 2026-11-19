// Words and numbers: dates, times, lengths of time and counts, in the viewer's language and time zone.
import { stats } from './state.js';

export const DAY = 86400e3;

// Days are counted in the viewer's time zone, to the nearest whole hour.
export const TZ_HOURS = Math.max(-12, Math.min(14, Math.round(-new Date().getTimezoneOffset() / 60)));

export const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });

export const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

export const monthDayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

// Days arrive as calendar dates stored at midnight UTC, so they are printed without shifting them.
export const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const dayTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const fullDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });

export const dayLabel = (date) => `${weekdayFmt.format(date)} ${date.getDate()}`;

export const hourLabel = (hour) => hourFmt.format(new Date(2024, 0, 1, hour % 24));

// Operatives are shown whole: half an operative confuses more than it tells. An average above zero
// that rounds to nothing shows as "<1", since a bar is drawn for it and "0" would be wrong.
export const whole = (value) => (value > 0 && value < 0.5 ? '<1' : String(Math.round(value)));

export const players = (n) => `${n} ${n === 1 ? 'operative' : 'operatives'}`;

export const percent = (share) => {
  const pct = share * 100;
  return `${pct === 100 || pct === 0 ? pct : pct.toFixed(1)}%`;
};

/** Downtime in words, from how many checks were answered and how many of those found the server up. */

export const downtime = (answered, online) => (answered === online ? 'no downtime' : `down for ${duration((answered - online) * stats.sampleSeconds * 1000)}`);

export const ago = (t) => (stats.now - t < 90e3 ? 'just now' : `${duration(stats.now - t)} ago`);

export function duration(ms) {
  const minutes = ms / 60000;
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 24 * 60) return `${(minutes / 60).toFixed(1)} h`;
  const days = Number((minutes / 1440).toFixed(1));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function niceStep(raw, wholeNumbers) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / power;
  const step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
  return wholeNumbers ? Math.max(1, step) : step;
}

export const MINUTE = 60e3;

// 5.0 reads as 5, anything else keeps one decimal.
export const amount = (value) => String(Math.round(value * 10) / 10);
