// The live draw's music, composed in code (Web Audio): no audio files to
// load, nothing to license. An ORIGINAL 70s-style funk/soul groove (David
// asked for that feel, 2026-10-18): 108 BPM with swung 16ths, a two-chord
// Dorian vamp (Em7 → A9), a syncopated octave-popping bass, clav chops on
// the off-beats, ghost-note drums and brassy horn stabs. It builds as
// `intensity` rises (ghost notes, tambourine, more horns, a brighter filter).
//
// The pattern itself (what plays on each 16th step) is pure and tested:
//   node --test drawing/showMusic.test.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShowMusic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BPM = 108;
  var STEP = 60 / BPM / 4;                 // seconds per 16th note (straight)
  var SWING = 0.16;                        // off-16ths land this fraction of a step late
  // A four-bar loop: Em7 | Em7 | A9 | A9 — the Dorian i–IV vamp of a lot of funk.
  var BARS = [
    { root: 40, chord: [62, 64, 67, 71] }, // Em7 (D E G B)
    { root: 40, chord: [62, 64, 67, 71] },
    { root: 45, chord: [61, 64, 67, 71] }, // A9  (C# E G B)
    { root: 45, chord: [61, 64, 67, 71] },
  ];
  // The bass line, one bar: [step, semitones above the root]. Root, octave pops, b7.
  var BASS = [[0, 0], [3, 12], [6, 10], [7, 12], [10, 0], [11, 7], [13, 10], [14, 12]];

  // ── The lead guitar: an 8-bar solo that cycles over the vamp ──
  // Original phrases in E minor pentatonic (E G A B D), call and response
  // with room to breathe. Each note: [step within the 8 bars, midi, length in
  // 16ths, bend in semitones (0 = none), vibrato]. A bend starts on the note
  // and pushes up to the target, the way a player bends a string.
  var SOLO = [
    // bar 1: the call, a bend from D up to E, falling back down
    [0, 74, 4, 2, 0], [6, 71, 2, 0, 0], [8, 69, 2, 0, 0], [10, 67, 2, 0, 0], [12, 64, 4, 0, 1],
    // bar 2: rest
    // bar 3: the answer, climbing
    [32, 76, 2, 0, 0], [34, 79, 2, 0, 0], [36, 81, 3, 2, 0], [40, 79, 1, 0, 0], [41, 76, 1, 0, 0], [42, 74, 2, 0, 0], [44, 76, 4, 0, 1],
    // bar 4: a quick run up to a held, bent high note
    [48, 71, 1, 0, 0], [49, 74, 1, 0, 0], [50, 76, 1, 0, 0], [51, 79, 1, 0, 0], [52, 81, 6, 2, 1],
    // bar 5: low and bluesy, after a breath
    [72, 67, 2, 0, 0], [74, 69, 2, 0, 0], [76, 71, 1, 0, 0], [77, 69, 1, 0, 0], [78, 67, 2, 0, 0],
    // bar 6: settle on the root, then a pickup
    [80, 64, 6, 0, 1], [88, 62, 2, 0, 0], [90, 64, 2, 0, 0], [92, 67, 4, 0, 0],
    // bar 7: a fast descending flurry into a bend
    [96, 79, 1, 0, 0], [97, 76, 1, 0, 0], [98, 74, 1, 0, 0], [99, 76, 1, 0, 0], [100, 79, 1, 0, 0], [101, 76, 1, 0, 0],
    [102, 74, 1, 0, 0], [103, 71, 1, 0, 0], [104, 74, 4, 2, 0], [110, 76, 2, 0, 0],
    // bar 8: the long resolving note
    [112, 76, 8, 0, 1],
  ];
  var SOLO_LEN = 128;                       // 8 bars of 16ths

  /** The solo notes that start on 16th step `step`: [{ midi, len, bend, vib }]. */
  function soloAt(step) {
    var s = ((step % SOLO_LEN) + SOLO_LEN) % SOLO_LEN, out = [];
    for (var i = 0; i < SOLO.length; i++) {
      if (SOLO[i][0] === s) out.push({ midi: SOLO[i][1], len: SOLO[i][2], bend: SOLO[i][3], vib: SOLO[i][4] === 1 });
    }
    return out;
  }

  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  /** When 16th step `step` sounds, in seconds from step 0 (swung). */
  function stepTime(step) { return step * STEP + (step % 2 === 1 ? SWING * STEP : 0); }

  /**
   * What plays on 16th step `step` (counting from 0) at `intensity` 0..1.
   * Returns { kick, snare: 0|1|2 (none/ghost/full), hat: 0|1|2 (none/closed/open),
   *           tamb, bass: midi|null, clav: [midi]|null, horn: [midi]|null }.
   */
  function stepNotes(step, intensity) {
    var k = Math.max(0, Math.min(1, intensity || 0));
    var s = ((step % 16) + 16) % 16;
    var barNo = Math.floor(step / 16);
    var bar = BARS[((barNo % BARS.length) + BARS.length) % BARS.length];
    var b = null;
    for (var i = 0; i < BASS.length; i++) if (BASS[i][0] === s) b = bar.root + BASS[i][1];
    var ghost = k >= 0.4 && (s === 7 || s === 9 || s === 15);
    // Horns: a stab on the "and" of 2 every other bar; at full tilt, a two-hit
    // figure every bar.
    var horn = (s === 6 && barNo % 2 === 1) || (k >= 0.6 && (s === 10 || s === 14)) ? bar.chord : null;
    return {
      kick: s === 0 || s === 3 || s === 8 || s === 10,
      snare: s === 4 || s === 12 ? 2 : ghost ? 1 : 0,
      hat: s === 14 ? 2 : s % 2 === 0 ? 1 : 0,
      tamb: k >= 0.5 && s % 2 === 1,
      bass: b,
      clav: s === 2 || s === 5 || s === 9 || s === 13 ? bar.chord : null,
      horn: horn,
    };
  }

  /**
   * A player bound to an AudioContext and an output node.
   * start(intensity, level) begins on the next bar line; setIntensity(k) any
   * time; stop(fadeSec) fades out and stops scheduling. `level` is the
   * player's volume (0.5 under the show, lower under the winner card).
   */
  function create(ctx, dest) {
    var master = null, timer = 0, barAt = 0, step = 0, intensity = 0, noise = null, mode = 'full', level = 0.5;

    function noiseBuf() {
      if (noise && noise.sampleRate === ctx.sampleRate) return noise;
      var len = Math.floor(ctx.sampleRate * 1);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return noise;
    }
    function env(g, t, peak, dur, attack) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    function kick(t) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
      env(g, t, 0.8, 0.26); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.28);
    }
    function noiseHit(t, type, freq, q, peak, dur) {
      var n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      n.buffer = noiseBuf(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      env(g, t, peak, dur); n.connect(f); f.connect(g); g.connect(master);
      n.start(t, Math.random() * 0.8); n.stop(t + dur + 0.02);
    }
    function snare(t, full) {
      noiseHit(t, 'bandpass', 1900, 0.8, full ? 0.34 : 0.07, full ? 0.16 : 0.05);
      if (full) {   // a little body under the crack, and a clap on top
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.05);
        env(g, t, 0.12, 0.08); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.1);
        noiseHit(t + 0.012, 'bandpass', 1200, 1.2, 0.16, 0.12);
      }
    }
    function tone(t, type, midi, peak, dur, cutoff, attack, q) {
      var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = type; o.frequency.value = hz(midi);
      f.type = 'lowpass'; f.frequency.value = cutoff; if (q) f.Q.value = q;
      env(g, t, peak, dur, attack); o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
      return f;
    }
    function bass(t, midi) {
      // A round, plucky bass: the filter snaps open then closes, like a thumb pop.
      var f = tone(t, 'sawtooth', midi, 0.26, STEP * 1.5, 1600, 0.004, 3);
      f.frequency.setValueAtTime(300 + 1500 * (0.6 + 0.4 * intensity), t);
      f.frequency.exponentialRampToValueAtTime(260, t + 0.12);
    }
    function clav(t, chord) {
      // A choppy clavinet-ish chord: bright, very short, a touch of wah.
      chord.forEach(function (m) {
        var f = tone(t, 'square', m, 0.028, 0.075, 2600, 0.003, 4);
        f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(2800, t + 0.05);
      });
    }
    function horn(t, chord) {
      // Brass: stacked saws, a quick swell, the filter opening as it blows.
      chord.forEach(function (m) {
        var f = tone(t, 'sawtooth', m, 0.05, 0.22, 900, 0.02, 1);
        f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(3200 + 1500 * intensity, t + 0.06);
      });
    }
    // ── The lead guitar: a plucked-string model, not an oscillator ──
    // Each note is a Karplus-Strong pluck: a short burst of noise fed round a
    // delay line the length of one string vibration, softened a little on
    // every pass — which is how a real string loses its bright attack. The
    // plucks are computed once per pitch (a few ms each) and replayed; bends
    // and vibrato move the replay's pitch, as a finger on the string would.
    // Then mild overdrive and a guitar-speaker filter (no fizz above ~4.5 kHz).
    var drive = null, plucks = {};
    function driveCurve() {
      if (drive) return drive;
      var n = 1024; drive = new Float32Array(n);
      for (var i = 0; i < n; i++) { var x = (i / (n - 1)) * 2 - 1; drive[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
      return drive;
    }
    function pluck(midi) {
      if (plucks[midi]) return plucks[midi];
      var sr = ctx.sampleRate, f = hz(midi), N = Math.max(2, Math.round(sr / f));
      var len = Math.floor(sr * 2.2), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      // The pick: noise, smoothed so it is a pick and not a hiss.
      var prev = 0;
      for (var i = 0; i < N; i++) { prev = 0.55 * prev + 0.45 * (Math.random() * 2 - 1); d[i] = prev; }
      // The string: each sample is the average of the two a period earlier,
      // a hair under 1 so it rings and fades. Higher notes fade a bit faster.
      var keep = 0.9985 - (midi - 60) * 0.00004;
      for (var j = N; j < len; j++) d[j] = keep * 0.5 * (d[j - N] + d[j - N + 1]);
      var peak = 0;
      for (var k = 0; k < len; k++) peak = Math.max(peak, Math.abs(d[k]));
      if (peak > 0) for (var m = 0; m < len; m++) d[m] /= peak;
      // The period was rounded to whole samples; replay slightly faster or
      // slower so the note is in tune.
      plucks[midi] = { buf: buf, tune: (f * N) / sr };
      return plucks[midi];
    }
    function guitar(t, note) {
      var dur = note.len * STEP, p = pluck(note.midi);
      var src = ctx.createBufferSource(), pre = ctx.createGain(), ws = ctx.createWaveShaper();
      var hp = ctx.createBiquadFilter(), body = ctx.createBiquadFilter(), cab = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = p.buf;
      src.playbackRate.setValueAtTime(p.tune, t);
      if (note.bend) {
        // push the string up to the target over ~0.15 s, a moment after the pick
        src.playbackRate.setValueAtTime(p.tune, t + 0.05);
        src.playbackRate.linearRampToValueAtTime(p.tune * Math.pow(2, note.bend / 12), t + 0.05 + Math.min(0.15, dur * 0.5));
      }
      if (note.vib && dur > 0.3) {
        var lfo = ctx.createOscillator(), depth = ctx.createGain();
        lfo.frequency.value = 5.4; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(18, t + Math.min(0.4, dur * 0.6));
        lfo.connect(depth); depth.connect(src.detune); lfo.start(t); lfo.stop(t + dur + 0.15);
      }
      pre.gain.value = 2.2;                                     // into the overdrive, gently
      ws.curve = driveCurve(); ws.oversample = '2x';
      hp.type = 'highpass'; hp.frequency.value = 110;
      body.type = 'peaking'; body.frequency.value = 1300; body.gain.value = 3; body.Q.value = 0.9;
      cab.type = 'lowpass'; cab.frequency.value = 4300; cab.Q.value = 0.7;
      // Let it ring for the note, then damp it like a lifted finger.
      g.gain.setValueAtTime(0.045, t);
      g.gain.setValueAtTime(0.045, t + Math.max(0.03, dur - 0.04));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
      src.connect(pre); pre.connect(ws); ws.connect(hp); hp.connect(body); body.connect(cab); cab.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.15);
    }
    // Build the plucks ahead of time, one pitch per idle moment, so the first
    // solo note never costs a frame.
    (function warm() {
      var pitches = [];
      SOLO.forEach(function (n) { if (pitches.indexOf(n[1]) < 0) pitches.push(n[1]); });
      var i = 0;
      (function next() { if (i < pitches.length) { pluck(pitches[i++]); setTimeout(next, 30); } })();
    })();
    function play(n, t, soloNotes) {
      var tense = mode === 'tension';
      // Under the spin the groove strips back to kick, hats and bass, so the
      // drumroll and the wheel's clicks carry the suspense.
      if (n.kick || (tense && step % 4 === 0)) kick(t);
      if (n.snare && !tense) snare(t, n.snare === 2);
      if (n.hat) noiseHit(t, 'highpass', 7600, 0.7, n.hat === 2 && !tense ? 0.1 : 0.05, n.hat === 2 && !tense ? 0.12 : 0.03);
      if (n.tamb && !tense) noiseHit(t, 'bandpass', 9500, 2.5, 0.05, 0.05);
      if (n.bass != null) bass(t, n.bass);
      if (tense) return;
      if (n.clav) clav(t, n.clav);
      if (n.horn) horn(t, n.horn);
      soloNotes.forEach(function (note) { guitar(t, note); });
    }
    function tick() {
      // Schedule a little ahead of the audio clock; the timer only tops it up.
      while (barAt + stepTime(step) < ctx.currentTime + 0.12) {
        play(stepNotes(step, intensity), barAt + stepTime(step), soloAt(step));
        step++;
      }
    }

    return {
      get playing() { return Boolean(timer); },
      start: function (k, lvl) {
        if (timer) return;
        intensity = k || 0; level = lvl || 0.5;
        master = ctx.createGain(); master.gain.value = 0.0001;
        master.gain.exponentialRampToValueAtTime(level, ctx.currentTime + 0.5);
        master.connect(dest);
        step = 0; barAt = ctx.currentTime + 0.06;
        tick(); timer = setInterval(tick, 25);
      },
      setIntensity: function (k) { intensity = Math.max(0, Math.min(1, k)); },
      /** 'full' or 'tension' (stripped back under the spin). */
      setMode: function (m) { mode = m === 'tension' ? 'tension' : 'full'; },
      get mode() { return mode; },
      /** Glide the volume to `lvl` over `sec` seconds. */
      setLevel: function (lvl, sec) {
        if (!timer || Math.abs(lvl - level) < 0.005) return;
        level = lvl;
        try {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
          master.gain.exponentialRampToValueAtTime(Math.max(0.0001, lvl), ctx.currentTime + (sec || 0.4));
        } catch (_) {}
      },
      stop: function (fadeSec) {
        if (!timer) return;
        clearInterval(timer); timer = 0;
        var m = master, f = Math.max(0.05, fadeSec || 0.25);
        try {
          m.gain.cancelScheduledValues(ctx.currentTime);
          m.gain.setValueAtTime(Math.max(0.0001, m.gain.value), ctx.currentTime);
          m.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + f);
          setTimeout(function () { try { m.disconnect(); } catch (_) {} }, f * 1000 + 200);
        } catch (_) {}
      },
    };
  }

  return { BPM: BPM, STEP: STEP, SWING: SWING, BARS: BARS, SOLO_LEN: SOLO_LEN, hz: hz, stepTime: stepTime,
    stepNotes: stepNotes, soloAt: soloAt, create: create };
});
