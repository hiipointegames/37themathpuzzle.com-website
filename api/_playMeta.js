// The /play/<code> link preview: the player's own card when there is one.
//
// David (2026-10-04): a Daily share now sends text + link only, and the LINK
// PREVIEW is the player's card (the app uploads it to the share-cards bucket
// before the Share tap). Link previews come from the page's og:image, read by
// crawlers that never run the page's JavaScript, so the meta tags have to be
// right in the HTML itself. api/play.js serves play/index.html through
// renderPlayPage.
//
// Fails toward the generic card: a bad code, no card yet (a slow upload), a
// timeout, or any Supabase error all leave the page exactly as it was. The card
// is only used when has_share_card(code) is true, i.e. the uploader is the
// account that saved that share link (migration 20261004100000 in the app repo).
'use strict';

const SUPABASE_URL = 'https://xpruolmmhssfrgqkcfqx.supabase.co';
// Publishable (public) key, the same one play/index.html already ships.
const SUPABASE_KEY = 'sb_publishable_inh_7hk5qODnKu-fLBGVmw_N4codqp9';
const CODE_RE = /^[a-z0-9]{6,12}$/;
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 760;
const GENERIC_IMAGE = 'https://www.37themathpuzzle.com/og-card.jpg';

function cardImageUrl(code, supabaseUrl = SUPABASE_URL) {
  return `${supabaseUrl}/storage/v1/object/public/share-cards/${code}.jpg`;
}

/** The code from /play/<code>, or null when it is not a share code. */
function codeFrom(value) {
  const code = String(value || '').toLowerCase().replace(/\/+$/, '');
  return CODE_RE.test(code) ? code : null;
}

/**
 * Ask Supabase whether <code> has a card the site may show. Never throws.
 * @returns {Promise<boolean>}
 */
async function hasShareCard(code, { fetchImpl = fetch, timeoutMs = 1500, supabaseUrl = SUPABASE_URL, key = SUPABASE_KEY } = {}) {
  if (!codeFrom(code)) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/has_share_card`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch (_err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * play/index.html with its preview tags pointing at this share. Pure.
 * @param {string} html the static page
 * @param {{ code: string|null, hasCard: boolean, supabaseUrl?: string }} p
 */
function renderPlayPage(html, { code, hasCard, supabaseUrl = SUPABASE_URL }) {
  if (!code) return html;
  let out = html.replace(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="https://www.37themathpuzzle.com/play/${code}">`,
  );
  if (!hasCard) return out;
  const img = cardImageUrl(code, supabaseUrl);
  out = out
    .split(`content="${GENERIC_IMAGE}"`).join(`content="${img}"`)
    .replace(
      /(<meta property="og:image" content="[^"]*">)/,
      `$1\n<meta property="og:image:width" content="${CARD_WIDTH}">\n<meta property="og:image:height" content="${CARD_HEIGHT}">\n<meta property="og:image:type" content="image/jpeg">`,
    );
  return out;
}

module.exports = { codeFrom, hasShareCard, renderPlayPage, cardImageUrl, GENERIC_IMAGE, SUPABASE_URL };
