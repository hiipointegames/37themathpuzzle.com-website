// Run: node --test drawing/drawPool.test.js
// Tests for the /drawing page's logic (drawing/drawPool.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const P = require('./drawPool');

const WEEK3 = {
  drawing: '2026-10-11', from: '2026-10-04', to: '2026-10-10',
  through: '2026-10-06', updatedAt: '2026-10-07T05:10:00Z', daysRecorded: 3,
  totalEntries: 13,
  players: [
    { name: 'libb', entries: 3 },
    { name: 'stutz', entries: 6 },
    { name: 'alliecat128', entries: 3 },
    { name: 'megdob', entries: 1 },
  ],
  winner: null, firstDrawing: '2026-10-11', lastDrawing: '2027-02-28',
};

test('drawing numbers count from 27 Sep 2026, and 28 Feb 2027 is the 23rd', () => {
  assert.strictEqual(P.drawingNumber('2026-09-27'), 1);
  assert.strictEqual(P.drawingNumber('2026-10-11'), 3);
  assert.strictEqual(P.drawingNumber('2027-02-28'), 23);
});

test('Eastern offset follows daylight saving (ends 1 Nov 2026)', () => {
  assert.strictEqual(P.etOffsetMinutes(new Date('2026-10-11T12:00:00Z')), 240);
  assert.strictEqual(P.etOffsetMinutes(new Date('2026-11-08T12:00:00Z')), 300);
});

test('the deadline is 9:00pm Eastern on the drawing Sunday, in EDT and EST', () => {
  assert.strictEqual(P.drawDeadline('2026-10-11').toISOString(), '2026-10-12T01:00:00.000Z');
  assert.strictEqual(P.drawDeadline('2026-11-08').toISOString(), '2026-11-09T02:00:00.000Z');
});

test('countdown text reads days, hours, minutes, then "any minute"', () => {
  assert.strictEqual(P.countdownText(3 * 86400000 + 4 * 3600000 + 5 * 60000), '3d 4h');
  assert.strictEqual(P.countdownText(2 * 3600000 + 7 * 60000), '2h 7m');
  assert.strictEqual(P.countdownText(30 * 1000), '1m');
  assert.strictEqual(P.countdownText(0), 'any minute');
  assert.strictEqual(P.countdownText(-5000), 'any minute');
});

test('odds are one decimal place, never a misleading 0.0%', () => {
  assert.strictEqual(P.oddsText(6, 13), '46.2%');
  assert.strictEqual(P.oddsText(1, 4), '25.0%');
  assert.strictEqual(P.oddsText(1, 2000), '<0.1%');
  assert.strictEqual(P.oddsText(0, 10), '0%');
  assert.strictEqual(P.oddsText(3, 0), '0%');
});

test('updated time is shown in Eastern Time', () => {
  assert.strictEqual(P.updatedText('2026-10-07T05:10:00Z'), 'Wed 7 Oct, 1:10 AM ET');
  assert.strictEqual(P.updatedText('2026-11-09T05:10:00Z'), 'Mon 9 Nov, 12:10 AM ET');
  assert.strictEqual(P.updatedText('not a date'), '');
});

test('equal entries share a rank, and bars scale to the leader', () => {
  const rows = P.rankRows([
    { name: 'a', entries: 6 }, { name: 'b', entries: 3 }, { name: 'c', entries: 3 }, { name: 'd', entries: 1 },
  ], 13);
  assert.deepStrictEqual(rows.map((r) => r.rank), [1, 2, 2, 4]);
  assert.deepStrictEqual(rows.map((r) => r.bar), [100, 50, 50, 17]);
});

test('view model: a live week sorts by entries then name, and totals add up', () => {
  const vm = P.viewModel(WEEK3, Date.parse('2026-10-07T16:00:00Z'));
  assert.strictEqual(vm.state, 'live');
  assert.strictEqual(vm.drawingIso, '2026-10-11');   // the page's countdown timer re-reads this
  assert.strictEqual(vm.number, 3);
  assert.strictEqual(vm.totalDrawings, 23);
  assert.deepStrictEqual(vm.rows.map((r) => r.name), ['stutz', 'alliecat128', 'libb', 'megdob']);
  assert.strictEqual(vm.totalEntries, 13);
  assert.strictEqual(vm.playerCount, 4);
  assert.strictEqual(vm.rangeText, 'Sun 4 Oct – Sat 10 Oct');
  assert.strictEqual(vm.throughText, 'Tue 6 Oct');
  assert.strictEqual(vm.updatedText, 'Wed 7 Oct, 1:10 AM ET');
  assert.strictEqual(vm.daysLeft, 4);                 // Wed, Thu, Fri, Sat
  assert.strictEqual(vm.countdown, '4d 9h');          // to Sun 11 Oct 9pm EDT
  assert.strictEqual(vm.winner, null);
});

test('view model: before the first night is saved, the week is waiting', () => {
  const vm = P.viewModel({ ...WEEK3, players: [], daysRecorded: 0, through: null, updatedAt: null, totalEntries: 0 },
    Date.parse('2026-10-05T01:00:00Z'));
  assert.strictEqual(vm.state, 'waiting');
  assert.strictEqual(vm.rows.length, 0);
  assert.strictEqual(vm.updatedText, '');
  assert.strictEqual(vm.daysLeft, 7);                 // Sunday evening ET: the whole week is open
});

test('view model: a recorded winner wins over everything else', () => {
  const vm = P.viewModel({ ...WEEK3, winner: { name: 'stutz', ticket: 4, totalEntries: 13, drawnAt: '2026-10-12T00:30:00Z' } });
  assert.strictEqual(vm.state, 'drawn');
  assert.deepStrictEqual(vm.winner, { name: 'stutz', ticketText: 'ticket 4 of 13' });
  const noTicket = P.viewModel({ ...WEEK3, winner: { name: 'stutz', ticket: null, totalEntries: 13 } });
  assert.strictEqual(noTicket.winner.ticketText, '13 entries in the hat');
});

test('view model: after the last drawing the promotion reads as ended', () => {
  const vm = P.viewModel({ ...WEEK3, drawing: '2027-03-07', from: '2027-02-28', to: '2027-03-06', players: [], daysRecorded: 0 });
  assert.strictEqual(vm.state, 'ended');
});

test('names are kept as plain strings (the page renders them with textContent)', () => {
  const vm = P.viewModel({ ...WEEK3, players: [{ name: '<img src=x onerror=alert(1)>', entries: 2 }] });
  assert.strictEqual(vm.rows[0].name, '<img src=x onerror=alert(1)>');
});

test('wheel slices are contiguous, sized by entries, and close the circle', () => {
  const s = P.wheelSlices([{ name: 'a', entries: 3 }, { name: 'b', entries: 1 }]);
  const TAU = Math.PI * 2;
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].start, 0);
  assert.ok(Math.abs(s[0].end - TAU * 0.75) < 1e-9);
  assert.strictEqual(s[1].start, s[0].end);
  assert.ok(Math.abs(s[1].end - TAU) < 1e-9);
  assert.deepStrictEqual(P.wheelSlices([]), []);
  assert.strictEqual(s[0].hue, P.hueOf(0));
});

test('at rest, the winner sits under the pointer; with no winner the wheel is untouched', () => {
  const s = P.wheelSlices([{ name: 'a', entries: 2 }, { name: 'b', entries: 2 }]);
  // b spans 180°–360°, so its middle (270°) must turn back to 12 o'clock.
  assert.ok(Math.abs(P.restRotation(s, 'b') + Math.PI * 1.5) < 1e-9);
  assert.strictEqual(P.restRotation(s, null), 0);
  assert.strictEqual(P.restRotation(s, 'not-in-the-list'), 0);
});

test('videos: this drawing, else the latest earlier one; https links only', () => {
  const videos = {
    '2026-10-04': 'https://youtube.com/shorts/week2',
    '2026-10-11': 'https://youtube.com/shorts/week3',
    '2026-10-18': 'javascript:alert(1)',
    'not-a-date': 'https://example.com',
  };
  assert.strictEqual(P.videoFor(videos, '2026-10-11'), 'https://youtube.com/shorts/week3');
  assert.strictEqual(P.videoFor(videos, '2026-10-18'), null);
  assert.strictEqual(P.videoFor(null, '2026-10-11'), null);
  assert.deepStrictEqual(P.lastVideo(videos, '2026-10-18'),
    { drawing: '2026-10-11', dateText: 'Sun 11 Oct', url: 'https://youtube.com/shorts/week3' });
  assert.strictEqual(P.lastVideo(videos, '2026-10-04'), null);
  assert.strictEqual(P.lastVideo({}, '2026-10-11'), null);
});

test('search finds a username anywhere in it, ignoring case', () => {
  const rows = P.viewModel(WEEK3).rows;
  assert.deepStrictEqual(P.filterRows(rows, 'LIB').map((r) => r.name), ['libb']);
  assert.deepStrictEqual(P.filterRows(rows, '  ').length, 4);
  assert.deepStrictEqual(P.filterRows(rows, 'zzz'), []);
});
