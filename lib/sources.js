// The community servers and how to read each one's public status feed.
import { online, siteUrl } from './site.js';

const FEED_MAX_BYTES = 256_000;
const USER_AGENT = `whoisjackedin/0.2 (unofficial status page${online() ? `; +${siteUrl()}` : ''})`;

const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const iso = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);
// Status pages refresh about once a minute, so an older reading is not live.
const STALE_FEED_MS = 5 * 60_000;

const ZONED = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * The feed's time. An online reading more than 5 minutes off is refused, with the time the page stopped at.
 * Offline readings count nobody and are kept. A time without a zone is not judged.
 */
function fresh(checkedAt, online, now) {
  const at = iso(checkedAt);
  if (!at || !online || !ZONED.test(at)) return at;
  const t = Date.parse(at);
  if (t - now > STALE_FEED_MS) throw new Error("the status page's clock is ahead");
  if (now - t > STALE_FEED_MS) throw Object.assign(new Error('the status page stopped updating'), { since: t });
  return at;
}

/** `code` is the one-letter name used in saved samples. Never change one once data exists. */
export const SERVERS = [
  {
    id: 'rejacked',
    code: 'r',
    tone: '--s1', // its color on the page, a CSS variable
    name: 'Rejacked',
    site: 'https://mxo-rejacked.com/',
    feed: 'https://mxo-rejacked.com/api/launcher/v1',
    discord: { invite: '6tDZ7c85K9', opened: '2026-10-05', shared: false },
    about: {
      summary: 'A small team building a new server from scratch. Open to everyone since 5 October 2026. Its world is called Recursion.',
      glance: { world: 'Recursion', since: 'Oct 2026', access: 'Anyone', combat: 'Yes', pvp: 'Duels, more in testing', focus: 'Faithful rebuild, open to all' },
      facts: [
        { label: 'How it is made', value: 'From recordings of the original servers and from the original client.' },
        { label: 'What you can do', value: 'Missions with friends, combat and leveling, archives, access nodes, crafting, gang loot, trading, a marketplace, gangs and crews. Agents guard the restricted areas. Duels work, and wider PvP is being tested.' },
        { label: 'How to jack in', value: 'Sign up on the site. You need your own copy of the original client, version 7.6005, and their launcher.' },
        { label: 'Good to know', value: 'It is a test server, so expect bugs and restarts. Fixes come almost every day. Experience comes three times faster for now.' },
      ],
      timeline: [
        ['5 Oct 2026', 'Opens to the public'],
        ['11 Oct', 'Trading and global chat'],
        ['25 Oct', 'Missions with your team'],
        ['28 Oct', 'Marketplace'],
        ['2 Nov', 'PvP testing starts'],
        ['14 Nov', 'New, sturdier server setup'],
        ['18 Nov', 'Gang loot, smarter enemies, many combat fixes'],
      ],
      links: [
        { label: 'Website', url: 'https://mxo-rejacked.com/' },
        { label: 'News', url: 'https://mxo-rejacked.com/news' },
        { label: 'Discord', url: 'https://discord.gg/6tDZ7c85K9' },
      ],
    },
    read(feed, now = Date.now()) {
      const status = feed?.status;
      // A server that is down gives no count at all, so offline means nobody on.
      const players = status?.online === false ? 0 : count(status?.playersOnline);
      if (typeof status?.online !== 'boolean' || players === null) throw new Error('no usable status in the feed');
      const version = text(feed.launcher?.latestVersion, 40);
      return {
        online: status.online,
        players,
        checkedAt: fresh(status.checkedAt, status.online, now),
        details: [{ label: 'World', value: 'Recursion' }, ...(version ? [{ label: 'Launcher', value: version }] : [])],
      };
    },
  },
  {
    id: 'revived',
    code: 'v',
    tone: '--s2', // its color on the page, a CSS variable
    name: 'MxO Revived',
    site: 'https://mxorevived.com/',
    feed: 'https://mxorevived.com/api/server-status',
    discord: { invite: 'WKUu9s5D6s', opened: '2026-10-22', shared: false },
    about: {
      summary: 'Started in late September 2026 to fix the combat. Now a small, non-profit restoration of the whole game, in early pre-alpha testing.',
      glance: { world: 'Vector', since: 'Sep 2026', access: 'Anyone, with a code', combat: 'Yes', pvp: 'Yes, anywhere', focus: 'The 2009 game, open PvP' },
      facts: [
        { label: 'How it is made', value: 'On top of earlier fan projects. Every change is checked against records of the 2009 game.' },
        { label: 'What you can do', value: 'Story missions, 2009-style combat, archives, access nodes, data mining, crafting, a marketplace, gangs, hideouts, crews and factions. Its world, Vector, is open PvP, so other operatives can attack you.' },
        { label: 'How to jack in', value: 'Request an access code on the site. It comes at once, after a quick check that you are a person. Characters are never wiped.' },
        { label: 'Good to know', value: 'Updates almost every day. One character per account can be in the world at a time. Its site has an ability planner and guides that are useful on any server.' },
      ],
      timeline: [
        ['Sep 2026', 'Work starts'],
        ['16 Oct', 'First public build'],
        ['31 Oct', 'First new cutscene, Halloween event'],
        ['7 Nov', 'Crews and factions'],
        ['12 Nov', 'Client rebuild two thirds done'],
        ['18 Nov', 'PvP and hacker damage matched to 2009'],
      ],
      links: [
        { label: 'Website', url: 'https://mxorevived.com/' },
        { label: 'Patch notes', url: 'https://mxorevived.com/patch-notes.html' },
        { label: 'Field guide', url: 'https://mxorevived.com/game-info.html' },
        { label: 'Forum', url: 'https://forum.mxorevived.com/' },
        { label: 'Discord', url: 'https://discord.gg/WKUu9s5D6s' },
      ],
    },
    read(feed, now = Date.now()) {
      const state = text(feed?.status, 24)?.toLowerCase();
      if (!state) throw new Error('no usable status in the feed');
      const online = state === 'live'; // their own site shows anything else as maintenance
      const players = count(feed.onlinePlayers) ?? (online ? null : 0);
      if (players === null) throw new Error('no player count in the feed');
      return {
        online,
        players,
        checkedAt: fresh(feed.checkedAt, online, now),
        details: online ? [{ label: 'World', value: 'Vector' }] : [{ label: 'Status', value: state }, { label: 'World', value: 'Vector' }],
      };
    },
  },
  {
    id: 'mxoemu',
    code: 'e',
    tone: '--s3', // its color on the page, a CSS variable
    name: 'MxOEmu',
    site: 'https://mxoemu.info/',
    feed: 'https://mxoemu.info/api/servers',
    discord: { invite: '0lRlOG8mywPfNcgo', opened: '2016-01-14', shared: true },
    about: {
      summary: 'Where it all began. The oldest one, running since 2010. Its world is called Reality.',
      glance: { world: 'Reality', since: 'Sep 2010', access: 'Anyone', combat: 'Not yet', pvp: 'No', focus: 'Explore and hang out' },
      facts: [
        { label: 'How it is made', value: 'A long-running fan project. Features are added one at a time.' },
        { label: 'Why it matters', value: 'The biggest effort and the biggest contribution to bringing the game back. Its team worked out by hand how the game talks to its server, years before AI tools could help.' },
        { label: 'What you can do', value: 'Explore the whole city, dress up, chat, team up and trade. Money, ability upgrades and crafting arrived in October 2026. No leveling or combat yet.' },
        { label: 'How to jack in', value: 'Sign up on the site. It offers the full client download and a launcher.' },
        { label: 'Good to know', value: 'A social server, with events run by its operatives.' },
      ],
      timeline: [
        ['Sep 2010', 'First test server'],
        ['2017', 'Character creation, clothes, weapons'],
        ['2022', 'Teams, crews and factions'],
        ['2023', 'Trading'],
        ['Oct 2026', 'Money, upgrades and crafting'],
      ],
      links: [
        { label: 'Website', url: 'https://mxoemu.info/' },
        { label: 'Forums', url: 'https://mxoemu.info/forum/' },
        { label: 'Discord', url: 'https://discord.gg/0lRlOG8mywPfNcgo' },
      ],
    },
    read(feed) {
      const worlds = Array.isArray(feed?.servers) ? feed.servers.slice(0, 8) : [];
      if (!worlds.length) throw new Error('no servers in the feed');
      const up = worlds.filter((world) => Number(world?.status) === 1);
      const online = up.length > 0;
      const players = up.reduce((sum, world) => sum + (count(world.numPlayers) ?? 0), 0);
      const districts = districtsOf(up);
      const details = [];
      const names = worlds.map((world) => text(world?.name, 30)).filter(Boolean);
      if (names.length) details.push({ label: names.length === 1 ? 'World' : 'Worlds', value: names.join(', ') });
      if (districts.size) details.push({ label: 'Districts', value: [...districts].map(([name, n]) => `${name} ${n}`).join(', ') });
      return { online, players, checkedAt: null, details };
    },
  },
  {
    id: 'openmxo',
    code: 'o',
    tone: '--s4', // its color on the page, a CSS variable
    name: 'openMXO',
    site: 'https://openmxo.com/',
    // The feed behind the live map on their forum. Only its state and the length of its list are read:
    // who is in the list, and where, is never looked at or kept.
    feed: 'https://openmxo.com/forum/map/presence',
    discord: { invite: 'qHu3MWKV6U', opened: '2026-10-26', shared: false },
    about: {
      summary: 'A community-run reconstruction with its own new game client. Its forum opened in October 2026. Its server is called Chrysalis.',
      glance: { world: 'Chrysalis', since: 'Oct 2026', access: 'Anyone', combat: 'Yes', pvp: 'Not stated', focus: 'Its own new client and server' },
      facts: [
        { label: 'How it is made', value: 'A new client program and a new server, both written by the project. The client reads the original game files, version 7.6005.' },
        { label: 'What you can do', value: 'Create a character and enter the city. Missions, alone or with a team, fights with mission enemies and Agents, and ability upgrades. Its site has a forum, a live map and an events calendar.' },
        { label: 'How to jack in', value: 'Download the client package from the site (about 1.5 GB, for Windows) and start it. Typing a new name at the login screen creates your account.' },
        { label: 'Good to know', value: 'New versions come often, and the client updates itself when it starts. Account recovery is not available yet.' },
      ],
      timeline: [
        ['15 Oct 2026', 'First posts on its forum'],
        ['26 Oct', 'Discord opens'],
        ['16 Nov', 'Client 2.9 and server 3.54'],
      ],
      links: [
        { label: 'Website', url: 'https://openmxo.com/' },
        { label: 'Forum', url: 'https://openmxo.com/forum/' },
        { label: 'Discord', url: 'https://discord.gg/qHu3MWKV6U' },
      ],
    },
    read(feed) {
      const state = text(feed?.state, 24)?.toLowerCase();
      if (!state || !Array.isArray(feed.players)) throw new Error('no usable status in the feed');
      const at = Number.isFinite(feed.updatedUnixMs) && Math.abs(feed.updatedUnixMs) < 8.64e15 ? new Date(feed.updatedUnixMs).toISOString() : null;
      const world = { label: 'World', value: 'Chrysalis' };
      // Their own map reads the feed the same way: "stopped" is the server switched off, a live signal older
      // than 15 seconds is stale, and anything else is no signal at all.
      if (state === 'stopped') return { online: false, players: 0, checkedAt: at, details: [{ label: 'Status', value: 'stopped' }, world] };
      if (state !== 'live') throw new Error(`the feed says ${state}`);
      if (typeof feed.ageMs === 'number' && feed.ageMs > 15_000) throw new Error('the feed is stale');
      return { online: true, players: feed.players.length, checkedAt: at, details: [world] };
    },
  },
];

/** Players per district, added up over the worlds that are up. */
function districtsOf(worlds) {
  const entries = worlds.flatMap((world) => (world.districts && typeof world.districts === 'object' ? Object.entries(world.districts).slice(0, 12) : []));
  return entries
    .filter(([, n]) => count(n))
    .reduce((districts, [name, n]) => districts.set(name.slice(0, 24), (districts.get(name.slice(0, 24)) ?? 0) + n), new Map());
}

/** Why a feed could not be read, in a few words. */
function failureOf(err) {
  if (err.name === 'TimeoutError') return 'the feed timed out';
  if (err.name === 'SyntaxError') return 'the feed is not JSON';
  return err.cause?.code ?? err.message;
}

async function readServer(server) {
  const started = Date.now();
  try {
    const res = await fetch(server.feed, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) return { ok: false, limited: true, error: 'asked too often' };
    if (!res.ok) throw new Error(`the feed answered ${res.status}`);
    // A feed that says it is too large is not read at all. One that does not say is still checked after reading.
    if (Number(res.headers.get('content-length')) > FEED_MAX_BYTES) throw new Error('the feed is too large');
    const body = await res.text();
    if (body.length > FEED_MAX_BYTES) throw new Error('the feed is too large');
    return { ok: true, ms: Date.now() - started, ...server.read(JSON.parse(body), Date.now()) };
  } catch (err) {
    return { ok: false, error: String(failureOf(err)).slice(0, 160), ...(Number.isFinite(err.since) ? { since: err.since } : {}) };
  }
}

/**
 * Public size of each server's Discord, from its invite link: { name, members, online } or null.
 * In SERVERS order. Never throws.
 */
export function readCommunities() {
  return Promise.all(
    SERVERS.map(async (server) => {
      if (!server.discord) return null;
      try {
        const res = await fetch(`https://discord.com/api/v10/invites/${server.discord.invite}?with_counts=true`, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return null;
        const invite = await res.json();
        const members = count(invite.approximate_member_count);
        if (members === null) return null;
        return { name: text(invite.guild?.name, 60), members, online: count(invite.approximate_presence_count) };
      } catch {
        return null;
      }
    }),
  );
}

/** One answer per server, in SERVERS order. Never throws. */
export function readAll() {
  return Promise.all(SERVERS.map(readServer));
}
