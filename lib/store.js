// A tiny key-value store: Redis over its REST API online, plain files on your own machine.
import path from 'node:path';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { inOrder } from './helpers/in-order.js';

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
  if (!Array.isArray(replies)) throw new TypeError(`storage error: ${replies?.error ?? 'unexpected answer'}`);
  const failed = replies.find((reply) => reply.error);
  if (failed) throw new Error(`storage error: ${failed.error}`);
  return replies.map((reply) => reply.result);
}

const fileFor = (dir, key) => path.join(dir, key.replaceAll(/[^A-Za-z0-9._-]/g, '_'));

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
  const due = keys.filter((key) => (recent.get(key)?.at ?? -Infinity) <= Math.max(now - RECENT_MS, since));
  if (due.length) {
    const values = await mget(due);
    if (recent.size > RECENT_MAX) recent.clear();
    due.forEach((key, i) => recent.set(key, { at: now, value: values[i] }));
  }
  return keys.map((key) => recent.get(key)?.value ?? null);
}

/**
 * Applies { set } and { append } writes, each [key, value, ttlSeconds?], in order and all or nothing online.
 * Returns "OK" for a set and the new length in bytes for an append. The file store ignores ttl.
 */
export async function write(ops) {
  const cfg = config();
  // What is written here is read fresh the next time.
  ops.forEach((op) => recent.delete((op.set ?? op.append)[0]));
  if (cfg.kind === 'redis') return writeRedis(cfg, ops);
  if (cfg.kind === 'files') return writeFiles(cfg, ops);
  throw new Error('no storage is connected');
}

/** The Redis commands for one write. An append with a ttl needs a second command. */
function commandsOf(op) {
  const [key, value, ttl] = op.set ?? op.append;
  if (op.set) return [ttl ? ['SET', key, value, 'EX', ttl] : ['SET', key, value]];
  return ttl ? [['APPEND', key, value], ['EXPIRE', key, ttl]] : [['APPEND', key, value]];
}

async function writeRedis(cfg, ops) {
  const perOp = ops.map(commandsOf);
  const commands = perOp.flat();
  const replies = await redis(cfg, commands, { atomic: commands.length > 1 });
  // Each write's answer is the reply to its first command.
  let next = 0;
  return perOp.map((list) => {
    const first = next;
    next += list.length;
    return replies[first];
  });
}

async function writeFiles(cfg, ops) {
  await mkdir(cfg.dir, { recursive: true });
  // In order, since two writes can go to the same file.
  return inOrder(ops, async (op) => {
    const [key, value] = op.set ?? op.append;
    const file = fileFor(cfg.dir, key);
    if (op.set) {
      await writeFile(file, value);
      return 'OK';
    }
    await appendFile(file, value);
    return (await stat(file)).size;
  });
}

/** Adds text to the end of a key and returns how long the key now is, in bytes. */
export async function appendLine(key, value, ttlSeconds) {
  return (await write([{ append: [key, value, ttlSeconds] }]))[0];
}
