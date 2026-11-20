// Runs before the page is drawn, so the right theme and color are there from the first moment.
// A saved choice wins (local storage, see src/page/prefs.js). Without one, the theme follows the device and the color is green.
(() => {
  let theme = null;
  let accent = null;
  try {
    theme = localStorage.getItem('theme');
    accent = localStorage.getItem('accent');
  } catch {}
  document.documentElement.dataset.theme = theme === 'light' || theme === 'dark' ? theme : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  if (accent === 'blue') document.documentElement.dataset.accent = 'blue';
})();
