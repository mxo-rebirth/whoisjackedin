// The three community servers and how to read each one's public status feed.

const site = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const USER_AGENT = `whoisjackedin/0.2 (unofficial status page${site ? `; +https://${site}` : ''})`;

const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const iso = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

/** `code` is the one-letter name used in saved samples. Never change one once data exists. */
export const SERVERS = [
  {
    id: 'rejacked',
    code: 'r',
    name: 'Rejacked',
    site: 'https://mxo-rejacked.com/',
    feed: 'https://mxo-rejacked.com/api/launcher/v1',
    discord: { invite: '6tDZ7c85K9', opened: '2026-10-05', shared: false },
    about: {
      summary: 'A small team building a new server from scratch. Open to everyone since 5 October 2026. Its world is called Recursion.',
      glance: { world: 'Recursion', since: 'Oct 2026', access: 'Anyone', combat: 'Yes', pvp: 'Duels, more in testing', focus: 'Faithful rebuild, open to all' },
      facts: [
        { label: 'How it is made', value: 'From recordings of the original servers and from the original client.' },
        { label: 'What you can do', value: 'Missions with friends, combat and leveling, gangs, trading, a marketplace and crews. Duels work, and wider PvP is being tested.' },
        { label: 'How to jack in', value: 'Sign up on the site. You need your own copy of the original client, version 7.6005, and their launcher.' },
        { label: 'Good to know', value: 'It is a test server, so expect bugs and restarts. Experience comes three times faster for now.' },
      ],
      timeline: [
        ['5 Oct 2026', 'Opens to the public'],
        ['11 Oct', 'Trading and global chat'],
        ['25 Oct', 'Missions with your team'],
        ['28 Oct', 'Marketplace'],
        ['2 Nov', 'PvP testing starts'],
        ['14 Nov', 'New, sturdier server setup'],
      ],
      links: [
        { label: 'Website', url: 'https://mxo-rejacked.com/' },
        { label: 'News', url: 'https://mxo-rejacked.com/news' },
        { label: 'Discord', url: 'https://discord.gg/6tDZ7c85K9' },
      ],
    },
    read(feed) {
      const status = feed?.status;
      const players = count(status?.playersOnline);
      if (typeof status?.online !== 'boolean' || players === null) throw new Error('no usable status in the feed');
      const version = text(feed.launcher?.latestVersion, 40);
      return {
        online: status.online,
        players,
        checkedAt: iso(status.checkedAt),
        details: [{ label: 'World', value: 'Recursion' }, ...(version ? [{ label: 'Launcher', value: version }] : [])],
      };
    },
  },
  {
    id: 'revived',
    code: 'v',
    name: 'MxO Revived',
    site: 'https://mxorevived.com/',
    feed: 'https://mxorevived.com/api/server-status',
    discord: { invite: 'WKUu9s5D6s', opened: '2026-10-22', shared: false },
    about: {
      summary: 'Started in late September 2026 to fix the combat. Now a small, non-profit restoration of the whole game, in early pre-alpha testing.',
      glance: { world: 'Vector', since: 'Sep 2026', access: 'Invite only', combat: 'Yes', pvp: 'Yes, anywhere', focus: 'The 2009 game, open PvP' },
      facts: [
        { label: 'How it is made', value: 'On top of earlier fan projects. Every change is checked against records of the 2009 game.' },
        { label: 'What you can do', value: 'Story missions, 2009-style combat, gangs, hideouts, crafting, crews and factions. Its world, Vector, is open PvP, so other operatives can attack you.' },
        { label: 'How to jack in', value: 'Invite only for now. Ask for an invite on the site. Characters are never wiped.' },
        { label: 'Good to know', value: 'Updates almost every day. Its site has an ability planner and guides that are useful on any server.' },
      ],
      timeline: [
        ['Sep 2026', 'Work starts'],
        ['16 Oct', 'First public build'],
        ['31 Oct', 'First new cutscene, Halloween event'],
        ['7 Nov', 'Crews and factions'],
        ['12 Nov', 'Client rebuild two thirds done'],
      ],
      links: [
        { label: 'Website', url: 'https://mxorevived.com/' },
        { label: 'Patch notes', url: 'https://mxorevived.com/patch-notes.html' },
        { label: 'Field guide', url: 'https://mxorevived.com/game-info.html' },
        { label: 'Forum', url: 'https://forum.mxorevived.com/' },
        { label: 'Discord', url: 'https://discord.gg/WKUu9s5D6s' },
      ],
    },
    read(feed) {
      const state = text(feed?.status, 24)?.toLowerCase();
      if (!state) throw new Error('no usable status in the feed');
      const online = state === 'live'; // their own site shows anything else as maintenance
      const players = count(feed.onlinePlayers) ?? (online ? null : 0);
      if (players === null) throw new Error('no player count in the feed');
      return {
        online,
        players,
        checkedAt: iso(feed.checkedAt),
        details: online ? [{ label: 'World', value: 'Vector' }] : [{ label: 'Status', value: state }, { label: 'World', value: 'Vector' }],
      };
    },
  },
  {
    id: 'mxoemu',
    code: 'e',
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
      let online = false;
      let players = 0;
      const districts = new Map();
      for (const world of worlds) {
        if (Number(world?.status) !== 1) continue;
        online = true;
        players += count(world.numPlayers) ?? 0;
        const perDistrict = world.districts && typeof world.districts === 'object' ? Object.entries(world.districts) : [];
        for (const [name, n] of perDistrict.slice(0, 12)) {
          if (count(n)) districts.set(name.slice(0, 24), (districts.get(name.slice(0, 24)) ?? 0) + n);
        }
      }
      const details = [];
      const names = worlds.map((world) => text(world?.name, 30)).filter(Boolean);
      if (names.length) details.push({ label: names.length === 1 ? 'World' : 'Worlds', value: names.join(', ') });
      if (districts.size) details.push({ label: 'Districts', value: [...districts].map(([name, n]) => `${name} ${n}`).join(', ') });
      return { online, players, checkedAt: null, details };
    },
  },
];

async function readServer(server) {
  const started = Date.now();
  try {
    const res = await fetch(server.feed, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) return { ok: false, limited: true, error: 'asked too often' };
    if (!res.ok) throw new Error(`the feed answered ${res.status}`);
    const body = await res.text();
    if (body.length > 256_000) throw new Error('the feed is too large');
    return { ok: true, ms: Date.now() - started, ...server.read(JSON.parse(body)) };
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'the feed timed out' : err.name === 'SyntaxError' ? 'the feed is not JSON' : (err.cause?.code ?? err.message);
    return { ok: false, error: String(reason).slice(0, 160) };
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
