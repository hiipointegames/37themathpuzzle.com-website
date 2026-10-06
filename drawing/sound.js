// The /drawing page's soundtrack, composed in code with Web Audio: nothing to
// license, nothing to download. Ethereal and cosmic (David, 2026-10-05): a soft
// glassy pad drifting through open chords, star-like twinkles echoing into a
// huge generated reverb, distant cosmic thunder, a shimmering rise under each
// spin and a bell chord on each landing. Off until someone taps "Sound"
// (browsers block audio before a tap anyway). Pure helpers are exported:
//   node --test drawing/sound.test.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DrawSound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** MIDI note number to frequency in Hz (A4 = 69 = 440 Hz). */
  function noteFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  // The pad drifts through open, unresolved chords: Dmaj9, Bm9, Gmaj7#11, A6/9.
  // Five voices each, as MIDI numbers, spread wide so they float.
  var PROGRESSION = [
    [50, 57, 61, 64, 66],   // D A C# E F#
    [47, 54, 57, 61, 62],   // B F# A C# D
    [43, 50, 54, 61, 66],   // G D F# C# F#  (the #11 is the C#)
    [45, 52, 54, 59, 61],   // A E F# B C#
  ];
  /** The chord at step `n` (any integer, wraps). A copy, never the table. */
  function chordAt(n) {
    var len = PROGRESSION.length;
    return PROGRESSION[((n % len) + len) % len].slice();
  }

  /**
   * Notes for the star twinkles over a chord: its pitch classes, lifted two and
   * three octaves into the sparkle range (MIDI 74..98), sorted, no repeats.
   */
  function twinklePool(chord) {
    var out = [];
    chord.forEach(function (m) {
      [24, 36].forEach(function (up) {
        var n = m + up;
        while (n > 98) n -= 12;
        while (n < 74) n += 12;
        if (out.indexOf(n) === -1) out.push(n);
      });
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /**
   * The reverb's impulse envelope at time t (s): a smooth exponential fade that
   * reaches -60 dB at `tail` seconds. (The impulse is this, times noise.)
   */
  function reverbEnvelope(t, tail) {
    return Math.pow(10, (-3 * t) / tail);
  }

  /** Thunder arrives after the flash: further strikes (lower intensity) arrive later. */
  function thunderDelay(intensity, rand) {
    var i = Math.max(0, Math.min(1, intensity));
    return 0.06 + (1 - i) * 0.5 + rand() * 0.15;
  }

  function create(AudioCtx) {
    var ctx = null, master = null, wet = null, dry = null, echo = null, padFilter = null, padVoices = [];
    var brown = null, white = null, timer = 0, step = 0, nextChordAt = 0, on = false;
    var TAIL = 6;

    function noiseBuffer(kind) {
      var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
      return buf;
    }
    // A long stereo impulse: two independent noise channels under the same fade.
    function impulse() {
      var len = Math.floor(ctx.sampleRate * TAIL), buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * reverbEnvelope(i / ctx.sampleRate, TAIL);
      }
      return buf;
    }
    function noise(kind, when, dur) {
      var src = ctx.createBufferSource();
      src.buffer = kind === 'brown' ? brown : white; src.loop = true;
      src.start(when); src.stop(when + dur + 0.05);
      return src;
    }
    function env(gainNode, when, peak, attack, decay) {
      var g = gainNode.gain;
      g.setValueAtTime(0.0001, when);
      g.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
      g.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    }
    // Send a source to the room: mostly reverb, some dry, some echo.
    function toSpace(node, dryAmt, wetAmt, echoAmt) {
      var d = ctx.createGain(), w = ctx.createGain(), e = ctx.createGain();
      d.gain.value = dryAmt; w.gain.value = wetAmt; e.gain.value = echoAmt || 0;
      node.connect(d); node.connect(w); node.connect(e);
      d.connect(dry); w.connect(wet); e.connect(echo);
    }

    function build() {
      ctx = new AudioCtx();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.4;
      master = ctx.createGain(); master.gain.value = 0.0001;
      master.connect(comp); comp.connect(ctx.destination);
      brown = noiseBuffer('brown'); white = noiseBuffer('white');

      // The room: dry bus, a huge reverb, and a stereo-ish echo that feeds the reverb.
      dry = ctx.createGain(); dry.gain.value = 1; dry.connect(master);
      var verb = ctx.createConvolver(); verb.buffer = impulse();
      wet = ctx.createGain(); wet.gain.value = 1; wet.connect(verb); verb.connect(master);
      echo = ctx.createDelay(2); echo.delayTime.value = 0.43;
      var fb = ctx.createGain(); fb.gain.value = 0.42;
      var echoTone = ctx.createBiquadFilter(); echoTone.type = 'lowpass'; echoTone.frequency.value = 3200;
      echo.connect(echoTone); echoTone.connect(fb); fb.connect(echo); echoTone.connect(wet);

      // The pad: two slightly detuned glassy voices per note, through a slowly
      // breathing low-pass, swelling in.
      padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass';
      padFilter.frequency.value = 1400; padFilter.Q.value = 0.7;
      var padGain = ctx.createGain(); padGain.gain.value = 0.0001;
      padGain.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 4);
      padFilter.connect(padGain); toSpace(padGain, 0.35, 0.9, 0.15);
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
      var lfoDepth = ctx.createGain(); lfoDepth.gain.value = 700;
      lfo.connect(lfoDepth); lfoDepth.connect(padFilter.frequency); lfo.start();
      chordAt(0).forEach(function (m) {
        [-6, 6].forEach(function (cents, k) {
          var o = ctx.createOscillator(); o.type = k ? 'triangle' : 'sine';
          o.frequency.value = noteFreq(m); o.detune.value = cents;
          var vib = ctx.createOscillator(), vd = ctx.createGain();    // a slow shimmer in pitch
          vib.frequency.value = 0.12 + Math.random() * 0.2; vd.gain.value = 4;
          vib.connect(vd); vd.connect(o.detune); vib.start();
          o.connect(padFilter); o.start(); padVoices.push(o);
        });
      });
      // A deep, quiet sub breathing underneath.
      var sub = ctx.createOscillator(), subGain = ctx.createGain(), subLfo = ctx.createOscillator(), subDepth = ctx.createGain();
      sub.frequency.value = noteFreq(38); subGain.gain.value = 0.05;
      subLfo.frequency.value = 0.08; subDepth.gain.value = 0.03;
      subLfo.connect(subDepth); subDepth.connect(subGain.gain); subLfo.start();
      sub.connect(subGain); subGain.connect(dry); sub.start(); padVoices.push(sub);
      nextChordAt = ctx.currentTime + 10;
    }

    // One star: a soft bell-like ping (sine + a faint octave), panned, echoing away.
    function twinkle(when, midi, level) {
      var f = noteFreq(midi), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2.01;
      var g2 = ctx.createGain(); g2.gain.value = 0.25;
      o2.connect(g2); g2.connect(g); o.connect(g);
      env(g, when, level, 0.01, 2.2);
      var out = g;
      if (ctx.createStereoPanner) { var p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8; g.connect(p); out = p; }
      toSpace(out, 0.25, 0.8, 0.55);
      o.start(when); o2.start(when); o.stop(when + 2.4); o2.stop(when + 2.4);
    }

    // Look ahead: scatter a few stars, and every ~10 s drift the pad to the next chord.
    function schedule() {
      if (!on) return;
      var now = ctx.currentTime;
      if (Math.random() < 0.38) {
        var pool = twinklePool(chordAt(step));
        twinkle(now + 0.05 + Math.random() * 0.1, pool[Math.floor(Math.random() * pool.length)], 0.05 + Math.random() * 0.05);
      }
      if (now >= nextChordAt) {
        step += 1;
        var chord = chordAt(step);
        padVoices.slice(0, 10).forEach(function (o, i) {
          o.frequency.setTargetAtTime(noteFreq(chord[Math.floor(i / 2)]), now, 1.8);  // a slow glide
        });
        nextChordAt = now + 9 + Math.random() * 3;
      }
    }

    var api = {
      get on() { return on; },
      start: function () {
        if (!ctx) build();
        if (ctx.state === 'suspended') ctx.resume();
        on = true;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.95, ctx.currentTime + 2.5);   // fade in, never jump
        clearInterval(timer); timer = setInterval(schedule, 250); schedule();
      },
      stop: function () {
        if (!ctx) return;
        on = false; clearInterval(timer);
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        setTimeout(function () { if (!on && ctx) ctx.suspend(); }, 700);
      },
      // Distant cosmic thunder: a soft crack, then a low rumble that blooms into the room.
      thunder: function (intensity) {
        if (!on) return;
        var t = ctx.currentTime + thunderDelay(intensity, Math.random), i = Math.max(0.2, intensity);
        var crack = noise('white', t, 0.3), bp = ctx.createBiquadFilter(), cg = ctx.createGain();
        bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
        env(cg, t, 0.09 * i, 0.006, 0.25); crack.connect(bp); bp.connect(cg); toSpace(cg, 0.4, 1, 0.3);
        var rumble = noise('brown', t, 4), lp = ctx.createBiquadFilter(), rg = ctx.createGain();
        lp.type = 'lowpass'; lp.frequency.value = 140;
        env(rg, t + 0.05, 0.55 * i, 0.4, 3.2); rumble.connect(lp); lp.connect(rg); toSpace(rg, 0.6, 0.7, 0);
      },
      // Under a spin: a shimmering upward glide of the chord's stars, and an airy wash.
      riser: function (dur) {
        if (!on) return;
        var t = ctx.currentTime, pool = twinklePool(chordAt(step));
        for (var k = 0; k < 9; k++) {
          twinkle(t + (k / 9) * dur * 0.95, pool[Math.min(pool.length - 1, k % pool.length)], 0.035 + 0.04 * (k / 9));
        }
        var n = noise('white', t, dur), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
        bp.type = 'bandpass'; bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(800, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
        ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.9);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
        n.connect(bp); bp.connect(ng); toSpace(ng, 0.3, 0.9, 0.2);
      },
      // The landing: a bell chord that blooms into the reverb, over a soft deep swell.
      reveal: function () {
        if (!on) return;
        var t = ctx.currentTime, chord = chordAt(step);
        chord.slice(1).forEach(function (m, k) {
          var f = noteFreq(m + 24), c = ctx.createOscillator(), mod = ctx.createOscillator(), md = ctx.createGain(), cg = ctx.createGain();
          c.type = 'sine'; c.frequency.value = f;
          mod.frequency.value = f * 3.5; md.gain.setValueAtTime(f * 1.2, t); md.gain.exponentialRampToValueAtTime(1, t + 1.5);
          mod.connect(md); md.connect(c.frequency);                    // a glassy FM bell
          env(cg, t + k * 0.06, 0.07, 0.005, 3.2); c.connect(cg); toSpace(cg, 0.35, 1, 0.4);
          c.start(t + k * 0.06); mod.start(t + k * 0.06); c.stop(t + 3.6 + k * 0.06); mod.stop(t + 3.6 + k * 0.06);
        });
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(noteFreq(chord[0] - 12), t);
        env(g, t, 0.22, 0.25, 2.2); o.connect(g); toSpace(g, 0.7, 0.5, 0);
        o.start(t); o.stop(t + 2.6);
      },
      // Into the black hole: a deep sweep falling away, then the bell chord on rebirth.
      hole: function (dur) {
        if (!on) return;
        var t = ctx.currentTime;
        var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle';
        o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(30, t + dur * 0.5);
        env(g, t, 0.16, 0.4, dur * 0.35); o.connect(g); toSpace(g, 0.4, 1, 0.3); o.start(t); o.stop(t + dur * 0.7);
        var n = noise('brown', t, dur * 0.6), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(1200, t); lp.frequency.exponentialRampToValueAtTime(50, t + dur * 0.5);
        env(ng, t, 0.35, dur * 0.25, dur * 0.3); n.connect(lp); lp.connect(ng); toSpace(ng, 0.5, 0.8, 0);
        setTimeout(function () { api.reveal(); }, dur * 620);
      },
    };
    return api;
  }

  return { noteFreq: noteFreq, chordAt: chordAt, twinklePool: twinklePool, reverbEnvelope: reverbEnvelope,
    thunderDelay: thunderDelay, create: create };
});
