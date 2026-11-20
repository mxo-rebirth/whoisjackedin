// What one server's latest answer means. Shared by the server, which fills numbers into the page, and the page's script.

/** The status light, its label, and whether the count can be trusted and added up. */
export function statusOf(now) {
  if (!now || now.players === undefined) return { led: 'unknown', text: 'NO SIGNAL', counted: false };
  if (now.unsure) return { led: 'unsure', text: 'TRACING', counted: now.online };
  if (!now.ok) return { led: 'unknown', text: 'NO SIGNAL', counted: false };
  return now.online ? { led: 'good', text: 'ONLINE', counted: true } : { led: 'critical', text: 'OFFLINE', counted: false };
}

export const counted = (now) => Boolean(statusOf(now).counted);
