// The app icons are drawn at build time from the favicon's design.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { iconPng } from '../lib/icons.js';

test('an icon is a PNG of the asked size, with clear corners unless it is maskable', () => {
  for (const maskable of [false, true]) {
    const png = iconPng(64, { maskable });
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), 64);
    assert.equal(png.readUInt32BE(20), 64);
    const start = png.indexOf('IDAT') + 4;
    const pixels = inflateSync(png.subarray(start, start + png.readUInt32BE(start - 8)));
    const cornerAlpha = pixels[1 + 3]; // the first pixel of the first row
    assert.equal(cornerAlpha, maskable ? 255 : 0);
  }
});
