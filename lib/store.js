// A tiny key-value store: Upstash Redis on Vercel, plain files on your own machine.
import path from 'node:path';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';

function config() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return { kind: 'redis', url: url.replace(/\/$/, ''), token };
  if (process.env.MXO_DATA_DIR) return { kind: 'files', dir: process.env.MXO_DATA_DIR };
  return { kind: null };
}

/** 'redis', 'files', or null when nothing is connected. */
export const storeKind = () => config().kind;

async function redis({ url, token }, commands) {
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`storage answered ${res.status}`);
  const replies = await res.json();
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

/**
 * Like mget, but a key read in the last half minute comes from memory. Every range and time zone reads the
 * same few keys, so without this, repeated requests could use up the database's monthly allowance.
 */
export async function mgetRecent(keys) {
  const now = Date.now();
  const due = keys.filter((key) => !(recent.get(key)?.at > now - RECENT_MS));
  if (due.length) {
    const values = await mget(due);
    if (recent.size > 2000) recent.clear();
    due.forEach((key, i) => recent.set(key, { at: now, value: values[i] }));
  }
  return keys.map((key) => recent.get(key)?.value ?? null);
}

/**
 * Applies writes in order. Each one is { set: [key, value, ttlSeconds?] } or { append: [key, value, ttlSeconds?] }.
 * The file store keeps everything and ignores ttl.
 */
export async function write(ops) {
  const cfg = config();
  // What is written here is read fresh the next time.
  for (const op of ops) recent.delete((op.set ?? op.append)[0]);
  if (cfg.kind === 'redis') {
    const commands = [];
    for (const op of ops) {
      const [key, value, ttl] = op.set ?? op.append;
      if (op.set) commands.push(ttl ? ['SET', key, value, 'EX', ttl] : ['SET', key, value]);
      else {
        commands.push(['APPEND', key, value]);
        if (ttl) commands.push(['EXPIRE', key, ttl]);
      }
    }
    await redis(cfg, commands);
    return;
  }
  if (cfg.kind === 'files') {
    await mkdir(cfg.dir, { recursive: true });
    for (const op of ops) {
      const [key, value] = op.set ?? op.append;
      await (op.set ? writeFile : appendFile)(fileFor(cfg.dir, key), value);
    }
    return;
  }
  throw new Error('no storage is connected');
}

/** Adds text to the end of a key and returns how long the key now is, in bytes. */
export async function appendLine(key, value, ttlSeconds) {
  const cfg = config();
  if (cfg.kind === 'redis') {
    const commands = [['APPEND', key, value]];
    if (ttlSeconds) commands.push(['EXPIRE', key, ttlSeconds]);
    return (await redis(cfg, commands))[0];
  }
  if (cfg.kind === 'files') {
    await mkdir(cfg.dir, { recursive: true });
    await appendFile(fileFor(cfg.dir, key), value);
    return (await stat(fileFor(cfg.dir, key))).size;
  }
  throw new Error('no storage is connected');
}
