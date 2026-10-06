// The /drawing page's soundtrack, composed in code with Web Audio: nothing to
// license, nothing to download. Off until someone taps "Sound" (browsers block
// audio before a tap anyway). Pure helpers are exported for tests:
//   node --test drawing/sound.test.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DrawSound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** MIDI note number to frequency in Hz (A4 = 69 = 440 Hz). */
  function noteFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  // The drone's progression: Am -> F -> C -> E (the E major lifts it back to Am).
  // Each chord: three notes around the low octave, as MIDI numbers.
  var PROGRESSION = [[45, 48, 52], [41, 45, 48], [48, 52, 55], [40, 44, 47]];
  /** The chord at bar `bar` (any integer, wraps). */
  function chordAt(bar) {
    var n = PROGRESSION.length;
    return PROGRESSION[((bar % n) + n) % n].slice();
  }

  /**
   * Beat times (seconds) of a lub-dub heartbeat at `bpm` that fall in [t0, t1).
   * Starts one beat early so a "dub" whose "lub" fell in the previous window is
   * still booked — consecutive windows then cover every hit exactly once.
   */
  var DUB = 0.18;
  function heartbeatTimes(t0, t1, bpm, start) {
    var period = 60 / bpm, out = [];
    var first = Math.floor((t0 - DUB - start) / period);
    for (var k = Math.max(0, first); start + k * period < t1; k++) {
      var t = start + k * period;
      out.push({ t: t, accent: true }, { t: t + DUB, accent: false });
    }
    return out.filter(function (b) { return b.t >= t0 && b.t < t1; });
  }

  /** Thunder arrives after the flash: further strikes (lower intensity) arrive later. */
  function thunderDelay(intensity, rand) {
    var i = Math.max(0, Math.min(1, intensity));
    return 0.06 + (1 - i) * 0.5 + rand() * 0.15;
  }

  function create(AudioCtx) {
    var ctx = null, master = null, comp = null, droneVoices = [], droneFilter = null, lfo = null;
    var brown = null, white = null, timer = 0, bar = 0, beatStart = 0, scheduledUntil = 0, on = false;

    function noiseBuffer(kind) {
      var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
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

    function build() {
      ctx = new AudioCtx();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
      master = ctx.createGain(); master.gain.value = 0.0001;
      master.connect(comp); comp.connect(ctx.destination);
      brown = noiseBuffer('brown'); white = noiseBuffer('white');

      // The drone: detuned saws through a slowly breathing low-pass, plus a sub.
      droneFilter = ctx.createBiquadFilter(); droneFilter.type = 'lowpass';
      droneFilter.frequency.value = 520; droneFilter.Q.value = 5;
      var droneGain = ctx.createGain(); droneGain.gain.value = 0.05;
      droneFilter.connect(droneGain); droneGain.connect(master);
      lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      var lfoDepth = ctx.createGain(); lfoDepth.gain.value = 320;
      lfo.connect(lfoDepth); lfoDepth.connect(droneFilter.frequency); lfo.start();
      chordAt(0).forEach(function (m) {
        [-7, 7].forEach(function (cents) {
          var o = ctx.createOscillator(); o.type = 'sawtooth';
          o.frequency.value = noteFreq(m); o.detune.value = cents;
          o.connect(droneFilter); o.start(); droneVoices.push(o);
        });
      });
      var sub = ctx.createOscillator(), subGain = ctx.createGain();
      sub.frequency.value = noteFreq(33); subGain.gain.value = 0.09;
      sub.connect(subGain); subGain.connect(master); sub.start(); droneVoices.push(sub);
      beatStart = ctx.currentTime + 0.3; scheduledUntil = beatStart;
    }

    function kick(when, accent) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(accent ? 72 : 60, when);
      o.frequency.exponentialRampToValueAtTime(38, when + 0.22);
      env(g, when, accent ? 0.3 : 0.18, 0.008, 0.3);
      o.connect(g); g.connect(master); o.start(when); o.stop(when + 0.4);
    }

    // Look ahead and book the heartbeat; every 8 beats the drone moves chord.
    function schedule() {
      if (!on) return;
      var now = ctx.currentTime, until = now + 0.6;
      heartbeatTimes(scheduledUntil, until, 72, beatStart).forEach(function (b) { kick(b.t, b.accent); });
      var period = 60 / 72, beatsSoFar = Math.floor((until - beatStart) / period);
      var targetBar = Math.floor(beatsSoFar / 8);
      if (targetBar !== bar) {
        bar = targetBar;
        var chord = chordAt(bar);
        droneVoices.slice(0, 6).forEach(function (o, i) {
          o.frequency.setTargetAtTime(noteFreq(chord[Math.floor(i / 2)]), now, 0.6);
        });
      }
      scheduledUntil = until;
    }

    var api = {
      get on() { return on; },
      start: function () {
        if (!ctx) build();
        if (ctx.state === 'suspended') ctx.resume();
        on = true;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.55, ctx.currentTime + 1.5);   // background, not foreground
        clearInterval(timer); timer = setInterval(schedule, 120); schedule();
      },
      stop: function () {
        if (!ctx) return;
        on = false; clearInterval(timer);
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
        setTimeout(function () { if (!on && ctx) ctx.suspend(); }, 500);
      },
      // A crack, then a long rumble — later and softer for distant strikes.
      thunder: function (intensity) {
        if (!on) return;
        var t = ctx.currentTime + thunderDelay(intensity, Math.random), i = Math.max(0.2, intensity);
        var crack = noise('white', t, 0.25), hp = ctx.createBiquadFilter(), cg = ctx.createGain();
        hp.type = 'highpass'; hp.frequency.value = 1400;
        env(cg, t, 0.32 * i, 0.004, 0.2); crack.connect(hp); hp.connect(cg); cg.connect(master);
        var rumble = noise('brown', t, 3.2), lp = ctx.createBiquadFilter(), rg = ctx.createGain();
        lp.type = 'lowpass'; lp.frequency.value = 170;
        env(rg, t + 0.03, 0.85 * i, 0.18, 2.8); rumble.connect(lp); lp.connect(rg); rg.connect(master);
      },
      // The swell under a spin: a filtered-noise sweep and a rising saw.
      riser: function (dur) {
        if (!on) return;
        var t = ctx.currentTime;
        var n = noise('white', t, dur), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
        bp.type = 'bandpass'; bp.Q.value = 3;
        bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3200, t + dur);
        ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.92);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
        n.connect(bp); bp.connect(ng); ng.connect(master);
        var o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(440, t + dur);
        og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.045, t + dur * 0.9);
        og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
        var of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 1800;
        o.connect(of); of.connect(og); og.connect(master); o.start(t); o.stop(t + dur + 0.1);
      },
      // The landing: a deep boom and a bright rising chime.
      reveal: function () {
        if (!on) return;
        var t = ctx.currentTime;
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.9);
        env(g, t, 0.7, 0.01, 1.1); o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.3);
        [81, 84, 88, 93].forEach(function (m, k) {      // A5 C6 E6 A6
          var c = ctx.createOscillator(), cg = ctx.createGain(); c.type = 'triangle';
          c.frequency.value = noteFreq(m);
          env(cg, t + 0.06 + k * 0.08, 0.14, 0.01, 1.4); c.connect(cg); cg.connect(master);
          c.start(t + 0.06 + k * 0.08); c.stop(t + 1.8 + k * 0.08);
        });
      },
      // Into the black hole: everything falls away, then the rebirth boom.
      hole: function (dur) {
        if (!on) return;
        var t = ctx.currentTime;
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(28, t + dur * 0.5);
        env(g, t, 0.3, 0.3, dur * 0.35); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur * 0.7);
        var n = noise('brown', t, dur * 0.6), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(60, t + dur * 0.5);
        env(ng, t, 0.5, dur * 0.25, dur * 0.3); n.connect(lp); lp.connect(ng); ng.connect(master);
        setTimeout(function () { api.reveal(); }, dur * 620);
      },
    };
    return api;
  }

  return { noteFreq: noteFreq, chordAt: chordAt, heartbeatTimes: heartbeatTimes, thunderDelay: thunderDelay, create: create };
});
