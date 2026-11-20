import { $ } from './dom.js';

// A link to another site first opens a box saying this page vouches for nobody's software, until the
// visitor ticks "remember my choice". Without scripts, or with no dialog support, links just work.
export const leave = $('leave');

export let warned = false;

try {
  warned = localStorage.getItem('warned') === '1';
} catch {}

export function askFirst(event) {
  if (warned || !leave?.showModal || leave.open) return;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  // The project's own repos are not one of the servers' sites, so they need no word of care.
  if (!anchor || anchor.id === 'leave-go' || anchor.hasAttribute('data-own')) return;
  let url;
  try {
    url = new URL(anchor.href);
  } catch {
    return;
  }
  if (!/^https?:$/.test(url.protocol) || url.host === location.host) return;
  event.preventDefault();
  $('leave-host').textContent = url.host.replace(/^www\./, '');
  $('leave-go').href = url.href;
  $('leave-keep').checked = false;
  leave.showModal();
}

document.addEventListener('click', askFirst);

// A click with the middle button opens a link in a new tab, so it is asked about too.
document.addEventListener('auxclick', (event) => {
  if (event.button === 1) askFirst(event);
});

$('leave-stay')?.addEventListener('click', () => leave.close());

$('leave-go')?.addEventListener('click', () => {
  if ($('leave-keep').checked) {
    // Where the browser keeps nothing, the choice still holds until the page is closed.
    warned = true;
    try {
      localStorage.setItem('warned', '1');
    } catch {}
  }
  leave.close();
});

// A click on the dimmed page around the box closes it.
leave?.addEventListener('click', (event) => {
  if (event.target === leave) leave.close();
});
