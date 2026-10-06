// Run: node --test drawing/sound.test.js
// Tests for the /drawing soundtrack's pure parts (drawing/sound.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const S = require('./sound');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('notes: A4 is 440 Hz, an octave doubles, D2 is the sub', () => {
  assert.ok(close(S.noteFreq(69), 440));
  assert.ok(close(S.noteFreq(81), 880));
  assert.ok(close(S.noteFreq(38), 73.41619, 1e-4));
});

test('the pad drifts Dmaj9, Bm9, Gmaj7#11, A6/9 and wraps either way', () => {
  const names = (c) => c.map((m) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12]).join(' ');
  assert.strictEqual(names(S.chordAt(0)), 'D A C# E F#');
  assert.strictEqual(names(S.chordAt(1)), 'B F# A C# D');
  assert.strictEqual(names(S.chordAt(2)), 'G D F# C# F#');
  assert.strictEqual(names(S.chordAt(3)), 'A E F# B C#');
  assert.deepStrictEqual(S.chordAt(4), S.chordAt(0));
  assert.deepStrictEqual(S.chordAt(-1), S.chordAt(3));
  const c = S.chordAt(0); c.push(99);                     // a copy, not the table
  assert.strictEqual(S.chordAt(0).length, 5);
});

test('star twinkles stay in the sparkle range and only use the chord\'s notes', () => {
  for (let n = 0; n < 4; n++) {
    const chord = S.chordAt(n), pool = S.twinklePool(chord);
    assert.ok(pool.length >= 4, 'enough stars to choose from');
    assert.ok(pool.every((m) => m >= 74 && m <= 98), 'all in MIDI 74..98');
    const classes = new Set(chord.map((m) => m % 12));
    assert.ok(pool.every((m) => classes.has(m % 12)), 'consonant with the pad');
    assert.deepStrictEqual(pool, [...new Set(pool)].sort((a, b) => a - b));   // sorted, no repeats
  }
});

test('the reverb fades smoothly from full to -60 dB over its tail', () => {
  assert.ok(close(S.reverbEnvelope(0, 6), 1));
  assert.ok(close(S.reverbEnvelope(6, 6), 0.001));         // -60 dB
  assert.ok(close(S.reverbEnvelope(3, 6), Math.sqrt(0.001)));
  let prev = 2;
  for (let t = 0; t <= 6; t += 0.25) { const v = S.reverbEnvelope(t, 6); assert.ok(v < prev); prev = v; }
});

test('thunder: close strikes arrive fast, distant ones later, never instantly', () => {
  const zero = () => 0;
  assert.ok(close(S.thunderDelay(1, zero), 0.06));
  assert.ok(close(S.thunderDelay(0, zero), 0.56));
  assert.ok(S.thunderDelay(0.5, () => 0.99) < 0.6);
  assert.ok(close(S.thunderDelay(7, zero), 0.06));        // clamped
});
