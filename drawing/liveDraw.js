// The live Sunday draw's timing logic, kept apart from the page so it can be
// tested:   node --test drawing/liveDraw.test.js
//
// THE IDEA. The database draws the ticket at 9:00pm ET (migration
// 20261018150000_contest_auto_draw.sql in the app repo) and publishes
// { ticket, seed, spinAt }. Every page then plays the SAME spin, because the
// wheel's position at any moment is a pure function of (pool, ticket, seed,
// time since spinAt). Nothing here chooses anything: the ticket is already
// drawn, and the seed only decides cosmetic things (how many turns, where in
// the winning slice it stops).
//
// Clock: each page measures how far its own clock is from the server's
// (`serverNow` in the pool JSON) and works in server time, so two phones whose
// clocks disagree by a minute still start the spin together.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveDraw = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ET = 'America/New_York';
  var TAU = Math.PI * 2;

  // ── Clock ────────────────────────────────────────────────────────────────
  /**
   * Server time minus local time, in ms, from one round trip: the server read
   * its clock somewhere between send and receive, so assume the middle.
   * 0 when the server time is missing or unreadable.
   */
  function clockOffset(serverNowIso, sentAt, receivedAt) {
    var s = Date.parse(serverNowIso);
    if (isNaN(s)) return 0;
    return s - (sentAt + receivedAt) / 2;
  }

  /** 'YYYY-MM-DD' in Eastern Time at a moment (ms). */
  function etDate(ms) {
    return new Date(ms).toLocaleDateString('en-CA', { timeZone: ET });
  }

  /**
   * Is /drawing in its Sunday "live draw" mode? Yes on the drawing Sunday
   * itself (Eastern), once the week is locked: all 7 days saved, or a winner
   * already recorded. Every other day /drawing is the all-week page.
   */
  function isLiveDay(pool, nowMs) {
    if (!pool || !pool.drawing) return false;
    if (etDate(nowMs) !== pool.drawing) return false;
    return Boolean(pool.winner) || (pool.daysRecorded || 0) >= 7;
  }

  // ── The draw's timeline ──────────────────────────────────────────────────
  // Same numbers the hand-run wheel used (drawing-wheel.html), so the live
  // draw looks like the draws people have already watched.
  var SINGLE_MS = 8200;          // one spin, small pools
  var RANGE_MS = 5200;           // a narrowing spin in a staged draw
  var LAST_MS = 6400;            // the deciding spin in a staged draw
  var PAUSE_MS = 1900;           // the beat between stages
  var WINDUP_MS = 420;           // the wheel draws back before it launches
  var WIND = 0.14;               // ...by this many radians
  var SINGLE_STAGE_MAX_PLAYERS = 44;
  var TARGET_PLAYERS_PER_GROUP = 25;
  var MAX_STAGES = 5;
  var LATE_AFTER_MS = 120000;    // no ticket 2 min after 9pm: say it's running late

  /** Small seeded PRNG (mulberry32): same seed, same numbers, every browser. */
  function seeded(seed) {
    var a = (Number(seed) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Players in ticket order, each with its first ticket. Order is the server's. */
  function ticketPool(players) {
    var at = 0;
    return (players || []).map(function (p, i) {
      var row = { i: i, name: String(p.name), entries: Math.max(0, p.entries | 0), first: at };
      at += row.entries;
      return row;
    }).filter(function (p) { return p.entries > 0; });
  }

  function totalOf(pool) { return pool.reduce(function (s, p) { return s + p.entries; }, 0); }

  /** Index into `pool` of the player holding ticket t (binary search). */
  function holderOf(pool, t) {
    var lo = 0, hi = pool.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (pool[mid].first <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /**
   * The ticket to land on. The server's ticket, when it falls inside the
   * winner's own tickets (it always should: the page shows the server's
   * order). If it somehow does not, the middle of the winner's tickets, so the
   * wheel can never show anyone but the recorded winner.
   */
  function landingTicket(pool, winner) {
    var total = totalOf(pool);
    var t = winner && Number.isInteger(winner.ticket) ? winner.ticket : -1;
    if (t >= 0 && t < total && pool[holderOf(pool, t)].name === winner.name) return t;
    for (var i = 0; i < pool.length; i++) {
      if (winner && pool[i].name === winner.name) return pool[i].first + Math.floor(pool[i].entries / 2);
    }
    return -1;
  }

  function playersIn(pool, lo, hi) {
    if (hi <= lo) return 0;
    return holderOf(pool, hi - 1) - holderOf(pool, lo) + 1;
  }

  function subRanges(lo, hi, g) {
    var span = hi - lo, out = [];
    for (var k = 0; k < g; k++) {
      var a = lo + Math.floor(k * span / g), b = lo + Math.floor((k + 1) * span / g);
      if (b > a) out.push({ lo: a, hi: b, count: b - a });
    }
    return out;
  }

  /**
   * How the reveal narrows to one ticket: one spin for a pool of up to 44
   * players, otherwise ranges of tickets first (the hand-run wheel's staged
   * draw). Presentation only; the ticket is already drawn.
   */
  function planStages(pool, ticket) {
    var stages = [], lo = 0, hi = totalOf(pool);
    for (var d = 0; d < MAX_STAGES; d++) {
      var players = playersIn(pool, lo, hi);
      if (players <= SINGLE_STAGE_MAX_PLAYERS) break;
      var g = Math.max(8, Math.min(40, Math.ceil(players / TARGET_PLAYERS_PER_GROUP)));
      var ranges = subRanges(lo, hi, g);
      var gi = -1;
      for (var r = 0; r < ranges.length; r++) if (ticket >= ranges[r].lo && ticket < ranges[r].hi) gi = r;
      if (gi < 0) break;
      stages.push({ kind: 'ranges', lo: lo, hi: hi, ranges: ranges, gi: gi });
      lo = ranges[gi].lo; hi = ranges[gi].hi;
    }
    stages.push({ kind: 'members', lo: lo, hi: hi });
    return stages;
  }

  /**
   * A view is what the wheel shows: slices, and the number of angular units
   * (tickets) they divide between them. `ci` is the player's colour index.
   */
  function singleView(pool) {
    return { kind: 'single', n: totalOf(pool), base: 0, slices: pool.map(function (p) {
      return { label: p.name, count: p.entries, ci: p.i, player: p.i };
    }) };
  }
  function rangeView(st) {
    return { kind: 'ranges', n: st.hi - st.lo, base: st.lo, slices: st.ranges.map(function (r, i) {
      return { label: r.lo.toLocaleString('en-US') + '–' + (r.hi - 1).toLocaleString('en-US'), count: r.count, ci: i, player: -1 };
    }) };
  }
  function memberView(pool, lo, hi) {
    var slices = [];
    for (var k = holderOf(pool, lo); k < pool.length && pool[k].first < hi; k++) {
      var p = pool[k];
      var a = Math.max(lo, p.first), b = Math.min(hi, p.first + p.entries);
      if (b > a) slices.push({ label: p.name, count: b - a, ci: p.i, player: p.i });
    }
    return { kind: 'members', n: hi - lo, base: lo, slices: slices };
  }

  /** The view the wheel shows before anything moves. */
  function restingView(pool) {
    if (!pool.length) return { kind: 'single', n: 0, base: 0, slices: [] };
    var st = planStages(pool, 0);
    return st.length === 1 ? singleView(pool) : rangeView(st[0]);
  }

  /** Which slice of a view holds angular unit u. */
  function sliceAt(view, u) {
    var acc = 0;
    for (var i = 0; i < view.slices.length; i++) {
      acc += view.slices[i].count;
      if (u < acc) return i;
    }
    return view.slices.length - 1;
  }

  /**
   * The whole reveal as a list of spins with start times (ms after spinAt).
   * Each spin carries its view, the unit it must stop on, and its cosmetic
   * path from the seed. Returns { spins, endMs, winnerIndex, ticket }.
   */
  function timeline(pool, ticket, seed) {
    var rand = seeded(seed);
    var stages = planStages(pool, ticket);
    var spins = [], at = 0;
    stages.forEach(function (st, k) {
      var last = k === stages.length - 1;
      var single = stages.length === 1;
      var view = st.kind === 'ranges' ? rangeView(st) : (single ? singleView(pool) : memberView(pool, st.lo, st.hi));
      var unit = ticket - view.base;
      var dur = single ? SINGLE_MS : (last ? LAST_MS : RANGE_MS);
      spins.push({
        view: view, unit: unit, start: at, dur: dur,
        turns: 6 + Math.floor(rand() * 3),
        jitter: rand() - 0.5,                 // where in the slot it stops, ±31% of a ticket
        spotlight: last,
        hot: sliceAt(view, unit),
        stage: k + 1, of: stages.length,
        range: st.kind === 'ranges' ? st.ranges[st.gi] : null,
      });
      at += dur + (last ? 0 : PAUSE_MS);
    });
    return { spins: spins, endMs: at, winnerIndex: holderOf(pool, ticket), ticket: ticket };
  }

  function easeOut(p) { return 1 - Math.pow(1 - p, 4.2); }

  /** Where the wheel stops for a spin: radians, clockwise. */
  function spinTarget(spin) {
    var seg = TAU / spin.view.n;
    return spin.turns * TAU - (spin.unit + 0.5) * seg - spin.jitter * seg * 0.62;
  }

  /**
   * The wheel's angle `el` ms into a spin: a wind-up back of WIND radians,
   * then one long ease-out to the target. Same curve as the hand-run wheel.
   * Also returns p (0..1 through the main motion).
   */
  function rotationAt(spin, el) {
    if (el <= 0) return { rot: 0, p: 0 };
    if (el < WINDUP_MS) return { rot: -WIND * (0.5 - Math.cos(Math.PI * (el / WINDUP_MS)) / 2), p: 0 };
    var p = Math.min(1, (el - WINDUP_MS) / (spin.dur - WINDUP_MS));
    var from = -WIND, to = spinTarget(spin);
    return { rot: from + (to - from) * easeOut(p), p: p };
  }

  /**
   * Where the show is at server time `nowMs`.
   *   { phase: 'countdown' }             before 9pm ET, msLeft until it
   *   { phase: 'drumroll' }              9pm, waiting for the ticket or for spinAt
   *   { phase: 'late' }                  no ticket 2 min after 9pm
   *   { phase: 'spinning', spin, el }    spin #k is running, el ms in
   *   { phase: 'pause', spin }           between stages; spin = the one just landed
   *   { phase: 'drawn' }                 it's over
   * `drawAtMs` is 9pm ET on the drawing day; `spinAtMs` the server's spin
   * start (or when this page first saw a hand-recorded winner, plus a beat).
   */
  function phaseAt(tl, drawAtMs, spinAtMs, nowMs) {
    if (!tl) {
      if (nowMs < drawAtMs) return { phase: 'countdown', msLeft: drawAtMs - nowMs };
      return { phase: nowMs - drawAtMs < LATE_AFTER_MS ? 'drumroll' : 'late' };
    }
    var t = nowMs - spinAtMs;
    if (t < 0) return nowMs < drawAtMs ? { phase: 'countdown', msLeft: drawAtMs - nowMs } : { phase: 'drumroll', msLeft: -t };
    if (t >= tl.endMs) return { phase: 'drawn' };
    for (var k = 0; k < tl.spins.length; k++) {
      var s = tl.spins[k];
      if (t < s.start) return { phase: 'pause', spin: tl.spins[k - 1], index: k - 1 };
      if (t < s.start + s.dur) return { phase: 'spinning', spin: s, index: k, el: t - s.start };
    }
    return { phase: 'drawn' };
  }

  /** 'H:MM:SS' or 'M:SS' for a countdown; '0:00' once it's due. */
  function clockText(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    var mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(x).padStart(2, '0');
  }

  return {
    clockOffset: clockOffset, etDate: etDate, isLiveDay: isLiveDay,
    seeded: seeded, ticketPool: ticketPool, totalOf: totalOf, holderOf: holderOf,
    landingTicket: landingTicket, planStages: planStages, restingView: restingView,
    singleView: singleView, sliceAt: sliceAt, timeline: timeline, spinTarget: spinTarget,
    rotationAt: rotationAt, phaseAt: phaseAt, clockText: clockText,
    SINGLE_MS: SINGLE_MS, WINDUP_MS: WINDUP_MS, LATE_AFTER_MS: LATE_AFTER_MS,
  };
});
