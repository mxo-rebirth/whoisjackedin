// The page is sent with the current numbers already written in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPage } from '../lib/page.js';

const template = '<meta name="description" content="x"><b id="total-now">–</b><b id="total-peak24">–</b><b id="total-record">–</b><i id="total-note">&nbsp;</i><script type="application/json" id="boot">null</script>';
const server = (name, now) => ({ name, now });
const stats = {
  total: { peak24: 3, recordPeak: 20 },
  servers: [server('A', { ok: true, online: true, players: 4 }), server('B</script>', { ok: true, online: true, players: 1 }), server('C', { ok: false })],
};

test('the totals count only servers with a trusted answer', () => {
  const page = renderPage(template, stats);
  assert.match(page, /id="total-now">5</);
  assert.match(page, /id="total-peak24">5</); // never below the count right now
  assert.match(page, /id="total-record">20</);
  assert.match(page, /id="total-note">2 of 3 servers online</);
});

test('the analytics script is added only when asked for', () => {
  assert.ok(!renderPage(`${template}</body>`, stats).includes('insights'));
  assert.match(renderPage(`${template}</body>`, stats, { analytics: true }), /<script defer src="\/_vercel\/insights\/script\.js"><\/script>\n<\/body>/);
});

test('nothing in the data can close the script tag it is handed over in', () => {
  const page = renderPage(template, stats);
  assert.ok(!page.includes('B</script>'));
  assert.match(page, /B\\u003c\/script>/);
  assert.match(page, /content="5 players online now: A 4, B&lt;\/script&gt; 1, C offline\./);
});
