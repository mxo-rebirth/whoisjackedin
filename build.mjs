// Builds the page into public/: the script bundled and minified, the styles minified, comments gone, no source maps.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { SERVERS } from './lib/sources.js';
import { escapeHtml } from './lib/html.js';
import { iconPng } from './lib/icons.js';
import { manifest } from './lib/manifest.js';
import { siteUrl } from './lib/site.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'public');
const SCRIPT_TAG = '<script defer src="/assets/app.js"></script>';
const ABOUT_SLOT = '<section class="about" id="about"></section>';

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'assets'), { recursive: true });
// Only the link-preview picture is public. The game's art lives in art/, outside git, and only api/model.js hands it out.
await mkdir(path.join(out, 'assets', 'icons'), { recursive: true });
await cp(path.join(root, 'src', 'og.jpg'), path.join(out, 'assets', 'icons', 'og.jpg'));
// The site as an app: icons drawn from the favicon, the manifest, and the service worker at the top level so it
// covers the whole site.
for (const [name, size, maskable] of [['app-192', 192, false], ['app-512', 512, false], ['app-maskable-512', 512, true], ['app-180', 180, true]]) {
  await writeFile(path.join(out, 'assets', 'icons', `${name}.png`), iconPng(size, { maskable }));
}
await writeFile(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest()));
await writeFile(path.join(out, 'sw.js'), (await transform(await readFile(path.join(root, 'src', 'sw.js'), 'utf8'), { minify: true })).code);
// The 3D characters are not part of the public page: no models, script or styles for them go into public/.
// Their script is built into private/, which only api/model.js reads, and only for a visitor with the key.
const hidden = path.join(root, 'private');
await rm(hidden, { recursive: true, force: true });
await mkdir(hidden, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src', 'cast.js')],
  outfile: path.join(hidden, 'cast.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'none',
  define: { CAST_CSS: JSON.stringify((await transform(await readFile(path.join(root, 'src', 'cast.css'), 'utf8'), { loader: 'css', minify: true, legalComments: 'none' })).code.trim()) },
});
// The theme script is tiny and runs before the page is drawn.
await writeFile(path.join(out, 'assets', 'theme.js'), (await transform(await readFile(path.join(root, 'src', 'theme.js'), 'utf8'), { minify: true })).code);

// The page script and the chart library become one file, named with a hash so a new version never mixes with an old one.
const bundle = await build({
  entryPoints: [path.join(root, 'src', 'app.js')],
  outdir: path.join(out, 'assets'),
  entryNames: 'app-[hash]',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'none',
  banner: { js: '/*! MxO Server Stats. Charts by Apache ECharts and ZRender, licenses in /assets/licenses.txt */' },
  metafile: true,
});
const script = path.basename(Object.keys(bundle.metafile.outputs).find((name) => name.endsWith('.js')));

// The chart library's license asks that its notices travel with it.
const notice = async (title, ...file) => `${title}\n${'='.repeat(title.length)}\n\n${(await readFile(path.join(root, 'node_modules', ...file), 'utf8')).trim()}\n`;
await writeFile(
  path.join(out, 'assets', 'licenses.txt'),
  [
    `This site\n${'='.repeat(9)}\n\n${(await readFile(path.join(root, 'LICENSE'), 'utf8')).trim()}`,
    await notice('Apache ECharts', 'echarts', 'LICENSE'),
    await notice('Apache ECharts, notice', 'echarts', 'NOTICE'),
    await notice('ZRender', 'zrender', 'LICENSE'),
  ].join('\n\n'),
);

const source = await readFile(path.join(root, 'src', 'index.html'), 'utf8');
const open = source.indexOf('<style>');
const close = source.lastIndexOf('</style>');
if (open < 0 || close < open || !source.includes(SCRIPT_TAG) || !source.includes(ABOUT_SLOT)) throw new Error('src/index.html needs one <style> block, the app script tag and an empty #about section');
const css = (await transform(source.slice(open + 7, close), { loader: 'css', minify: true, legalComments: 'none' })).code.trim();

// The server descriptions are written into the page, so search engines and readers without scripts get them.
// The script redraws that section with the live status once it loads.
const about = SERVERS.filter((server) => server.about)
  .map((server) => {
    const facts = server.about.facts.map((fact) => `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>`).join('');
    const links = server.about.links.map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`).join('');
    return `<div class="card" style="--c: var(${server.tone})"><div class="server-head"><div class="server-titles"><h3>${escapeHtml(server.name)}</h3></div></div><div class="prose">${escapeHtml(server.about.summary)}</div><dl>${facts}</dl><div class="links">${links}</div></div>`;
  })
  .join('');
const site = siteUrl();
const fill = (html) => html.replace(ABOUT_SLOT, `<section class="about" id="about">${about}</section>`).replaceAll('__SITE__', site);

const squeeze = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s*/g, '').replace(/>\s+</g, '><');
const page = fill(squeeze(source.slice(0, open))) + `<style>${css}</style>` + fill(squeeze(source.slice(close + 8))).replace(SCRIPT_TAG, `<script defer src="/assets/${script}"></script>`);
// The page is written as page.html, not index.html: the address "/" is answered by api/page.js, which puts
// the current numbers into it first.
await writeFile(path.join(out, 'page.html'), page);
await writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /page.html\nDisallow: /api/\nSitemap: ${site}/sitemap.xml\n`);
await writeFile(
  path.join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}/</loc><changefreq>always</changefreq></url></urlset>\n`,
);

const size = async (...file) => `${Math.round((await readFile(path.join(out, ...file))).length / 1024)} KB`;
console.log(`public/page.html ${await size('page.html')}, public/assets/${script} ${await size('assets', script)}`);
