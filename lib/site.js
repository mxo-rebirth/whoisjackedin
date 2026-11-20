// The site's own address, for search engines, link previews and the scripts. MXO_SITE sets it. Otherwise
// the host's production domain is used online, and the local server on your own computer.
/** True when running at the host, false on your own computer. */
export const online = () => Boolean(process.env.VERCEL);

export function siteUrl(env = process.env) {
  if (env.MXO_SITE) return env.MXO_SITE.replace(/\/+$/, '');
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return `http://127.0.0.1:${env.PORT ?? 5177}`;
}

/** Settings from .env.local, for the scripts run on your own computer. Values already set win. */
export async function localEnv() {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => '');
  const found = {};
  for (const [, key, value] of text.matchAll(/^([A-Z_][A-Z0-9_]*)="?([^"\n]*)"?$/gm)) found[key] = value;
  return { ...found, ...process.env };
}
