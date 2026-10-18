// Run: node --test drawing/liveDraw.test.js
// Tests for the live Sunday draw's timing logic (drawing/liveDraw.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const L = require('./liveDraw');

const TAU = Math.PI * 2;
const PLAYERS = [
  { name: 'stutz', entries: 21 }, { name: 'libb', entries: 7 },
  { name: 'megdob', entries: 3 }, { name: 'ringster', entries: 1 },
];

function bigPlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ name: 'p' + i, entries: 1 + (i % 5) }));
}

test('clockOffset assumes the server read its clock mid round trip', () => {
  assert.strictEqual(L.clockOffset('2026-10-19T01:00:00.000Z', Date.parse('2026-10-19T00:59:00Z') - 100, Date.parse('2026-10-19T00:59:00Z') + 100), 60000);
  assert.strictEqual(L.clockOffset('not a date', 0, 10), 0);
  assert.strictEqual(L.clockOffset(undefined, 0, 10), 0);
});

test('live mode: only on the drawing Sunday (Eastern), once the week is locked', () => {
  const sun = { drawing: '2026-10-18', daysRecorded: 7, winner: null };
  const sunNoonET = Date.parse('2026-10-18T16:00:00Z');
  assert.strictEqual(L.isLiveDay(sun, sunNoonET), true);
  // 11:30pm CT Saturday = 00:30 ET Sunday: already live
  assert.strictEqual(L.isLiveDay(sun, Date.parse('2026-10-18T04:30:00Z')), true);
  // 11:30pm ET Saturday: not yet
  assert.strictEqual(L.isLiveDay(sun, Date.parse('2026-10-18T03:30:00Z')), false);
  // Monday 00:30 ET (still Sunday evening in CT): back to the week page
  assert.strictEqual(L.isLiveDay(sun, Date.parse('2026-10-19T04:30:00Z')), false);
  // Sunday but a day missing: stay on the week page (the draw would refuse anyway)
  assert.strictEqual(L.isLiveDay({ ...sun, daysRecorded: 6 }, sunNoonET), false);
  // a winner recorded by hand also counts as locked
  assert.strictEqual(L.isLiveDay({ ...sun, daysRecorded: 6, winner: { name: 'x' } }, sunNoonET), true);
  // a weekday: the next Sunday's week
  assert.strictEqual(L.isLiveDay({ drawing: '2026-10-25', daysRecorded: 1 }, sunNoonET), false);
  assert.strictEqual(L.isLiveDay(null, sunNoonET), false);
});

test('seeded random is repeatable and in [0, 1)', () => {
  const a = L.seeded(1036438210), b = L.seeded(1036438210), c = L.seeded(7);
  const xs = Array.from({ length: 50 }, a);
  assert.deepStrictEqual(Array.from({ length: 50 }, b), xs);
  assert.notDeepStrictEqual(Array.from({ length: 50 }, c), xs);
  for (const x of xs) assert.ok(x >= 0 && x < 1);
  assert.ok(Number.isFinite(L.seeded(0)()));   // seed 0 still works
});

test('tickets are contiguous, in the server\'s order', () => {
  const pool = L.ticketPool(PLAYERS);
  assert.deepStrictEqual(pool.map((p) => p.first), [0, 21, 28, 31]);
  assert.strictEqual(L.totalOf(pool), 32);
  assert.strictEqual(L.holderOf(pool, 0), 0);
  assert.strictEqual(L.holderOf(pool, 20), 0);
  assert.strictEqual(L.holderOf(pool, 21), 1);
  assert.strictEqual(L.holderOf(pool, 30), 2);
  assert.strictEqual(L.holderOf(pool, 31), 3);
});

test('landingTicket trusts the server ticket only when it is the winner\'s', () => {
  const pool = L.ticketPool(PLAYERS);
  assert.strictEqual(L.landingTicket(pool, { name: 'libb', ticket: 25 }), 25);
  // ticket points at someone else: land mid-way through the winner's tickets
  assert.strictEqual(L.landingTicket(pool, { name: 'libb', ticket: 3 }), 24);
  assert.strictEqual(L.landingTicket(pool, { name: 'ringster', ticket: null }), 31);
  assert.strictEqual(L.landingTicket(pool, { name: 'libb', ticket: 999 }), 24);
  assert.strictEqual(L.landingTicket(pool, { name: 'nobody', ticket: 2 }), -1);
});

test('a small pool is one spin, and it stops on the ticket', () => {
  const pool = L.ticketPool(PLAYERS);
  for (const ticket of [0, 20, 21, 27, 30, 31]) {
    const tl = L.timeline(pool, ticket, 12345);
    assert.strictEqual(tl.spins.length, 1);
    assert.strictEqual(tl.endMs, L.SINGLE_MS);
    const s = tl.spins[0];
    const end = L.rotationAt(s, s.dur).rot;
    assert.strictEqual(end, L.spinTarget(s));
    // the unit under the 12 o'clock pointer after turning by `end`
    const seg = TAU / s.view.n;
    const under = Math.floor((((-end) % TAU) + TAU) % TAU / seg);
    assert.strictEqual(under, ticket, 'ticket ' + ticket);
    assert.strictEqual(s.view.slices[s.hot].label, pool[L.holderOf(pool, ticket)].name);
  }
});

test('every page computes the same spin from the same seed', () => {
  const pool = L.ticketPool(PLAYERS);
  const a = L.timeline(pool, 25, 99), b = L.timeline(pool, 25, 99);
  for (const el of [0, 100, 419, 420, 1000, 4000, 8199, 8200]) {
    assert.strictEqual(L.rotationAt(a.spins[0], el).rot, L.rotationAt(b.spins[0], el).rot);
  }
  assert.ok(a.spins[0].turns >= 9 && a.spins[0].turns <= 11);
});

test('the wind-up pulls back, then the wheel turns forward and slows', () => {
  const s = L.timeline(L.ticketPool(PLAYERS), 5, 3).spins[0];
  assert.ok(L.rotationAt(s, 210).rot < 0);
  let prev = L.rotationAt(s, 420).rot, prevStep = Infinity;
  for (let el = 1420; el <= 8200; el += 1000) {
    const r = L.rotationAt(s, el).rot;
    assert.ok(r > prev);
    assert.ok(r - prev < prevStep);   // slowing down
    prevStep = r - prev; prev = r;
  }
});

test('a big pool narrows in stages and still lands on the ticket\'s owner', () => {
  const pool = L.ticketPool(bigPlayers(600));
  const total = L.totalOf(pool);
  for (const ticket of [0, 1, Math.floor(total / 2), total - 1]) {
    const tl = L.timeline(pool, ticket, 42);
    assert.ok(tl.spins.length >= 2);
    const last = tl.spins[tl.spins.length - 1];
    assert.ok(last.view.slices.length <= 44);
    assert.strictEqual(last.view.slices[last.hot].label, pool[L.holderOf(pool, ticket)].name);
    // every range stage's hot slice contains the ticket
    tl.spins.filter((s) => s.range).forEach((s) => assert.ok(ticket >= s.range.lo && ticket < s.range.hi));
    // spins are back to back with a pause between
    for (let k = 1; k < tl.spins.length; k++) assert.ok(tl.spins[k].start > tl.spins[k - 1].start + tl.spins[k - 1].dur);
  }
});

test('member views size each player by their tickets inside the range', () => {
  const pool = L.ticketPool(bigPlayers(600));
  const tl = L.timeline(pool, 777, 1);
  const last = tl.spins[tl.spins.length - 1];
  assert.strictEqual(last.view.slices.reduce((s, x) => s + x.count, 0), last.view.n);
});

test('phases: countdown, the show, spin, reveal, drawn', () => {
  const pool = L.ticketPool(PLAYERS);
  const drawAt = Date.parse('2026-10-19T01:00:00Z');
  const spinAt = drawAt + L.SHOW_MS;               // 9:01:00 ET, as the server sets it
  assert.deepStrictEqual(L.phaseAt(null, drawAt, null, drawAt - 5000), { phase: 'countdown', msLeft: 5000 });
  // 9:00:03: the show runs on the page's own clock, before any result is public
  const show = L.phaseAt(null, drawAt, null, drawAt + 3000);
  assert.strictEqual(show.phase, 'show');
  assert.strictEqual(show.el, 3000);
  assert.strictEqual(show.msLeft, L.SHOW_MS - 3000);
  // past 9:01 with no result: waiting, then late
  assert.strictEqual(L.phaseAt(null, drawAt, null, drawAt + L.SHOW_MS + 1000).phase, 'waiting');
  assert.strictEqual(L.phaseAt(null, drawAt, null, drawAt + L.LATE_AFTER_MS + 1).phase, 'late');
  const tl = L.timeline(pool, 25, 5);
  // the result arrives 2 s before the spin: still the show, counting to spinAt
  const pre = L.phaseAt(tl, drawAt, spinAt, spinAt - 2000);
  assert.strictEqual(pre.phase, 'show');
  assert.strictEqual(pre.msLeft, 2000);
  const mid = L.phaseAt(tl, drawAt, spinAt, spinAt + 4000);
  assert.strictEqual(mid.phase, 'spinning');
  assert.strictEqual(mid.el, 4000);
  const rv = L.phaseAt(tl, drawAt, spinAt, spinAt + tl.endMs + 1000);
  assert.deepStrictEqual(rv, { phase: 'reveal', el: 1000 });
  assert.strictEqual(L.phaseAt(tl, drawAt, spinAt, spinAt + tl.endMs + L.REVEAL_MS).phase, 'drawn');
  // a late result (hand-recorded at 9:10) spins when its spinAt comes
  const late = drawAt + 600000;
  assert.strictEqual(L.phaseAt(tl, drawAt, late, late - 1000).phase, 'waiting');
  assert.strictEqual(L.phaseAt(tl, drawAt, late, late + 10).phase, 'spinning');
  // a replay (drawAt = -Infinity) skips the show
  assert.strictEqual(L.phaseAt(tl, -Infinity, spinAt, spinAt - 500).phase, 'waiting');
  assert.strictEqual(L.phaseAt(tl, -Infinity, spinAt, spinAt + 100).phase, 'spinning');
});

test('the show: the randomizer, three 14 s thank-you slides, a 10 s countdown, the spin at 9:01', () => {
  assert.strictEqual(L.SHOW_MS, 60000);
  assert.strictEqual(L.slideAt(0), 0);
  assert.strictEqual(L.slideAt(7999), 0);
  assert.strictEqual(L.slideAt(8000), 1);
  assert.strictEqual(L.slideAt(21999), 1);
  assert.strictEqual(L.slideAt(22000), 2);
  assert.strictEqual(L.slideAt(36000), 3);
  // the last slide ends exactly where the countdown begins: nothing is cut off
  assert.strictEqual(36000 + 14000, L.SHOW_MS - L.COUNTDOWN_MS);
  assert.ok(L.THANKS_AT < L.REVEAL_MS && L.REVEAL_MS >= 5000 && L.REVEAL_MS <= 7000);
});

test('the countdown: 10 … 1 over the last 10 s, nothing before or after', () => {
  assert.strictEqual(L.countdownAt(10001), 0);
  assert.strictEqual(L.countdownAt(10000), 10);
  assert.strictEqual(L.countdownAt(9001), 10);
  assert.strictEqual(L.countdownAt(9000), 9);
  assert.strictEqual(L.countdownAt(1), 1);
  assert.strictEqual(L.countdownAt(0), 0);
  assert.strictEqual(L.countdownAt(-5), 0);
  assert.strictEqual(L.countdownAt(undefined), 0);
});

test('phases: a staged draw pauses between spins', () => {
  const pool = L.ticketPool(bigPlayers(600));
  const tl = L.timeline(pool, 100, 5);
  const gap = tl.spins[0].dur + 500;
  const ph = L.phaseAt(tl, 0, 0, gap);
  assert.strictEqual(ph.phase, 'pause');
  assert.strictEqual(ph.spin, tl.spins[0]);
});

test('resting view: the whole pool when small, the first ranges when big', () => {
  assert.strictEqual(L.restingView(L.ticketPool(PLAYERS)).kind, 'single');
  assert.strictEqual(L.restingView(L.ticketPool(bigPlayers(600))).kind, 'ranges');
  assert.strictEqual(L.restingView([]).n, 0);
});

test('clockText', () => {
  assert.strictEqual(L.clockText(0), '0:00');
  assert.strictEqual(L.clockText(-5), '0:00');
  assert.strictEqual(L.clockText(59001), '1:00');
  assert.strictEqual(L.clockText(61000), '1:01');
  assert.strictEqual(L.clockText(3600000 * 9 + 26 * 60000 + 5000), '9:26:05');
});
