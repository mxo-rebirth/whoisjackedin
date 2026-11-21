// Reads and writes a private S3-compatible bucket. Off without the ARCHIVE_* settings.
import { signRequest } from './s3-sign.js';

/** How long one request may take. A caller with a deadline starts a request only if this much time is left. */
export const REQUEST_MS = 4000;

/**
 * The bucket settings, or null when the archive is not set up or its endpoint cannot be read. Only the endpoint's
 * origin is used. ARCHIVE_REGION defaults to "auto", which some providers expect and others refuse.
 */
export function bucketConfig(env = process.env) {
  const { ARCHIVE_ENDPOINT, ARCHIVE_BUCKET, ARCHIVE_KEY_ID, ARCHIVE_SECRET, ARCHIVE_REGION } = env;
  if (!ARCHIVE_ENDPOINT || !ARCHIVE_BUCKET || !ARCHIVE_KEY_ID || !ARCHIVE_SECRET) return null;
  if (!URL.canParse(ARCHIVE_ENDPOINT)) {
    console.warn('the archive is off: ARCHIVE_ENDPOINT is not an address, such as https://storage.example');
    return null;
  }
  return { origin: new URL(ARCHIVE_ENDPOINT).origin, bucket: ARCHIVE_BUCKET, keyId: ARCHIVE_KEY_ID, secret: ARCHIVE_SECRET, region: ARCHIVE_REGION || 'auto' };
}

async function send(cfg, method, path, { query = '', body = '', type } = {}) {
  const url = `${cfg.origin}/${encodeURIComponent(cfg.bucket)}/${path}${query ? `?${query}` : ''}`;
  const headers = signRequest({ method, url, body, headers: type ? { 'content-type': type } : {}, keyId: cfg.keyId, secret: cfg.secret, region: cfg.region });
  const res = await fetch(url, { method, headers, body: method === 'PUT' ? body : undefined, signal: AbortSignal.timeout(REQUEST_MS) });
  // A missing object is an answer. A missing bucket is not.
  if (method === 'GET' && path && res.status === 404) return null;
  if (res.status === 404) throw new Error(`the bucket "${cfg.bucket}" was not found, check ARCHIVE_BUCKET`);
  if (!res.ok) throw new Error(`the archive answered ${res.status} to ${method} ${path || 'the list'}`);
  return res;
}

/** Saves one object, replacing what was there. */
export async function putObject(cfg, key, body, type = 'text/plain; charset=utf-8') {
  await send(cfg, 'PUT', key, { body, type });
}

/** One object's text, or null when there is none. */
export async function getObject(cfg, key) {
  const res = await send(cfg, 'GET', key);
  return res ? res.text() : null;
}

/** The names of every object under `prefix`. The bucket hands them out a page at a time. */
export async function listObjects(cfg, prefix = '', token = null) {
  const query = new URLSearchParams({ 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) });
  const xml = await (await send(cfg, 'GET', '', { query: query.toString() })).text();
  const names = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map(([, name]) => name.replaceAll('&amp;', '&'));
  const next = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] : null;
  return next ? [...names, ...(await listObjects(cfg, prefix, next))] : names;
}
