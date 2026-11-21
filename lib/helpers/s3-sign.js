// Signs requests to S3-compatible storage (AWS Signature Version 4), so no SDK is needed.
import { createHash, createHmac } from 'node:crypto';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
// S3 encodes these characters too, which encodeURIComponent leaves as they are.
const encode = (text) => encodeURIComponent(text).replaceAll(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const byCode = (a, b) => (a < b ? -1 : Number(a > b));

/** The query in the order and encoding the signature is computed over. */
function canonicalQuery(address) {
  const pairs = [...address.searchParams].map(([name, value]) => [encode(name), encode(value)]);
  return pairs
    .toSorted(([a, x], [b, y]) => byCode(a, b) || byCode(x, y))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/**
 * The headers that sign one request: `x-amz-date`, `x-amz-content-sha256`, `authorization` and the ones passed in.
 * `host` is signed but not returned, since the request sets it itself.
 */
export function signRequest({ method, url, headers = {}, body = '', keyId, secret, region = 'auto', now = new Date() }) {
  const address = new URL(url);
  const amzDate = now.toISOString().replaceAll(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()]));
  const signed = { ...lower, host: address.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(signed).toSorted(byCode);
  const canonical = [method, address.pathname, canonicalQuery(address), names.map((name) => `${name}:${signed[name]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const key = ['aws4_request'].reduce(hmac, hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'));
  const signature = createHmac('sha256', key).update(['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')).digest('hex');
  const sent = Object.fromEntries(Object.entries(signed).filter(([name]) => name !== 'host'));
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}
