// GET /play/<code> (rewritten here by vercel.json): the share landing page,
// with the link preview pointing at that player's card. See ./_playMeta.js.
'use strict';

const fs = require('fs');
const path = require('path');
const { codeFrom, hasShareCard, renderPlayPage } = require('./_playMeta');

const PAGE = path.join(process.cwd(), 'play', 'index.html');

module.exports = async function handler(req, res) {
  const html = fs.readFileSync(PAGE, 'utf8');
  const code = codeFrom(req.query && req.query.code);
  const hasCard = code ? await hasShareCard(code) : false;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // A found card never changes (insert-only bucket), so cache it at the edge.
  // No card yet may just be a slow upload, so that answer must not stick.
  res.setHeader('Cache-Control', hasCard ? 'public, max-age=0, s-maxage=86400' : 'public, max-age=0, s-maxage=5');
  res.status(200).send(renderPlayPage(html, { code, hasCard }));
};
