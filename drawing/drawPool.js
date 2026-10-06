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

  /**
   * One contiguous slice per player, sized by entries, in list order (most
   * entries first). Built for any size of hat: EVERY player keeps their own
   * slice, so the picture never misstates anyone's share, but only the top
   * `maxNamed` get a colour and a name. The rest are `named: false` and the
   * page paints them as a two-tone band — at 3,000 players a 1-entry slice is
   * thinner than a pixel, and 3,000 hues would be noise.
   */
  var MAX_NAMED = 24;
  function wheelSlices(rows, maxNamed) {
    var limit = maxNamed == null ? MAX_NAMED : maxNamed;
    var total = rows.reduce(function (s, r) { return s + r.entries; }, 0);
    if (!total) return [];
    var at = 0;
    return rows.map(function (r, i) {
      var sweep = (r.entries / total) * Math.PI * 2;
      var named = i < limit;
      var s = { name: r.name, entries: r.entries, start: at, end: at + sweep,
        named: named, hue: named ? hueOf(i) : null, odds: oddsText(r.entries, total) };
      at += sweep;
      return s;
    });
  }

  /** The players sharing the unnamed band: { players, entries } (zeros if none). */
  function othersSummary(slices) {
    var o = { players: 0, entries: 0 };
    slices.forEach(function (s) { if (!s.named) { o.players += 1; o.entries += s.entries; } });
    return o;
  }

  /**
   * Which slice sits at an angle on the (unrotated) wheel: radians clockwise
   * from 12 o'clock, any value. Binary search, so a tap on a 3,000-player
   * wheel costs a dozen comparisons. -1 when there are no slices.
   */
  function sliceAt(slices, angle) {
    if (!slices.length) return -1;
    var TAU = Math.PI * 2;
    var a = ((angle % TAU) + TAU) % TAU;
    var lo = 0, hi = slices.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (a < slices[mid].end) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  /** Should this slice carry its name on the wheel? Named, and wide enough to read. */
  function showsLabel(s) { return s.named && (s.end - s.start) >= 0.16; }

  /** True when some named player's slice is too thin for their name: show a legend instead. */
  function needsLegend(slices) {
    return slices.some(function (s) { return s.named && !showsLabel(s); });
  }

  /**
   * Colour for an unnamed slice: a smooth sweep across the band (violet into
   * magenta) with a faint alternation so neighbours stay distinct. Two flat
   * tones shimmer (moiré) once slices are thinner than a pixel; a sweep doesn't.
   * `frac` is the slice's position through the band, 0..1.
   */
  function bandColor(i, frac, dim) {
    var hue = 262 + 52 * Math.max(0, Math.min(1, frac));
    var light = (dim ? 14 : 30) + (i % 2 ? 3 : 0);
    return 'hsl(' + hue.toFixed(1) + ' ' + (dim ? 30 : 62) + '% ' + light + '%)';
  }

  /**
   * One lightning arc crawling along the wheel's rim — decoration only, so it
   * stays ON THE RIM and never strikes a slice or the pointer (a bolt hitting a
   * player would read as the wheel choosing them). Pure: pass the random source.
   * Returns { main: [[x,y]…], branch: [[x,y]…] | null }; every point of the main
   * arc lies within `jitter` of the rim radius, and both ends sit exactly on it.
   */
  function rimBolt(rand, o) {
    var n = o.segments || 14;
    var start = o.start, span = o.span;
    var main = [];
    for (var k = 0; k <= n; k++) {
      var a = start + (span * k) / n;
      var off = (k === 0 || k === n) ? 0 : (rand() * 2 - 1) * o.jitter;
      main.push([o.cx + Math.cos(a) * (o.r + off), o.cy + Math.sin(a) * (o.r + off)]);
    }
    var branch = null;
    if (rand() < (o.branchChance == null ? 0.5 : o.branchChance)) {
      var from = 2 + Math.floor(rand() * (n - 4));
      var fa = start + (span * from) / n, dir = rand() < 0.5 ? -1 : 1;
      branch = [main[from]];
      for (var j = 1; j <= 4; j++) {
        var ba = fa + dir * (span / n) * j * 0.8;
        var br = o.r + (rand() * 2 - 1) * o.jitter;
        branch.push([o.cx + Math.cos(ba) * br, o.cy + Math.sin(ba) * br]);
      }
    }
    return { main: main, branch: branch };
  }

  /** How many list rows to show: the first page, more on request, all when searching. */
  function visibleRows(rows, shown, query) {
    if (String(query || '').trim()) return filterRows(rows, query);
    return rows.slice(0, shown);
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
    othersSummary: othersSummary,
    sliceAt: sliceAt,
    showsLabel: showsLabel,
    needsLegend: needsLegend,
    bandColor: bandColor,
    rimBolt: rimBolt,
    visibleRows: visibleRows,
    MAX_NAMED: MAX_NAMED,
    restRotation: restRotation,
    videoFor: videoFor,
    lastVideo: lastVideo,
    cardText: cardText,
  };
});
