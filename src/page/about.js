// The server descriptions and the footer.
import { serversInView, stats } from './state.js';
import { fullDateFmt, monthYearFmt } from './format.js';
import { $, headCell, html, link } from './dom.js';
import { colorOf, key } from './look.js';
import { starButton, statusOf } from './cards.js';

export function renderAbout() {
  // One column per server, so the differences read across.
  const described = serversInView().filter((server) => server.about?.glance);
  $('glance-card').hidden = !described.length;
  $('glance-head').replaceChildren(
    headCell(''),
    ...described.map((server) => {
      const th = headCell('');
      th.append(key(server.id), ` ${server.name}`);
      return th;
    }),
  );
  const discordSize = (server) => {
    const c = server.community;
    if (!c || c.members === undefined) return '–';
    return `${c.members.toLocaleString()}${c.shared ? ' (shared)' : ''}`;
  };
  const rows = [['World', 'world'], ['Since', 'since'], ['Who can jack in', 'access'], ['Fighting', 'combat'], ['Fighting other operatives', 'pvp'], ['In short', 'focus'], ['Discord members', discordSize]];
  $('glance-rows').replaceChildren(
    ...rows.map(([label, field]) => {
      const row = html('tr');
      const th = html('th', '', label);
      th.scope = 'row';
      row.append(th, ...described.map((server) => html('td', '', typeof field === 'function' ? field(server) : server.about.glance[field])));
      return row;
    }),
  );

  $('about').replaceChildren(...serversInView().filter((server) => server.about).map(aboutCard));
}

function aboutCard(server) {
  const about = server.about;
  const card = html('div', 'card');
  card.style.setProperty('--c', colorOf(server.id));
  const list = html('dl');
  list.append(...about.facts.flatMap((fact) => [html('dt', '', fact.label), html('dd', '', fact.value)]));
  if (about.timeline) list.append(html('dt', '', 'Timeline'), timelineOf(about.timeline));
  if (server.community) list.append(html('dt', '', 'Community'), communityOf(server.community));
  const links = html('div', 'links');
  links.append(...about.links.map((item) => link(item.label, item.url)));
  card.append(aboutHead(server), chipsOf(about.glance), html('div', 'prose', about.summary), list, links);
  return card;
}

/** The same header as the cards at the top: status, name and world, then the star. */
function aboutHead(server) {
  const head = html('div', 'server-head');
  const status = statusOf(server.now);
  const badge = html('span', 'status');
  badge.append(html('span', `led ${status.led}`), status.counted ? `${status.text} · ${server.now.players}` : status.text);
  const titles = html('div', 'server-titles');
  titles.append(badge, html('h3', '', server.name));
  if (server.about.glance?.world) titles.append(html('div', 'world', `World ${server.about.glance.world}`));
  head.dataset.server = server.id;
  head.append(titles, starButton(server));
  return head;
}

function chipsOf(glance) {
  const chips = html('div', 'chips');
  const fields = [['Join', 'access'], ['PvP', 'pvp'], ['Since', 'since']].filter(([, field]) => glance?.[field]);
  chips.append(
    ...fields.map(([label, field]) => {
      const chip = html('span', 'chip');
      chip.append(html('span', 'chip-label', label), glance[field]);
      return chip;
    }),
  );
  return chips;
}

function timelineOf(timeline) {
  const steps = html('ul', 'timeline');
  steps.append(
    ...timeline.map(([when, what]) => {
      const step = html('li');
      step.append(html('span', 'when', when), html('span', '', what));
      return step;
    }),
  );
  const holder = html('dd');
  holder.append(steps);
  return holder;
}

function communityOf(community) {
  const holder = html('dd', 'community');
  const counts = community.members === undefined ? [] : [[community.members, 'members'], [community.online ?? 0, 'online now']];
  holder.append(
    ...counts.map(([value, label]) => {
      const stat = html('span');
      stat.append(html('strong', '', value.toLocaleString()), ` ${label}`);
      return stat;
    }),
  );
  holder.append(html('span', 'note', communityNote(community)));
  return holder;
}

/** Which Discord the numbers are from. */
function communityNote(community) {
  if (!community.shared) return `its own Discord, opened ${monthYearFmt.format(new Date(community.opened))}`;
  return `the shared fan Discord${community.name ? `, "${community.name}"` : ''}`;
}

export function renderFooter() {
  const sources = html('p', '', `numbers come from each server's own status page, checked every ${stats.sampleSeconds === 60 ? 'minute' : `${stats.sampleSeconds} seconds`}`);
  const rule = html('p', '', 'a server is called down only after 15 minutes without a live answer');
  const legal = html('p', '', 'fan page, not run by the server teams or the owners of The Matrix Online');
  const care = html('p', '', 'not connected to any server project, and no promise that their clients or downloads are safe');
  $('footer').replaceChildren(sources, rule, legal, care);
  // Visit totals stay private (npm run visitors). Only the start of the record is shown.
  const facts = [];
  if (stats.since) facts.push(`recording since ${fullDateFmt.format(stats.since)}`);
  $('page-facts').replaceChildren(...facts.map((fact) => html('p', '', fact)));
  $('page-facts').hidden = !facts.length;
}
