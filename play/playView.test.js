// Run: node --test play/playView.test.js
// Tests for what the /play page says for a share (mix D, David 2026-11-12).
// The rules live INLINE in play/index.html between the <playView> markers (a
// separate script under /play/ would be caught by the /play/:code rewrite), so
// this test cuts that block out of the shipped page and runs it.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const block = PAGE.slice(PAGE.indexOf('/* <playView>'), PAGE.indexOf('/* </playView>'));
// eslint-disable-next-line no-new-func
const { playView, PLAY_THEMES } = new Function(`${block}; return { playView, PLAY_THEMES };`)();

const text = (parts) => parts.map((p) => p[0]).join('');
const row = (over) => ({ mode: 'daily_expert', puzzle_number: 202, username: 'dicegoblin42', result: 'perfect', solve_seconds: 31, ...over });

test('the block was found and is DOM-free', () => {
  assert.ok(block.length > 500);
  assert.doesNotMatch(block, /document\.|window\.|innerHTML/);
});

test('tier colours match the share card: Easy green, Challenge cyan, Expert gold', () => {
  assert.strictEqual(PLAY_THEMES.daily_easy.accent, '#27ff9e');
  assert.strictEqual(PLAY_THEMES.daily.accent, '#1ff0ff');
  assert.strictEqual(PLAY_THEMES.daily_expert.accent, '#ffcf3a');
});

test('no share: the generic magenta page with tumbling dice', () => {
  for (const r of [null, undefined, {}, { mode: 'blitz' }]) {
    const v = playView(r);
    assert.strictEqual(v.theme, null);
    assert.strictEqual(v.chip, null);
    assert.strictEqual(v.vs, null);
    assert.strictEqual(v.button, null);
    assert.strictEqual(v.dice, true);
    assert.strictEqual(text(v.headline), "Today's 37 is waiting. Your turn?");
    assert.strictEqual(v.steps.length, 3);
  }
});

test('a solved share: challenged headline, VS with the time, "Beat 0:31"', () => {
  const v = playView(row());
  assert.strictEqual(v.theme, PLAY_THEMES.daily_expert);
  assert.strictEqual(v.chip, 'EXPERT DAILY #202');
  assert.strictEqual(text(v.headline), "You've been challenged by @dicegoblin42 ⚔️");
  assert.deepStrictEqual(v.headline[1], ['@dicegoblin42', 'who']);
  assert.deepStrictEqual(v.vs, { name: '@dicegoblin42', value: '0:31' });
  assert.strictEqual(v.button, 'Beat 0:31');
  assert.deepStrictEqual(v.steps.map((s) => s[1]), [
    'Use all 7 dice to make 37', "Beat @dicegoblin42's 0:31", "Add them as a friend and follow each other's times",
  ]);
  assert.strictEqual(v.dice, false);
});

test('times are m:ss and rounded', () => {
  assert.strictEqual(playView(row({ solve_seconds: 102.4 })).button, 'Beat 1:42');
  assert.strictEqual(playView(row({ solve_seconds: 9 })).vs.value, '0:09');
});

test('a solved share with no time: no VS strip, "Take the challenge"', () => {
  const v = playView(row({ result: 'solved', solve_seconds: null }));
  assert.strictEqual(v.vs, null);
  assert.strictEqual(v.button, 'Take the challenge');
  assert.strictEqual(v.steps[1][1], "Beat @dicegoblin42's time");
});

test('a forfeit: "37 beat @x", a skull for their side, no time to beat', () => {
  const v = playView(row({ mode: 'daily', result: 'forfeit', solve_seconds: null }));
  assert.strictEqual(v.theme, PLAY_THEMES.daily);
  assert.strictEqual(v.chip, 'CHALLENGE DAILY #202');
  assert.strictEqual(text(v.headline), '37 beat @dicegoblin42 today. Can you beat 37? 💀');
  assert.deepStrictEqual(v.vs, { name: '@dicegoblin42', value: '💀' });
  assert.strictEqual(v.button, "Take on today's 37");
  assert.strictEqual(v.steps[1][1], "Do what @dicegoblin42 couldn't");
});

test('a guest share (no name): the Daily, themed, no VS', () => {
  const v = playView(row({ mode: 'daily_easy', username: null, puzzle_number: null }));
  assert.strictEqual(v.theme, PLAY_THEMES.daily_easy);
  assert.strictEqual(v.chip, 'EASY DAILY');
  assert.strictEqual(text(v.headline), "Today's Easy Daily is waiting. Your turn?");
  assert.strictEqual(v.vs, null);
  assert.strictEqual(v.button, null);
  assert.strictEqual(v.dice, true);
});

test('a hostile username stays one text part (the page paints parts with textContent)', () => {
  const v = playView(row({ username: '<img src=x onerror=alert(1)>' }));
  assert.deepStrictEqual(v.headline[1], ['@<img src=x onerror=alert(1)>', 'who']);
  assert.ok(!PAGE.slice(PAGE.indexOf('function render(view)')).split('</script>')[0].includes('innerHTML'));
});
