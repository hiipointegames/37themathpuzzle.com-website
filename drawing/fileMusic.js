// The live draw's music from audio files made in FL Studio (David, 2026-10-18):
// a full-groove loop and a stripped-back "tension" loop (drums + bass) for
// under the spin. Both loops are the same length and cut on whole bars, so
// they play side by side and the mode just crossfades between them.
//
// Same API as drawing/showMusic.js (start / setIntensity / setMode / setLevel
// / stop / playing), so live.html can use either one. If the files have not
// loaded by the time the music starts (slow network, a 404, a browser that
// cannot decode them), it hands over to the code-written ShowMusic instead:
// the show is never silent because a file is missing.
//
// The pure parts are tested:  node --test drawing/fileMusic.test.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FileMusic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var URLS = { full: '/drawing/music/groove.wav', tension: '/drawing/music/tension.wav' };

  /** How loud each loop sits in a mode: { full, tension } gains 0..1. */
  function modeGains(mode, hasTension) {
    if (mode === 'tension') return hasTension ? { full: 0, tension: 1 } : { full: 0.6, tension: 0 };
    return { full: 1, tension: 0 };
  }

  /** Which player to use: the files once the groove has decoded, else the code-written music. */
  function pickPlayer(buffers, fallback) {
    if (buffers && buffers.full) return 'file';
    return fallback ? 'synth' : 'none';
  }

  var buffers = null, loading = null;

  /** Fetch and decode both loops. Call early (page load) so they are ready by the first tap. */
  function preload(ctx) {
    if (loading) return loading;
    function get(url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error(url + ' ' + r.status);
        return r.arrayBuffer();
      }).then(function (ab) {
        return new Promise(function (ok, bad) { ctx.decodeAudioData(ab, ok, bad); });
      });
    }
    loading = get(URLS.full).then(function (full) {
      return get(URLS.tension).then(function (t) { return t; }, function () { return null; })
        .then(function (tension) { buffers = { full: full, tension: tension }; return buffers; });
    }).catch(function () { buffers = null; return null; });
    return loading;
  }

  function createFilePlayer(ctx, dest, bufs) {
    var master = null, gains = null, sources = [], mode = 'full', level = 0.5, playing = false;

    function ramp(param, to, sec) {
      try {
        param.cancelScheduledValues(ctx.currentTime);
        param.setValueAtTime(Math.max(0.0001, param.value), ctx.currentTime);
        param.exponentialRampToValueAtTime(Math.max(0.0001, to), ctx.currentTime + (sec || 0.4));
      } catch (_) {}
    }

    return {
      get playing() { return playing; },
      get mode() { return mode; },
      start: function (k, lvl) {
        if (playing) return;
        playing = true; level = lvl || 0.5;
        master = ctx.createGain(); master.gain.value = 0.0001; master.connect(dest);
        ramp(master.gain, level, 0.5);
        var g = modeGains(mode, Boolean(bufs.tension)), at = ctx.currentTime + 0.06;
        gains = {};
        ['full', 'tension'].forEach(function (name) {
          if (!bufs[name]) return;
          var src = ctx.createBufferSource(), gn = ctx.createGain();
          src.buffer = bufs[name]; src.loop = true;
          gn.gain.value = Math.max(0.0001, g[name]);
          src.connect(gn); gn.connect(master); src.start(at);
          sources.push(src); gains[name] = gn;
        });
      },
      // The files are mixed already; intensity only shapes the code-written music.
      setIntensity: function () {},
      setMode: function (m) {
        var next = m === 'tension' ? 'tension' : 'full';
        if (next === mode) return;
        mode = next;
        if (!playing) return;
        var g = modeGains(mode, Boolean(bufs.tension));
        Object.keys(gains).forEach(function (name) { ramp(gains[name].gain, g[name], 0.6); });
      },
      setLevel: function (lvl, sec) {
        if (!playing || Math.abs(lvl - level) < 0.005) return;
        level = lvl; ramp(master.gain, lvl, sec);
      },
      stop: function (fadeSec) {
        if (!playing) return;
        playing = false;
        var m = master, srcs = sources, f = Math.max(0.05, fadeSec || 0.25);
        sources = []; gains = null;
        ramp(m.gain, 0.0001, f);
        setTimeout(function () {
          srcs.forEach(function (s) { try { s.stop(); } catch (_) {} });
          try { m.disconnect(); } catch (_) {}
        }, f * 1000 + 200);
      },
    };
  }

  /** A music player for live.html: the FL files if they loaded, else ShowMusic. */
  function create(ctx, dest) {
    var fallback = typeof self !== 'undefined' ? self.ShowMusic : null;
    var which = pickPlayer(buffers, fallback);
    if (which === 'file') return createFilePlayer(ctx, dest, buffers);
    if (which === 'synth') return fallback.create(ctx, dest);
    return null;
  }

  return { URLS: URLS, modeGains: modeGains, pickPlayer: pickPlayer, preload: preload, create: create };
});
