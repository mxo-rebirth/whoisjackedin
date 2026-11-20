// A tiny key-value store: Redis over its REST API online, plain files on your own machine.
import path from 'node:path';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';

function config() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return { kind: 'redis', url: url.replace(/\/$/, ''), token };
  if (process.env.MXO_DATA_DIR) return { kind: 'files', dir: process.env.MXO_DATA_DIR };
  return { kind: null };
}

/** 'redis', 'files', or null when nothing is connected. */
export const storeKind = () => config().kind;

/**
 * Sends commands over the REST API. `atomic` runs them as one transaction (all or nothing), for writes that
 * must not land halfway. Both endpoints answer with one { result } or { error } per command.
 */
async function redis({ url, token }, commands, { atomic = false } = {}) {
  const res = await fetch(`${url}/${atomic ? 'multi-exec' : 'pipeline'}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`storage answered ${res.status}`);
  const replies = await res.json();
  if (!Array.isArray(replies)) throw new Error(`storage error: ${replies?.error ?? 'unexpected answer'}`);
  const failed = replies.find((reply) => reply.error);
  if (failed) throw new Error(`storage error: ${failed.error}`);
  return replies.map((reply) => reply.result);
}

const fileFor = (dir, key) => path.join(dir, key.replace(/[^A-Za-z0-9._-]/g, '_'));

/** True when this caller got the lock. The lock frees itself after ttlSeconds. Files have one writer, so they always get it. */
export async function lock(key, ttlSeconds) {
  const cfg = config();
  if (cfg.kind !== 'redis') return true;
  return (await redis(cfg, [['SET', key, '1', 'NX', 'EX', ttlSeconds]]))[0] === 'OK';
}

/** Frees a lock early, when its holder turns out to have nothing to do. */
export async function unlock(key) {
  const cfg = config();
  if (cfg.kind === 'redis') await redis(cfg, [['DEL', key]]);
}

/** Values for the keys, in order. A missing key gives null. */
export async function mget(keys) {
  const cfg = config();
  if (!keys.length) return [];
  if (cfg.kind === 'redis') return (await redis(cfg, [['MGET', ...keys]]))[0];
  if (cfg.kind === 'files') {
    return Promise.all(keys.map((key) => readFile(fileFor(cfg.dir, key), 'utf8').catch(() => null)));
  }
  throw new Error('no storage is connected');
}

// What was read in the last half minute, kept by this running copy of the server.
const recent = new Map();
const RECENT_MS = 30_000;
const RECENT_MAX = 2000; // keys kept in memory before the copy starts over

/**
 * Like mget, but a key read in the last half minute comes from memory. Every range and time zone reads the
 * same few keys, so without this, repeated requests could use up the database's monthly allowance.
 */
export async function mgetRecent(keys, { since = 0 } = {}) {
  const now = Date.now();
  // `since`: a copy read before then is too old, even if it is younger than RECENT_MS.
  const due = keys.filter((key) => !(recent.get(key)?.at > Math.max(now - RECENT_MS, since)));
  if (due.length) {
    const values = await mget(due);
    if (recent.size > RECENT_MAX) recent.clear();
    due.forEach((key, i) => recent.set(key, { at: now, value: values[i] }));
  }
  return keys.map((key) => recent.get(key)?.value ?? null);
}

/**
 * Applies writes in order, all or nothing online. Each one is { set: [key, value, ttlSeconds?] } or
 * { append: [key, value, ttlSeconds?] }. Returns, per write, what it gave back: "OK" for a set, the new length
 * in bytes for an append. The file store keeps everything and ignores ttl.
 */
export async function write(ops) {
  const cfg = config();
  // What is written here is read fresh the next time.
  for (const op of ops) recent.delete((op.set ?? op.append)[0]);
  if (cfg.kind === 'redis') {
    const commands = [];
    const answerAt = [];
    for (const op of ops) {
      const [key, value, ttl] = op.set ?? op.append;
      answerAt.push(commands.length);
      if (op.set) commands.push(ttl ? ['SET', key, value, 'EX', ttl] : ['SET', key, value]);
      else {
        commands.push(['APPEND', key, value]);
        if (ttl) commands.push(['EXPIRE', key, ttl]);
      }
    }
    const replies = await redis(cfg, commands, { atomic: commands.length > 1 });
    return answerAt.map((i) => replies[i]);
  }
  if (cfg.kind === 'files') {
    await mkdir(cfg.dir, { recursive: true });
    const answers = [];
    for (const op of ops) {
      const [key, value] = op.set ?? op.append;
      const file = fileFor(cfg.dir, key);
      if (op.set) {
        await writeFile(file, value);
        answers.push('OK');
      } else {
        await appendFile(file, value);
        answers.push((await stat(file)).size);
      }
    }
    return answers;
  }
  throw new Error('no storage is connected');
}

/** Adds text to the end of a key and returns how long the key now is, in bytes. */
export async function appendLine(key, value, ttlSeconds) {
  return (await write([{ append: [key, value, ttlSeconds] }]))[0];
}
