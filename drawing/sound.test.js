// Run: node --test drawing/sound.test.js
// Tests for the /drawing soundtrack's pure parts (drawing/sound.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const S = require('./sound');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('notes: A4 is 440 Hz, an octave doubles, A1 is the 55 Hz sub', () => {
  assert.ok(close(S.noteFreq(69), 440));
  assert.ok(close(S.noteFreq(81), 880));
  assert.ok(close(S.noteFreq(33), 55));
});

test('the progression runs Am, F, C, E and wraps either way', () => {
  assert.deepStrictEqual(S.chordAt(0), [45, 48, 52]);     // A C E
  assert.deepStrictEqual(S.chordAt(1), [41, 45, 48]);     // F A C
  assert.deepStrictEqual(S.chordAt(2), [48, 52, 55]);     // C E G
  assert.deepStrictEqual(S.chordAt(3), [40, 44, 47]);     // E G# B
  assert.deepStrictEqual(S.chordAt(4), S.chordAt(0));
  assert.deepStrictEqual(S.chordAt(-1), S.chordAt(3));
  const c = S.chordAt(0); c.push(99);                     // a copy, not the table
  assert.deepStrictEqual(S.chordAt(0), [45, 48, 52]);
});

test('heartbeat: lub-dub pairs at 72 bpm, each beat booked exactly once across windows', () => {
  const start = 10, period = 60 / 72;
  const a = S.heartbeatTimes(10, 11, 72, start);
  // 10.00 lub, 10.18 dub, 10.83 lub — its dub (11.01) belongs to the next window
  assert.deepStrictEqual(a.map((b) => b.accent), [true, false, true]);
  assert.ok(close(a[0].t, 10) && close(a[1].t, 10.18) && close(a[2].t, 10 + period));
  // Consecutive look-ahead windows never double-book or drop a beat.
  const windows = [[10, 10.6], [10.6, 11.2], [11.2, 11.8], [11.8, 12.4]];
  const all = windows.flatMap(([t0, t1]) => S.heartbeatTimes(t0, t1, 72, start)).map((b) => +b.t.toFixed(4));
  const whole = S.heartbeatTimes(10, 12.4, 72, start).map((b) => +b.t.toFixed(4));
  assert.deepStrictEqual(all, whole);
  assert.ok(close(whole[2], 10 + period, 1e-3));
});

test('thunder: close strikes arrive fast, distant ones later, never instantly', () => {
  const zero = () => 0;
  assert.ok(close(S.thunderDelay(1, zero), 0.06));
  assert.ok(close(S.thunderDelay(0, zero), 0.56));
  assert.ok(S.thunderDelay(0.5, () => 0.99) < 0.6);
  assert.ok(close(S.thunderDelay(7, zero), 0.06));        // clamped
});
