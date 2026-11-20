// The rewrite rules in vercel.json, as the local server applies them.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { rewrite } from '../lib/rewrite.js';

const { rewrites } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const at = (path, cookies = {}) => {
  const url = rewrite(rewrites, new URL(path, 'http://localhost'), cookies);
  return url.pathname + url.search;
};

test('a hardline code in the path opens the private version', () => {
  assert.equal(at('/HL-7F3A-9C2D-41B0-E8D5-AA90'), '/api/page?code=HL-7F3A-9C2D-41B0-E8D5-AA90');
  assert.equal(at('/hl-7f3a-9c2d-41b0-e8d5-aa90'), '/api/page?code=hl-7f3a-9c2d-41b0-e8d5-aa90');
});

test('the home page, the saved cookie and other paths keep their rules', () => {
  assert.equal(at('/'), '/api/page');
  assert.equal(at('/', { hardline: 'x' }), '/api/page?saved=1&hardline=x');
  assert.equal(at('/HL-<script>'), '/HL-%3Cscript%3E');
  assert.equal(at('/assets/app.js'), '/assets/app.js');
});
