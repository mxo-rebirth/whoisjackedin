import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteUrl } from '../lib/site.js';

test('the site address: MXO_SITE first, then the production domain, then the local server', () => {
  assert.equal(siteUrl({ MXO_SITE: 'https://example.org/', VERCEL_PROJECT_PRODUCTION_URL: 'other.example' }), 'https://example.org');
  assert.equal(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'example.org' }), 'https://example.org');
  assert.equal(siteUrl({ PORT: '5199' }), 'http://127.0.0.1:5199');
});
