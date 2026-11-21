// Each server's status feed is read into the same shape: online, players, checkedAt, details.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SERVERS } from '../lib/sources.js';

const server = (id) => SERVERS.find((s) => s.id === id);
const fails = (id, feed) => assert.throws(() => server(id).read(feed));

test('every server has a unique id and one-letter code', () => {
  assert.equal(new Set(SERVERS.map((s) => s.id)).size, SERVERS.length);
  assert.equal(new Set(SERVERS.map((s) => s.code)).size, SERVERS.length);
  for (const s of SERVERS) assert.match(s.code, /^[a-z]$/);
});

test('Rejacked', () => {
  const r = server('rejacked').read({ status: { online: true, playersOnline: 5, checkedAt: '2026-11-18T10:00:00Z' }, launcher: { latestVersion: '0.5.0' } });
  assert.deepEqual([r.online, r.players, r.checkedAt], [true, 5, '2026-11-18T10:00:00Z']);
  assert.deepEqual(r.details.map((d) => d.label), ['World', 'Launcher']);
  fails('rejacked', {});
  fails('rejacked', { status: { online: true, playersOnline: -1 } });
  // When the server is down the count is null.
  const down = server('rejacked').read({ status: { online: false, playersOnline: null, checkedAt: '2026-11-18T16:53:58Z' } });
  assert.deepEqual([down.online, down.players], [false, 0]);
});

test('MxO Revived: anything but "live" is maintenance, with nobody on', () => {
  assert.deepEqual(server('revived').read({ status: 'live', onlinePlayers: 4 }).players, 4);
  const down = server('revived').read({ status: 'maintenance' });
  assert.deepEqual([down.online, down.players, down.details[0]], [false, 0, { label: 'Status', value: 'maintenance' }]);
  fails('revived', { status: 'live' });
  fails('revived', {});
});

test('MxOEmu: worlds and districts are added up', () => {
  const r = server('mxoemu').read({ servers: [{ name: 'Reality', status: 1, numPlayers: 3, districts: { Richland: 2, Downtown: 1 } }] });
  assert.deepEqual([r.online, r.players], [true, 3]);
  assert.deepEqual(r.details, [{ label: 'World', value: 'Reality' }, { label: 'Districts', value: 'Richland 2, Downtown 1' }]);
  const off = server('mxoemu').read({ servers: [{ name: 'Reality', status: 0, numPlayers: 7 }] });
  assert.deepEqual([off.online, off.players], [false, 0]);
  fails('mxoemu', { servers: [] });
});

test('openMXO: only the state and the length of the list are read', () => {
  const r = server('openmxo').read({ state: 'live', ageMs: 2000, updatedUnixMs: Date.now(), players: [{ name: 'someone', x: 1 }, {}] });
  assert.deepEqual([r.online, r.players], [true, 2]);
  assert.ok(!JSON.stringify(r).includes('someone'));
  assert.deepEqual(server('openmxo').read({ state: 'stopped', players: [] }).online, false);
  fails('openmxo', { state: 'live', ageMs: 40_000, players: [] }); // stale
  fails('openmxo', { state: 'unavailable', players: [] });
  fails('openmxo', { state: 'live' });
});
