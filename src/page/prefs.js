// The visitor's choices, all in one place: this browser's local storage. None of it is sent to the site.
// Keys: theme, accent, together, favourite, range, warned, install-later, and last-stats (the last numbers).
// src/theme.js reads theme and accent itself, because it runs before this script loads.

/** A saved choice, or null. A browser that keeps nothing (private mode, blocked storage) simply has none. */
export function pref(name) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

/** Saves a choice. Null forgets it. */
export function setPref(name, value) {
  try {
    if (value == null) localStorage.removeItem(name);
    else localStorage.setItem(name, String(value));
  } catch {}
}
