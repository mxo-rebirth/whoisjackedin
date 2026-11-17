// Runs before the page is drawn, so the right theme and color are there from the first moment.
// A saved choice wins. Without one, the theme follows the device's setting and the color is green.
(() => {
  const saved = /(?:^|; )theme=(light|dark)/.exec(document.cookie)?.[1];
  document.documentElement.dataset.theme = saved ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  if (/(?:^|; )accent=blue/.test(document.cookie)) document.documentElement.dataset.accent = 'blue';
})();
