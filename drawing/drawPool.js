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

  /**
   * Which of a bolt's flicker shapes to show at `age` ms. Clamped at BOTH ends:
   * a bolt spawned from a timer can carry a timestamp a few ms later than the
   * animation frame that draws it, so `age` can be negative — and shape -1 was
   * undefined, which threw inside the animation loop and froze the wheel
   * (2026-10-05).
   */
  function flickerIndex(age, shapes, msPerShape) {
    return Math.max(0, Math.min(shapes - 1, Math.floor(age / msPerShape)));
  }

  /**
   * A sky bolt for the page-wide lightning: a jagged path from (x0,y0) to
   * (x1,y1) by midpoint displacement, plus a few forks. Pure: pass the random
   * source. Returns an array of polylines; the first is the main channel and
   * starts and ends exactly at the given points.
   */
  function skyBolt(rand, o) {
    var depth = o.depth == null ? 6 : o.depth;
    var rough = o.roughness == null ? 0.22 : o.roughness;
    function split(a, b, d, off) {
      if (d === 0) return [a, b];
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var shift = (rand() * 2 - 1) * off;
      var m = [mx + (-dy / len) * shift, my + (dx / len) * shift];
      var left = split(a, m, d - 1, off / 2);
      return left.concat(split(m, b, d - 1, off / 2).slice(1));
    }
    var dist = Math.sqrt(Math.pow(o.x1 - o.x0, 2) + Math.pow(o.y1 - o.y0, 2));
    var main = split([o.x0, o.y0], [o.x1, o.y1], depth, dist * rough);
    var paths = [main];
    var forks = o.forks == null ? 3 : o.forks;
    for (var f = 0; f < forks; f++) {
      var at = main[1 + Math.floor(rand() * (main.length - 3))];
      var ang = Math.atan2(o.y1 - o.y0, o.x1 - o.x0) + (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.6);
      var flen = dist * (0.12 + rand() * 0.22);
      paths.push(split(at, [at[0] + Math.cos(ang) * flen, at[1] + Math.sin(ang) * flen], depth - 2, flen * rough));
    }
    return paths;
  }

  /**
   * The black hole's timeline over `t` = 0..1 of its run: the hole opens, the
   * wheel spirals in (shrinks, turns faster, fades), the hole collapses with a
   * flash, and the wheel bursts back out with a small overshoot.
   * Returns { wheelScale, wheelAlpha, extraTurn, holeRadius (0..1 of the wheel), flash }.
   */
  function blackHolePhase(t) {
    var x = Math.max(0, Math.min(1, t));
    var ease = function (p) { return p * p * (3 - 2 * p); };
    if (x < 0.12) {                                 // the hole opens
      var o = ease(x / 0.12);
      return { wheelScale: 1, wheelAlpha: 1, extraTurn: 0, holeRadius: 0.35 * o, flash: 0 };
    }
    if (x < 0.5) {                                  // the wheel spirals in
      var s = ease((x - 0.12) / 0.38);
      return { wheelScale: 1 - s, wheelAlpha: 1 - s * s, extraTurn: s * s * Math.PI * 6,
        holeRadius: 0.35 + 0.1 * s, flash: 0 };
    }
    if (x < 0.62) {                                 // gone; the hole collapses and flashes
      var c = (x - 0.5) / 0.12;
      return { wheelScale: 0, wheelAlpha: 0, extraTurn: 0, holeRadius: 0.45 * (1 - ease(c)),
        flash: c > 0.7 ? (c - 0.7) / 0.3 : 0 };
    }
    var b = (x - 0.62) / 0.38;                      // the wheel bursts back out
    var over = b < 0.7 ? ease(b / 0.7) * 1.08 : 1.08 - 0.08 * ease((b - 0.7) / 0.3);
    return { wheelScale: over, wheelAlpha: Math.min(1, b * 2.5), extraTurn: (1 - ease(b)) * -Math.PI * 2,
      holeRadius: 0, flash: b < 0.25 ? 1 - b / 0.25 : 0 };
  }

  // ── The teaser spin ──────────────────────────────────────────────────────
  // Every so often a lightning pulse spins the wheel and asks "Will the winner
  // be …?". It is a demonstration, never a draw: the page labels it as a
  // teaser in the same frame, and it stops once a real winner is recorded.
  // It picks FAIRLY — a uniformly random angle lands on a slice with
  // probability equal to that player's share of the entries, exactly the odds
  // of the real draw — so even the teaser never favours anyone.

  /** A fair teaser pick: index of the slice under a uniformly random angle. */
  function pickTeaser(slices, rand) {
    return sliceAt(slices, rand() * Math.PI * 2);
  }

  /**
   * Where a spin from `current` must stop so slice `s` rests under the pointer:
   * always forward (larger turn), at least `extraTurns` full turns, landing in
   * the slice's middle half so it never stops on a boundary.
   */
  function spinTarget(current, s, rand, extraTurns) {
    var TAU = Math.PI * 2;
    var a = s.start + (s.end - s.start) * (0.25 + 0.5 * rand());
    var delta = (((-a - current) % TAU) + TAU) % TAU;
    return current + delta + TAU * (extraTurns == null ? 2 : extraTurns);
  }

  /** Ease-out for the spin: fast start, gentle stop. */
  function easeOutCubic(p) { var q = 1 - Math.max(0, Math.min(1, p)); return 1 - q * q * q; }

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
    flickerIndex: flickerIndex,
    skyBolt: skyBolt,
    blackHolePhase: blackHolePhase,
    pickTeaser: pickTeaser,
    spinTarget: spinTarget,
    easeOutCubic: easeOutCubic,
    visibleRows: visibleRows,
    MAX_NAMED: MAX_NAMED,
    restRotation: restRotation,
    videoFor: videoFor,
    lastVideo: lastVideo,
    cardText: cardText,
  };
});
