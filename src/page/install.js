import { $ } from './dom.js';

// On a phone, a small box suggests keeping the site on the home screen. It waits until the visitor has
// had a look, never shows in the installed app, and "Not now" keeps it away for a month.
const box = $('install');
const WAIT_MS = 20_000;
const QUIET_MS = 30 * 24 * 3600_000;

const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const phone = matchMedia('(pointer: coarse)').matches;
// iPadOS presents itself as a Mac, so a touch screen gives it away.
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

let quiet = false;
try {
  quiet = Date.now() - Number(localStorage.getItem('install-later') ?? 0) < QUIET_MS;
} catch {}

let offer = null;

function later() {
  box.hidden = true;
  try {
    localStorage.setItem('install-later', String(Date.now()));
  } catch {}
}

function show(how) {
  if (!box.hidden) return;
  box.dataset.how = how;
  box.hidden = false;
}

if (box && phone && !installed && !quiet) {
  // Android's browsers say when the site can be installed and let a button do it.
  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offer = event;
    setTimeout(() => offer && show('button'), WAIT_MS);
  });
  // iPhones have no such button: the box says where Safari's own one is.
  if (ios) setTimeout(() => show('steps'), WAIT_MS);

  $('install-go').addEventListener('click', async () => {
    if (box.dataset.how !== 'button' || !offer) return later();
    const choice = offer;
    offer = null;
    try {
      await choice.prompt();
      const { outcome } = await choice.userChoice;
      if (outcome === 'accepted') return (box.hidden = true);
    } catch {}
    later();
  });
  $('install-later').addEventListener('click', later);
  addEventListener('appinstalled', () => {
    box.hidden = true;
  });
}
