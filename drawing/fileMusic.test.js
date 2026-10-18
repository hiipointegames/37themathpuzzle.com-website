// Run: node --test drawing/fileMusic.test.js
// Tests for the live draw's FL Studio music player (drawing/fileMusic.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const F = require('./fileMusic');

test('full mode plays the groove only', () => {
  assert.deepStrictEqual(F.modeGains('full', true), { full: 1, tension: 0 });
  assert.deepStrictEqual(F.modeGains(undefined, true), { full: 1, tension: 0 });
});

test('tension mode swaps to the drums-and-bass loop', () => {
  assert.deepStrictEqual(F.modeGains('tension', true), { full: 0, tension: 1 });
});

test('tension mode without a tension file keeps the groove, quieter', () => {
  assert.deepStrictEqual(F.modeGains('tension', false), { full: 0.6, tension: 0 });
});

test('uses the files only once the groove has decoded, else falls back to the code-written music', () => {
  const synth = { create() {} };
  assert.strictEqual(F.pickPlayer({ full: {}, tension: null }, synth), 'file');
  assert.strictEqual(F.pickPlayer(null, synth), 'synth');
  assert.strictEqual(F.pickPlayer({ full: null }, synth), 'synth');
  assert.strictEqual(F.pickPlayer(null, null), 'none');
});

test('a missing groove file never breaks the show: preload resolves to null', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404 });
  try {
    const got = await F.preload({ decodeAudioData() {} });
    assert.strictEqual(got, null);
  } finally { global.fetch = realFetch; }
});

test('loops live under /drawing/music/', () => {
  assert.strictEqual(F.URLS.full, '/drawing/music/groove.wav');
  assert.strictEqual(F.URLS.tension, '/drawing/music/tension.wav');
});
