// Run: node --test api/_playMeta.test.js
// Tests for the /play/<code> link preview (api/_playMeta.js, api/play.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { codeFrom, hasShareCard, renderPlayPage, cardImageUrl, GENERIC_IMAGE } = require('./_playMeta');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'play', 'index.html'), 'utf8');
const ogImage = (html) => (html.match(/<meta property="og:image" content="([^"]*)">/) || [])[1];
const twImage = (html) => (html.match(/<meta name="twitter:image" content="([^"]*)">/) || [])[1];
const ogUrl = (html) => (html.match(/<meta property="og:url" content="([^"]*)">/) || [])[1];

test('the static page still carries the generic image this replaces', () => {
  assert.strictEqual(ogImage(PAGE), GENERIC_IMAGE);
  assert.strictEqual(twImage(PAGE), GENERIC_IMAGE);
});

test('codeFrom accepts share codes only', () => {
  assert.strictEqual(codeFrom('k3xa2b9q'), 'k3xa2b9q');
  assert.strictEqual(codeFrom('K3XA2B9Q/'), 'k3xa2b9q');
  for (const bad of ['', null, undefined, 'abc', 'a'.repeat(13), '../etc', 'k3xa 2b9', '<script>']) {
    assert.strictEqual(codeFrom(bad), null, String(bad));
  }
});

test('with a card: og:image and twitter:image are the player card, sized, and og:url is the link', () => {
  const html = renderPlayPage(PAGE, { code: 'k3xa2b9q', hasCard: true });
  assert.strictEqual(ogImage(html), cardImageUrl('k3xa2b9q'));
  assert.strictEqual(twImage(html), cardImageUrl('k3xa2b9q'));
  assert.match(html, /<meta property="og:image:width" content="1080">/);
  assert.match(html, /<meta property="og:image:height" content="760">/);
  assert.strictEqual(ogUrl(html), 'https://www.37themathpuzzle.com/play/k3xa2b9q');
  assert.ok(!html.includes(GENERIC_IMAGE), 'generic image fully replaced');
});

test('without a card: the generic preview stays, only og:url changes', () => {
  const html = renderPlayPage(PAGE, { code: 'k3xa2b9q', hasCard: false });
  assert.strictEqual(ogImage(html), GENERIC_IMAGE);
  assert.strictEqual(twImage(html), GENERIC_IMAGE);
  assert.strictEqual(ogUrl(html), 'https://www.37themathpuzzle.com/play/k3xa2b9q');
});

test('no code: the page is returned untouched', () => {
  assert.strictEqual(renderPlayPage(PAGE, { code: null, hasCard: true }), PAGE);
});

test('the page body (greeting script, buttons) is unchanged either way', () => {
  const body = (h) => h.slice(h.indexOf('</head>'));
  assert.strictEqual(body(renderPlayPage(PAGE, { code: 'k3xa2b9q', hasCard: true })), body(PAGE));
});

const okJson = (v) => async () => ({ ok: true, json: async () => v });

test('hasShareCard: true only for a literal true from the RPC', async () => {
  assert.strictEqual(await hasShareCard('k3xa2b9q', { fetchImpl: okJson(true) }), true);
  assert.strictEqual(await hasShareCard('k3xa2b9q', { fetchImpl: okJson(false) }), false);
  assert.strictEqual(await hasShareCard('k3xa2b9q', { fetchImpl: okJson('true') }), false);
});

test('hasShareCard fails toward the generic card: HTTP error, throw, timeout, bad code', async () => {
  assert.strictEqual(await hasShareCard('k3xa2b9q', { fetchImpl: async () => ({ ok: false, json: async () => true }) }), false);
  assert.strictEqual(await hasShareCard('k3xa2b9q', { fetchImpl: async () => { throw new Error('offline'); } }), false);
  const hang = (_u, { signal }) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.strictEqual(await hasShareCard('k3xa2b9q', { fetchImpl: hang, timeoutMs: 20 }), false);
  let called = false;
  assert.strictEqual(await hasShareCard('../x', { fetchImpl: async () => { called = true; return { ok: true, json: async () => true }; } }), false);
  assert.strictEqual(called, false, 'a bad code never reaches Supabase');
});

test('hasShareCard asks the has_share_card RPC with the code', async () => {
  let seen;
  await hasShareCard('k3xa2b9q', { fetchImpl: async (url, opts) => { seen = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => true }; } });
  assert.match(seen.url, /\/rest\/v1\/rpc\/has_share_card$/);
  assert.deepStrictEqual(seen.body, { p_code: 'k3xa2b9q' });
});

test('handler: serves the page with the right preview and cache header', async () => {
  const handler = require('./play');
  const realFetch = global.fetch;
  try {
    for (const [answer, expectImg, cache] of [[true, cardImageUrl('k3xa2b9q'), /s-maxage=86400/], [false, GENERIC_IMAGE, /s-maxage=5\b/]]) {
      global.fetch = okJson(answer);
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; } };
      const cwd = process.cwd();
      process.chdir(path.join(__dirname, '..'));
      try { await handler({ query: { code: 'k3xa2b9q' } }, res); } finally { process.chdir(cwd); }
      assert.strictEqual(res.code, 200);
      assert.strictEqual(ogImage(res.body), expectImg);
      assert.match(res.headers['Cache-Control'], cache);
      assert.match(res.headers['Content-Type'], /text\/html/);
    }
  } finally {
    global.fetch = realFetch;
  }
});
