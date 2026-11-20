// The cast: the game's 3D characters, the footer figure's commands and the heading icons. Not part of the public
// page: the site sends this script only to a visitor whose link carried the key (see lib/cast.js).
import { act, bust, figureReady, useKey, useTone } from './bust.js';

// The key came in this script's own address. It is taken off the page's address at once.
const key = new URL(document.currentScript.src).searchParams.get('k');
useKey(key);
{
  const here = new URL(location.href);
  if (here.searchParams.has('rsi')) {
    here.searchParams.delete('rsi');
    history.replaceState(null, '', here.pathname + here.search + here.hash);
  }
}

const $ = (id) => document.getElementById(id);
const html = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

document.documentElement.dataset.cast = 'on';
// The characters are drawn in the page's own color, and change with it.
const matchTone = () => useTone(document.documentElement.dataset.accent === 'blue' ? 'blue' : 'green');
matchTone();
new MutationObserver(matchTone).observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent'] });
document.head.append(html('style', '', CAST_CSS));

// Characters from the game's own story. Cryptos stands by the title.
document.querySelector('.brand').prepend(bust('cryptos', ''));
// Tyndall, beside the story of the game's end and return. She watches the pointer.
document.querySelector('.intro').append(bust('tyndall', '', { watches: true }));
document.querySelector('footer').append(bust('flood', '', { whole: true }));

// An icon from the game beside each heading.
const ICONS = {
  Ranking: 'disc_upgrade_master',
  'Operatives jacked in': 'disc_network_hacker',
  'Day by day': 'disc_upgrade_artist',
  Uptime: 'signal_booster',
  'Busiest hours': 'disc_awakened',
  'One server at a time': 'disc_spy',
  Records: 'disc_data_miner',
  Outages: 'impaired_connection',
  'The servers': 'disc_hacker',
};
for (const heading of document.querySelectorAll('h2')) {
  const icon = ICONS[heading.querySelector('.title')?.textContent.trim()];
  if (!icon) continue;
  const picture = html('img', 'glyph');
  Object.assign(picture, { alt: '', width: 32, height: 32, src: `/api/model?f=${encodeURIComponent(`icon/${icon}.png`)}&k=${encodeURIComponent(key)}` });
  heading.prepend(picture);
}

// A face from the game for each server. Decoration only: the servers are not tied to these sides.
const FACES = { rejacked: ['lotus', ''], revived: ['general', ''], mxoemu: ['chessman', ''], openmxo: ['weaver', ''] };

/** The page redraws its cards and footer when new numbers arrive, so the faces and art credit go back on each time. */
function dress() {
  for (const head of document.querySelectorAll('.server-head[data-server]')) {
    const face = FACES[head.dataset.server];
    if (face && !head.querySelector('.face')) head.prepend(bust(...face));
  }
  const notes = $('footer');
  if (notes?.children.length && !notes.querySelector('[data-credit]')) {
    const credit = html('p', '', 'the icons and faces come from the game and belong to its owners');
    credit.dataset.credit = '';
    notes.append(credit);
  }
}
dress();
document.addEventListener('mxo:render', dress);

// A line to tell Flood what to do, typed the way emotes are in the game.
const SAID = {
  wave: 'Flood waves.',
  bow: 'Flood bows.',
  nod: 'Flood nods.',
  no: 'Flood shakes his head.',
  shrug: 'Flood shrugs.',
  point: 'Flood points.',
  clap: 'Flood claps.',
  cheer: 'Flood cheers.',
  salute: 'Flood salutes.',
  beckon: 'Flood beckons.',
  laugh: 'Flood laughs.',
  thumbsup: 'Flood gives a thumbs up.',
  kneel: 'Flood kneels.',
  crossarms: 'Flood crosses his arms.',
  dance: 'Flood dances.',
  turn: 'Flood turns around.',
};
const ALSO = { hello: 'wave', hi: 'wave', yes: 'nod', shake: 'no', shakehead: 'no', applaud: 'clap', pointf: 'point', thumbs: 'thumbsup', spin: 'turn', rotate: 'turn' };
const HELP = 'Click a command or type it. Drag Flood to turn him.';

const panel = html('section', 'console');
panel.id = 'console';
panel.setAttribute('aria-label', 'Tell Flood what to do');
panel.hidden = true;
const form = html('form', 'say');
form.autocomplete = 'off';
const prompt = html('label', '', '>');
prompt.htmlFor = 'say-line';
const line = html('input');
Object.assign(line, { id: 'say-line', name: 'line', type: 'text', maxLength: 24, placeholder: '/wave', spellcheck: false, autocapitalize: 'off', enterKeyHint: 'send' });
line.setAttribute('autocorrect', 'off');
line.setAttribute('aria-describedby', 'say-reply');
form.append(prompt, line);
const reply = html('div', 'say-reply', 'Type /help to see what he can do.');
reply.id = 'say-reply';
reply.setAttribute('role', 'status');
const commands = html('div', 'commands');
commands.id = 'commands';
panel.append(html('div', 'console-title', 'Tell Flood what to do'), form, reply, commands);
document.querySelector('.foot-text').prepend(panel);

const listed = [];
/** Does what a command says and gives the line to show for it. */
const answer = (word) => {
  const emote = ALSO[word] ?? word;
  if (word === 'help' || word === '?') {
    // Asking for help lays out every command, ready to click.
    for (const button of listed) button.hidden = false;
    return HELP;
  }
  if (!Object.hasOwn(SAID, emote)) return `Unknown command /${word}. Try /help`;
  return act('flood', emote) ? SAID[emote] : 'Flood is not here.';
};
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const word = line.value.trim().toLowerCase().replace(/^\/+/, '').split(/\s+/)[0];
  line.value = '';
  if (word) reply.textContent = answer(word);
});
// Every command can also be clicked. Only /help shows until it is asked for.
for (const name of ['help', ...Object.keys(SAID)]) {
  const button = html('button', 'pill', `/${name}`);
  button.type = 'button';
  button.addEventListener('click', () => (reply.textContent = answer(name)));
  if (name !== 'help') {
    button.hidden = true;
    listed.push(button);
  }
  commands.append(button);
}
// Shown only once he is there to answer.
figureReady('flood').then((there) => {
  panel.hidden = !there;
});
