// The server descriptions and the footer.
import { stats } from './state.js';
import { fullDateFmt, monthYearFmt } from './format.js';
import { $, headCell, html, link } from './dom.js';
import { colorOf, key } from './look.js';
import { statusOf } from './cards.js';

export function renderAbout() {
  // One column per server, so the differences read across.
  const described = stats.servers.filter((server) => server.about?.glance);
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

  $('about').replaceChildren(
    ...stats.servers
      .filter((server) => server.about)
      .map((server) => {
        const about = server.about;
        const card = html('div', 'card');
        card.style.setProperty('--c', colorOf(server.id));

        // The same header as the cards at the top: portrait, then status, name and world.
        const head = html('div', 'server-head');
        const status = statusOf(server.now);
        const badge = html('span', 'status');
        badge.append(html('span', `led ${status.led}`), status.counted ? `${status.text} · ${server.now.players}` : status.text);
        const titles = html('div', 'server-titles');
        titles.append(badge, html('h3', '', server.name));
        if (about.glance?.world) titles.append(html('div', 'world', `World ${about.glance.world}`));
        head.dataset.server = server.id;
        head.append(titles);

        const chips = html('div', 'chips');
        for (const [label, field] of [['Join', 'access'], ['PvP', 'pvp'], ['Since', 'since']]) {
          if (!about.glance?.[field]) continue;
          const chip = html('span', 'chip');
          chip.append(html('span', 'chip-label', label), about.glance[field]);
          chips.append(chip);
        }

        const list = html('dl');
        for (const fact of about.facts) list.append(html('dt', '', fact.label), html('dd', '', fact.value));
        if (about.timeline) {
          const steps = html('ul', 'timeline');
          for (const [when, what] of about.timeline) {
            const step = html('li');
            step.append(html('span', 'when', when), html('span', '', what));
            steps.append(step);
          }
          const holder = html('dd');
          holder.append(steps);
          list.append(html('dt', '', 'Timeline'), holder);
        }
        const c = server.community;
        if (c) {
          const holder = html('dd', 'community');
          if (c.members !== undefined) {
            for (const [value, label] of [[c.members, 'members'], [c.online ?? 0, 'online now']]) {
              const stat = html('span');
              stat.append(html('strong', '', value.toLocaleString()), ` ${label}`);
              holder.append(stat);
            }
          }
          holder.append(html('span', 'note', c.shared ? `the shared fan Discord${c.name ? `, "${c.name}"` : ''}` : `its own Discord, opened ${monthYearFmt.format(new Date(c.opened))}`));
          list.append(html('dt', '', 'Community'), holder);
        }
        const links = html('div', 'links');
        links.append(...about.links.map((item) => link(item.label, item.url)));
        card.append(head, chips, html('div', 'prose', about.summary), list, links);
        return card;
      }),
  );
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
