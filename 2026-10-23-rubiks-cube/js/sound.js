// The page soundtrack: the video's theme (music.py: same chords, arpeggio and bell tune) rearranged as an upbeat
// 124 BPM groove and synthesized live with Web Audio. Built for phone speakers: the kick has a click transient and the
// bass is a filtered sawtooth, so both carry energy in the band a phone can play, and a compressor holds the level.
// The cube turns on this beat grid, and a low-pass filter muffles the mix while finished work is out of place.
// Nothing is downloaded and nothing plays until the reader taps.

export const BPM = 124, BEAT = 60 / BPM, BAR = 4 * BEAT, EIGHTH = BEAT / 2, SIXTEENTH = BEAT / 4;
const CHORDS = { C: [60, 64, 67], G: [59, 62, 67], Am: [57, 60, 64], F: [57, 60, 65] };
const ROOT = { C: 48, G: 43, Am: 45, F: 41 };
const PROG = ["C", "G", "Am", "F", "C", "G", "F", "G"];
const ARP = [0, 1, 2, 3, 2, 1, 0, 2];
const MELODY = [
  [[0, 76, .5], [.5, 79, .5], [1, 81, .5], [1.5, 79, .5], [2, 76, 1], [3, 74, 1]],
  [[0, 79, 1.5], [1.5, 76, .5], [2, 74, 2]],
  [[0, 72, .5], [.5, 74, .5], [1, 76, 1], [2, 81, 1], [3, 79, 1]],
  [[0, 77, 1], [1, 76, 1], [2, 72, 2]],
  [[0, 76, .5], [.5, 79, .5], [1, 81, .5], [1.5, 79, .5], [2, 76, 1], [3, 74, 1]],
  [[0, 79, 1], [1, 81, .5], [1.5, 79, .5], [2, 76, 2]],
  [[0, 77, 1], [1, 76, 1], [2, 74, 1], [3, 72, 1]],
  [[0, 74, 2], [2, 79, 2]],
];
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const OPEN = 18000, SHUT = 700;
// Output trim after the compressor, calibrated so the loop measures -16 LUFS (web music norm) with peaks below -1 dBFS.
export const LEVEL = 0.76;

// Where the next cube turn should start so that it lands on the beat grid (all times in seconds).
// Just past a grid point (within `late`): start now and finish on the next one. Otherwise wait for the next one.
export function gridSlot(now, t0, step, late = 0.06) {
  const phase = (((now - t0) % step) + step) % step;
  return phase <= late ? { wait: 0, dur: step - phase } : { wait: step - phase, dur: step };
}

// Tension 0 (all finished work intact) keeps the mix open; 1 (none intact) muffles it to 700 Hz.
export function tensionCutoff(x) {
  return OPEN * (SHUT / OPEN) ** Math.min(1, Math.max(0, x));
}

export class Sound {
  constructor(on = true) { this.on = on; this.ctx = null; this.playing = false; this.timer = null; this.section = "main"; this.offline = false; }

  // Builds the mix on a context. The page passes a live AudioContext; renders and tests pass an OfflineAudioContext.
  attach(ctx, offline = false) {
    this.ctx = ctx;
    this.offline = offline;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 2.5; comp.attack.value = 0.004; comp.release.value = 0.18;
    this.trim = ctx.createGain();
    this.trim.gain.value = LEVEL;
    comp.connect(this.trim); this.trim.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass"; this.lp.frequency.value = OPEN; this.lp.Q.value = 0.9;
    this.lp.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.lp);
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    return this;
  }

  // Audio starts only after a gesture: the page calls unlock(true) on the first tap or key press.
  // Before that, every sound is skipped silently (autoplay keeps moving without sound).
  // iPhone: Safari treats web audio as "ambient", so the ring/silent switch mutes it, and a tap anywhere keeps it
  // that way (nobody gets music in a meeting by tapping Pause). Turning sound on with the ♪ button passes
  // loud = true: "playback" makes it behave like a video (iOS 16.4 and later); elsewhere this is a no-op.
  unlock(fromGesture = false, loud = false) {
    if (!this.on || (!this.ctx && !fromGesture)) return false;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.attach(new AC());
      }
      if (loud && navigator.audioSession) navigator.audioSession.type = "playback";
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    } catch { return false; }
  }

  get live() { return !!this.ctx && this.on && (this.offline || this.ctx.state === "running"); }
  ready() { return this.offline || (this.unlock() && this.ctx.state === "running"); }
  now() { return this.ctx.currentTime; }

  setOn(on) {
    this.on = on;
    if (!on) {
      this.stopMusic(0.15);
      try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch { /* not supported */ }
    }
  }

  // ---- music loop ----------------------------------------------------------------------------
  startMusic(at) {
    if (!this.ready() || this.playing) return;
    const t = at ?? this.now() + 0.05;
    this.playing = true;
    this.t0 = t;
    this.bar = 0;
    this.nextBar = t;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1, t + 0.25);
    this.fill(t + 0.5);
    if (!this.offline) this.timer = setInterval(() => this.fill(this.now() + 0.5), 100);
  }

  fill(until) { while (this.playing && this.nextBar < until) { this.scheduleBar(this.bar++, this.nextBar); this.nextBar += BAR; } }

  stopMusic(fade = 1.2, at) {
    if (!this.ctx || !this.playing) return;
    const t = at ?? this.now(), g = this.musicBus.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
    clearInterval(this.timer);
    this.playing = false;
  }

  // The beat grid the cube turns on, or null when the music is not playing.
  grid() { return this.playing && this.live ? { now: this.now(), t0: this.t0 } : null; }
  // Seconds until the next downbeat that is at least one beat away (null without music).
  untilBar() {
    const g = this.grid();
    if (!g) return null;
    const w = BAR - (((g.now - g.t0) % BAR) + BAR) % BAR;
    return w < BEAT ? w + BAR : w;
  }

  setSection(name) { this.section = name; }
  setTension(x, at) {
    if (!this.ctx) return;
    this.lp.frequency.setTargetAtTime(tensionCutoff(x), at ?? this.now(), 0.12);
  }

  scheduleBar(b, t0) {
    const ch = PROG[b % PROG.length], notes = CHORDS[ch], bus = this.musicBus, S = SIXTEENTH;
    const main = this.section === "main", phrase = b % 16;
    if (b > 0 && b % 8 === 0 && main) this.crash(t0, 0.7, bus);
    this.pad(notes.map(hz), t0, BAR + 0.2, main, bus);
    ARP.forEach((idx, e) => this.pluck(hz((idx === 3 ? notes[0] + 12 : notes[idx]) + 12), t0 + e * EIGHTH, e % 2 ? 0.075 : 0.1, bus));
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * S;
      if (main && s % 4 === 0) this.kick(t, 1, bus);
      if (main && (s === 4 || s === 12)) this.clap(t, 1, bus);
      if (s % 4 === 2) {
        this.hat(t, true, main ? 1 : 0.6, bus);
        if (main) {
          this.bass(hz(ROOT[ch] + (s === 14 ? 12 : 0)), t, EIGHTH * 0.9, bus);
          this.stab(notes.map((m) => hz(m)), t, bus);
        }
      } else if (s % 2 === 1) this.hat(t, false, 0.7, bus);
    }
    if (main && b % 8 === 7) for (let s = 12; s < 16; s++) this.snare(t0 + s * S, 0.35 + 0.15 * (s - 12), bus);
    if (phrase >= 4 && phrase < 12 || !main) {
      for (const [bt, m, len] of MELODY[(b - 4 + 64) % 8]) this.bell(hz(m), t0 + bt * BEAT, Math.max(0.4, len * BEAT + 0.25), 0.3, 0.12, bus);
    }
  }

  // ---- effects (at = audio time; defaults to now) ------------------------------------------
  click(at) { if (this.ready()) { const t = at ?? this.now(); this.noiseHit(t, 2200, 7500, 0.006, 0.26); this.tone(420, t, 0.012, 0.1, "sine"); } }
  tick(at) { if (this.ready()) { const t = at ?? this.now(); this.noiseHit(t, 2500, 9000, 0.02, 0.2); this.tone(hz(91), t, 0.06, 0.07, "triangle"); } }
  chime(at) { if (this.ready()) { const t = at ?? this.now(); this.bell(hz(84), t, 1, 0.4, 0.18); this.bell(hz(91), t + 0.09, 1.2, 0.5, 0.18); this.crash(t, 0.5); } }
  retest(at) { if (this.ready()) { const t = at ?? this.now(); this.tone(hz(55), t, 0.18, 0.14, "triangle"); } }
  fanfare(at) { if (this.ready()) { const t = at ?? this.now(); [72, 76, 79, 84].forEach((m, i) => this.bell(hz(m + 12), t + 0.15 + i * EIGHTH / 2, 1.6, 0.6, 0.14)); this.crash(t, 1); } }

  // ---- instruments ---------------------------------------------------------------------------
  out(dest) { return dest || this.master; }
  env(g, t, a, peak, decay) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + a, decay); }
  tone(f, t, decay, vol, type = "sine", dest) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f; o.connect(g); g.connect(this.out(dest));
    this.env(g, t, 0.002, vol, decay); o.start(t); o.stop(t + decay * 8 + 0.05);
  }
  noiseHit(t, lo, hi, decay, vol, dest, type = "bandpass") {
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.value = type === "bandpass" ? Math.sqrt(lo * hi) : lo;
    if (type === "bandpass") f.Q.value = Math.sqrt(lo * hi) / (hi - lo);
    s.connect(f); f.connect(g); g.connect(this.out(dest)); this.env(g, t, 0.001, vol, decay);
    const len = Math.min(1.6, decay * 6 + 0.05);
    s.start(t, Math.random() * (1.99 - len)); s.stop(t + len);
  }
  pluck(f, t, vol, dest) { this.tone(f, t, 0.14, vol, "sine", dest); this.tone(2 * f, t, 0.09, vol * 0.35, "sine", dest); this.tone(3 * f, t, 0.05, vol * 0.15, "sine", dest); }
  bell(f, t, dur, decay, vol, dest) { this.tone(f, t, decay, vol, "sine", dest); this.tone(2 * f, t, 0.12, vol * 0.35, "sine", dest); this.tone(3.01 * f, t, 0.08, vol * 0.12, "sine", dest); }
  kick(t, v, dest) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.setTargetAtTime(48, t, 0.03);
    o.connect(g); g.connect(this.out(dest)); this.env(g, t, 0.001, 0.5 * v, 0.12); o.start(t); o.stop(t + 0.5);
    this.noiseHit(t, 2500, 8000, 0.005, 0.4 * v, dest);
    this.tone(1100, t, 0.008, 0.16 * v, "sine", dest);
  }
  clap(t, v, dest) {
    this.noiseHit(t, 900, 5200, 0.012, 0.32 * v, dest);
    this.noiseHit(t + 0.011, 900, 5200, 0.05, 0.34 * v, dest);
    this.tone(220, t, 0.03, 0.12 * v, "triangle", dest);
  }
  snare(t, v, dest) { this.noiseHit(t, 1200, 7000, 0.04, 0.3 * v, dest); this.tone(190, t, 0.025, 0.1 * v, "triangle", dest); }
  hat(t, open, v, dest) { this.noiseHit(t, open ? 6000 : 7500, 15000, open ? 0.07 : 0.014, (open ? 0.16 : 0.13) * v, dest); }
  crash(t, v, dest) { this.noiseHit(t, 5000, 0, 0.55, 0.11 * v, dest, "highpass"); }
  bass(f, t, len, dest) {
    const o = this.ctx.createOscillator(), lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = "sawtooth"; o.frequency.value = f;
    lp.type = "lowpass"; lp.Q.value = 5; lp.frequency.setValueAtTime(2400, t); lp.frequency.setTargetAtTime(800, t, 0.06);
    o.connect(lp); lp.connect(g); g.connect(this.out(dest));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.005); g.gain.setTargetAtTime(0.1, t + 0.005, 0.08); g.gain.setTargetAtTime(0, t + len, 0.015);
    o.start(t); o.stop(t + len + 0.15);
  }
  stab(freqs, t, dest) {
    const lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 2600; lp.connect(g); g.connect(this.out(dest));
    this.env(g, t, 0.003, 0.075, 0.07);
    for (const f of freqs) { const o = this.ctx.createOscillator(); o.type = "square"; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 0.5); }
  }
  pad(freqs, t, dur, pump, dest) {
    const g = this.ctx.createGain(), base = 0.11 / freqs.length;
    g.connect(this.out(dest));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(base, t + 0.2);
    if (pump) for (let k = 0; k < 4; k++) { const tb = t + k * BEAT; g.gain.setValueAtTime(base * 0.3, tb); g.gain.linearRampToValueAtTime(base, tb + BEAT * 0.55); }
    g.gain.linearRampToValueAtTime(0, t + dur);
    for (const f of freqs) for (const det of [-0.1, 0.1]) {
      const o = this.ctx.createOscillator();
      o.type = "triangle"; o.frequency.value = f * 2 ** (det / 12); o.connect(g); o.start(t); o.stop(t + dur + 0.05);
    }
  }
}
