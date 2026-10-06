// The /drawing page's logic, kept apart from the page so it can be tested:
//   node --test drawing/drawPool.test.js
//
// Input is what Supabase's get_contest_pool() returns (migration
// 20261004200000_contest_public_pool.sql in the app repo):
//   { drawing, from, to, through, updatedAt, daysRecorded, totalEntries,
//     players: [{ name, entries }], winner: { name, ticket, totalEntries, drawnAt } | null,
//     firstDrawing, lastDrawing }
// Output is a plain view model the page renders with textContent only.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DrawPool = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ET = 'America/New_York';
  var FIRST_EVER_DRAWING = '2026-09-27';   // drawing 1; the public list starts at drawing 3
  var DAY = 24 * 60 * 60 * 1000;

  /** '2026-10-11' -> a Date at noon UTC that day (safe from DST edges). */
  function isoDay(iso) {
    var p = String(iso).split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
  }

  /** 'Sun 11 Oct' */
  function shortDate(iso) {
    return isoDay(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  /** Which drawing this is, counting the first (27 Sep 2026) as 1. */
  function drawingNumber(iso, firstIso) {
    return Math.round((isoDay(iso) - isoDay(firstIso || FIRST_EVER_DRAWING)) / (7 * DAY)) + 1;
  }

  /** Minutes Eastern Time is behind UTC at a moment (240 in EDT, 300 in EST). */
  function etOffsetMinutes(date) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, timeZoneName: 'shortOffset' })
      .formatToParts(date);
    var name = (parts.find(function (p) { return p.type === 'timeZoneName'; }) || {}).value || 'GMT-5';
    var m = name.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return 300;
    var h = Number(m[1]);
    return -(h * 60 + (h < 0 ? -1 : 1) * Number(m[2] || 0));
  }

  /** The moment the rules promise a winner by: 9:00pm ET on the drawing Sunday. */
  function drawDeadline(drawingIso) {
    var p = drawingIso.split('-').map(Number);
    var guess = new Date(Date.UTC(p[0], p[1] - 1, p[2], 21, 0));
    return new Date(guess.getTime() + etOffsetMinutes(guess) * 60000);
  }

  /** '6d 4h' / '3h 12m' / '12m' / 'any minute' */
  function countdownText(ms) {
    if (!(ms > 0)) return 'any minute';
    var mins = Math.floor(ms / 60000);
    var d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return Math.max(1, m) + 'm';
  }

  /** '12.5%'; anything above zero but under 0.1 reads '<0.1%', never '0.0%'. */
  function oddsText(entries, total) {
    if (!total || !entries) return '0%';
    var pct = (entries / total) * 100;
    if (pct < 0.1) return '<0.1%';
    return (Math.round(pct * 10) / 10).toFixed(1) + '%';
  }

  /** 'Mon 5 Oct, 1:10 AM ET' */
  function updatedText(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: ET });
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET });
    return day + ', ' + time + ' ET';
  }

  /** Competition ranking: equal entries share a rank (1, 1, 3). */
  function rankRows(players, total) {
    var top = players.length ? players[0].entries : 0;
    var rank = 0, prev = null;
    return players.map(function (p, i) {
      if (p.entries !== prev) { rank = i + 1; prev = p.entries; }
      return {
        rank: rank,
        name: String(p.name),
        entries: p.entries,
        odds: oddsText(p.entries, total),
        bar: top ? Math.max(2, Math.round((p.entries / top) * 100)) : 0,
      };
    });
  }

  /**
   * Turn the RPC result into what the page shows.
   * state: 'live' (entries in), 'waiting' (no day saved yet), 'drawn' (winner
   * recorded), 'ended' (after the last drawing).
   */
  function viewModel(pool, nowMs) {
    var now = nowMs == null ? Date.now() : nowMs;
    var players = Array.isArray(pool.players) ? pool.players.slice() : [];
    players.sort(function (a, b) { return b.entries - a.entries || String(a.name).localeCompare(String(b.name)); });
    var total = players.reduce(function (s, p) { return s + p.entries; }, 0);
    var deadline = drawDeadline(pool.drawing);
    var state = pool.winner ? 'drawn'
      : pool.lastDrawing && pool.drawing > pool.lastDrawing ? 'ended'
      : (pool.daysRecorded || 0) === 0 ? 'waiting'
      : 'live';

    return {
      state: state,
      drawingIso: pool.drawing,
      number: drawingNumber(pool.drawing),
      totalDrawings: drawingNumber(pool.lastDrawing || '2027-02-28'),
      drawingText: shortDate(pool.drawing),
      rangeText: shortDate(pool.from) + ' – ' + shortDate(pool.to),
      throughText: pool.through ? shortDate(pool.through) : '',
      updatedText: pool.updatedAt ? updatedText(pool.updatedAt) : '',
      totalEntries: total,
      playerCount: players.length,
      countdown: countdownText(deadline.getTime() - now),
      // Days of the week still open for entries, today (Eastern) included.
      daysLeft: Math.max(0, Math.round((isoDay(pool.to) - isoDay(new Date(now).toLocaleDateString('en-CA', { timeZone: ET }))) / DAY) + 1),
      rows: rankRows(players, total),
      winner: pool.winner ? {
        name: String(pool.winner.name),
        ticketText: pool.winner.ticket != null
          ? 'ticket ' + pool.winner.ticket + ' of ' + pool.winner.totalEntries
          : pool.winner.totalEntries + ' entries in the hat',
      } : null,
    };
  }

  // ── The wheel picture ────────────────────────────────────────────────────
  // A still picture of the hat, never a spinner: visitors cannot spin it, and
  // nothing on the page animates as if a draw were happening. Angles are in
  // radians, measured clockwise from 12 o'clock (where the pointer sits).

  /** Same golden-angle hues as the drawing wheel, so a player keeps a colour. */
  function hueOf(i) { return (282 + i * 137.508) % 360; }

  /** One contiguous slice per player, sized by entries, in list order. */
  function wheelSlices(rows) {
    var total = rows.reduce(function (s, r) { return s + r.entries; }, 0);
    if (!total) return [];
    var at = 0;
    return rows.map(function (r, i) {
      var sweep = (r.entries / total) * Math.PI * 2;
      var s = { name: r.name, entries: r.entries, start: at, end: at + sweep, hue: hueOf(i) };
      at += sweep;
      return s;
    });
  }

  /**
   * How far to turn the wheel so it rests with the winner's slice under the
   * pointer (0 when there is no winner, or the winner is not in the list).
   */
  function restRotation(slices, winnerName) {
    if (!winnerName) return 0;
    for (var i = 0; i < slices.length; i++) {
      if (slices[i].name === winnerName) return -((slices[i].start + slices[i].end) / 2);
    }
    return 0;
  }

  // ── Draw videos ──────────────────────────────────────────────────────────
  // drawing/videos.json maps a drawing date to its video: { "2026-10-11": "https://…" }.
  // Only https links are ever used; anything else is ignored.
  function safeUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null; }

  /** This drawing's video, if posted. */
  function videoFor(videos, drawingIso) {
    return videos ? safeUrl(videos[drawingIso]) : null;
  }

  /** The most recent earlier drawing that has a video: { drawing, url } or null. */
  function lastVideo(videos, drawingIso) {
    if (!videos) return null;
    var keys = Object.keys(videos).filter(function (k) {
      return /^\d{4}-\d{2}-\d{2}$/.test(k) && k < drawingIso && safeUrl(videos[k]);
    }).sort();
    if (!keys.length) return null;
    var k = keys[keys.length - 1];
    return { drawing: k, dateText: shortDate(k), url: safeUrl(videos[k]) };
  }

  // ── The homepage card ────────────────────────────────────────────────────
  /** What the live card on the homepage says, for each state of the week. */
  function cardText(vm) {
    var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };
    if (vm.state === 'drawn' && vm.winner) {
      return { eyebrow: '$37 drawing · ' + vm.drawingText, stats: 'Winner: ' + vm.winner.name, cta: 'See the wheel' };
    }
    if (vm.state === 'ended') {
      return { eyebrow: '$37 weekly drawing', stats: 'The giveaway has ended. Thanks for playing!', cta: 'See the last drawing' };
    }
    if (vm.state === 'waiting' || vm.totalEntries === 0) {
      return { eyebrow: '$37 drawing · ' + vm.drawingText, stats: 'A new week has started. Finish a Daily to get in the hat.', cta: 'See this week’s hat' };
    }
    return {
      eyebrow: '$37 drawing · ' + vm.drawingText,
      stats: plural(vm.totalEntries, 'entry', 'entries') + ' · ' + plural(vm.playerCount, 'player', 'players') + ' · ' + vm.countdown + ' left',
      cta: 'See who’s in the hat',
    };
  }

  /** Rows whose name contains the query, case-insensitively. Empty query: all. */
  function filterRows(rows, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1; });
  }

  return {
    shortDate: shortDate,
    drawingNumber: drawingNumber,
    etOffsetMinutes: etOffsetMinutes,
    drawDeadline: drawDeadline,
    countdownText: countdownText,
    oddsText: oddsText,
    updatedText: updatedText,
    rankRows: rankRows,
    viewModel: viewModel,
    filterRows: filterRows,
    hueOf: hueOf,
    wheelSlices: wheelSlices,
    restRotation: restRotation,
    videoFor: videoFor,
    lastVideo: lastVideo,
    cardText: cardText,
  };
});
