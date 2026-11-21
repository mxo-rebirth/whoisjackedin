// Every name the data is saved under, in one place.

export const STATE_KEY = 'mxo:state';
export const LOCK_KEY = 'mxo:lock';
/** One line per reading, kept for a few days. */
export const rawKey = (day) => `mxo:raw:${day}`;
/** One finished day's hourly totals, kept for good. */
export const hoursKey = (day) => `mxo:hours:${day}`;
/** One line per visit, kept for 90 days. */
export const visitsKey = (day) => `mxo:visits:${day}`;
/** One finished day's visit totals, kept for good. */
export const dayTotalsKey = (day) => `mxo:visitday:${day}`;
/** A saved value that could not be read, set aside for a look by hand. */
export const damagedKey = (key, at) => `mxo:damaged:${key}:${at}`;
