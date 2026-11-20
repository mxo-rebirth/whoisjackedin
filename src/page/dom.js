// Small helpers for making the page's elements.
export const SVG_NS = 'http://www.w3.org/2000/svg';

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (parent) parent.appendChild(node);
  return node;
}

export function html(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function link(label, url) {
  const node = html('a', '', label);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

export function stateIcon(kind) {
  const color = { good: 'var(--good)', critical: 'var(--critical)', unknown: 'var(--muted)' }[kind];
  const shape = { good: 'M4.5 8.2l2.3 2.3 4.7-5', critical: 'M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6', unknown: 'M4.8 8h6.4' }[kind];
  const icon = el('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' });
  el('circle', { cx: 8, cy: 8, r: 8, fill: color }, icon);
  el('path', { d: shape, fill: 'none', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, icon);
  return icon;
}

export function headCell(text) {
  const th = html('th', '', text);
  th.scope = 'col';
  return th;
}

export function tableRow(...cells) {
  const row = html('tr');
  for (const text of cells) row.append(html('td', '', String(text)));
  return row;
}
