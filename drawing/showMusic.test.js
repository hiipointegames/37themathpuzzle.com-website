// Run: node --test drawing/showMusic.test.js
// Tests for the live draw's music pattern (drawing/showMusic.js): an original
// 70s-style funk/soul groove.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const M = require('./showMusic');

const bar = (k, barNo = 0) => Array.from({ length: 16 }, (_, s) => M.stepNotes(barNo * 16 + s, k));
const stepsWhere = (notes, f) => notes.map((n, s) => (f(n) ? s : -1)).filter((s) => s >= 0);

test('108 BPM with swung 16ths: off-steps land late, on-steps on the grid', () => {
  assert.strictEqual(M.BPM, 108);
  assert.ok(Math.abs(M.STEP - 60 / 108 / 4) < 1e-12);
  assert.strictEqual(M.stepTime(2), 2 * M.STEP);
  assert.ok(M.stepTime(1) > M.STEP && M.stepTime(1) < 2 * M.STEP);
  for (let s = 0; s < 32; s++) assert.ok(M.stepTime(s + 1) > M.stepTime(s));   // never out of order
});

test('a funk beat: syncopated kick, backbeat snare on 2 and 4, open hat on the last "and"', () => {
  const n = bar(0);
  assert.deepStrictEqual(stepsWhere(n, (x) => x.kick), [0, 3, 8, 10]);
  assert.deepStrictEqual(stepsWhere(n, (x) => x.snare === 2), [4, 12]);
  assert.deepStrictEqual(stepsWhere(n, (x) => x.hat === 2), [14]);
});

test('it builds: ghost snares, tambourine and more horns only at higher intensity', () => {
  const calm = bar(0, 1), hot = bar(1, 1);
  assert.deepStrictEqual(stepsWhere(calm, (x) => x.snare === 1), []);
  assert.deepStrictEqual(stepsWhere(hot, (x) => x.snare === 1), [7, 9, 15]);
  assert.ok(calm.every((x) => !x.tamb));
  assert.strictEqual(hot.filter((x) => x.tamb).length, 8);
  assert.ok(stepsWhere(hot, (x) => x.horn).length > stepsWhere(calm, (x) => x.horn).length);
});

test('the vamp: Em7 for two bars, A9 for two, and the bass follows the root', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((b) => M.stepNotes(b * 16, 0).bass), [40, 40, 45, 45, 40]);
  assert.deepStrictEqual(M.stepNotes(2, 0).clav, [62, 64, 67, 71]);
  assert.deepStrictEqual(M.stepNotes(32 + 2, 0).clav, [61, 64, 67, 71]);
  assert.strictEqual(M.stepNotes(3, 0).bass, 52);   // an octave pop
  assert.strictEqual(M.stepNotes(1, 0).bass, null);
});

test('intensity is clamped and A4 is 440 Hz', () => {
  assert.deepStrictEqual(M.stepNotes(7, 5), M.stepNotes(7, 1));
  assert.deepStrictEqual(M.stepNotes(7, -1), M.stepNotes(7, 0));
  assert.strictEqual(M.hz(69), 440);
});

test('the guitar solo: E minor pentatonic, bends land on scale notes, room to breathe', () => {
  const PENT = new Set([4, 7, 9, 11, 2]);           // E G A B D
  const notes = [];
  for (let s = 0; s < M.SOLO_LEN; s++) M.soloAt(s).forEach((n) => notes.push({ s, ...n }));
  assert.ok(notes.length >= 30);
  for (const n of notes) {
    assert.ok(PENT.has(n.midi % 12), 'note ' + n.midi + ' at step ' + n.s);
    if (n.bend) assert.ok(PENT.has((n.midi + n.bend) % 12), 'bend target at step ' + n.s);
    assert.ok(n.midi >= 59 && n.midi <= 84);
  }
  // one note at a time: each ends before the next begins
  for (let i = 1; i < notes.length; i++) assert.ok(notes[i - 1].s + notes[i - 1].len <= notes[i].s, 'overlap at step ' + notes[i].s);
  // bar 2 is a rest (call, then space, then the answer)
  assert.ok(notes.every((n) => n.s < 16 || n.s >= 32));
  // it loops every 8 bars
  assert.deepStrictEqual(M.soloAt(M.SOLO_LEN), M.soloAt(0));
});
