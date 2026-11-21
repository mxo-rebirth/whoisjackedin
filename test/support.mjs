// What the tests share: a throwaway data folder and made-up answers from the servers.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

export const MINUTE = 60_000;

/** A fresh data folder for this test file, gone when it ends. Call it before importing the code under test. */
export async function useTempStore(name) {
  const dir = await mkdtemp(path.join(tmpdir(), `mxo-${name}-`));
  process.env.MXO_DATA_DIR = dir;
  delete process.env.KV_REST_API_URL;
  after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A server that is up with this many players. */
export const up = (players) => ({ ok: true, online: true, players, checkedAt: null, details: [] });

/** One round of answers: the first server gets `first`, the second `second`, the rest are up with one player. */
export const roundOf = (servers) => (first, second = up(1)) => servers.map((_, i) => [first, second][i] ?? up(1));
