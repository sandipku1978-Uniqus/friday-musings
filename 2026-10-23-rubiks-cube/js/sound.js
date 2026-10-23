// The video's soundtrack (music.py), synthesized live with Web Audio: same 104 BPM, chords, pluck arpeggio,
// bass, light drums and bell tune, plus a click per turn, a pencil tick per close task and a chime per sign-off.
// Nothing is downloaded and nothing plays until the reader taps a button.

const BPM = 104, BEAT = 60 / BPM, BAR = 4 * BEAT;
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

export class Sound {
  constructor(on = true) { this.on = on; this.ctx = null; this.playing = false; this.timer = null; }

  // Must be called from a tap/click: browsers only allow audio after a gesture.
  unlock() {
    if (!this.on) return false;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0;
        this.musicBus.connect(this.master);
        const n = this.ctx.sampleRate * 0.3, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        this.noise = b;
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    } catch { return false; }
  }

  setOn(on) { this.on = on; if (!on) this.stopMusic(0.15); }

  // ---- music loop ----------------------------------------------------------------------------
  startMusic() {
    if (!this.unlock() || this.playing) return;
    const t = this.ctx.currentTime;
    this.playing = true;
    this.bar = 0;
    this.nextBar = t + 0.05;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0.55, t + 0.6);
    const pump = () => { while (this.nextBar < this.ctx.currentTime + 0.4) { this.scheduleBar(this.bar++, this.nextBar); this.nextBar += BAR; } };
    pump();
    this.timer = setInterval(pump, 120);
  }

  stopMusic(fade = 1.2) {
    if (!this.ctx || !this.playing) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0, t + fade);
    clearInterval(this.timer);
    this.playing = false;
  }

  scheduleBar(b, t0) {
    const ch = PROG[b % PROG.length], notes = CHORDS[ch], groove = b >= 1;
    ARP.forEach((idx, e) => {
      const m = idx === 3 ? notes[0] + 12 : notes[idx];
      this.pluck(hz(m + 12), t0 + (e * BEAT) / 2, e % 2 ? 0.075 : 0.1, this.musicBus);
    });
    this.pad(notes.map(hz), t0, BAR + 0.3, this.musicBus);
    if (!groove) return;
    for (const [bt, len] of [[0, 1.5], [1.5, 0.5], [2, 1.5], [3.5, 0.5]]) this.bass(hz(ROOT[ch]), t0 + bt * BEAT, len * BEAT, this.musicBus);
    for (let k = 0; k < 4; k++) {
      if (k % 2 === 0) this.kick(t0 + k * BEAT, this.musicBus); else this.clap(t0 + k * BEAT, this.musicBus);
      this.hat(t0 + (k + 0.5) * BEAT, 1, this.musicBus);
      this.hat(t0 + k * BEAT, 0.45, this.musicBus);
    }
    if (b >= 2) for (const [bt, m, len] of MELODY[(b - 2) % 8]) this.bell(hz(m), t0 + bt * BEAT, Math.max(0.5, len * BEAT + 0.3), 0.32, 0.085, this.musicBus);
  }

  // ---- effects -------------------------------------------------------------------------------
  click() { if (this.unlock()) { const t = this.ctx.currentTime; this.noiseHit(t, 1800, 6500, 0.007, 0.22); this.tone(340, t, 0.012, 0.13, "sine"); } }
  tick() { if (this.unlock()) { const t = this.ctx.currentTime; this.noiseHit(t, 2500, 9000, 0.02, 0.18); this.tone(1320, t, 0.05, 0.06, "triangle"); } }
  chime() { if (this.unlock()) { const t = this.ctx.currentTime; this.bell(hz(84), t, 1, 0.4, 0.16); this.bell(hz(91), t + 0.09, 1.2, 0.5, 0.16); } }
  retest() { if (this.unlock()) { const t = this.ctx.currentTime; this.tone(hz(55), t, 0.18, 0.12, "triangle"); } }
  fanfare() { if (this.unlock()) { const t = this.ctx.currentTime; [72, 76, 79, 84].forEach((m, i) => this.bell(hz(m + 12), t + 0.2 + i * 0.1, 1.6, 0.6, 0.12)); } }

  // ---- instruments (music.py, translated) --------------------------------------------------
  out(dest) { return dest || this.master; }
  env(g, t, a, peak, decay) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + a, decay); }
  tone(f, t, decay, vol, type = "sine", dest) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f; o.connect(g); g.connect(this.out(dest));
    this.env(g, t, 0.002, vol, decay); o.start(t); o.stop(t + decay * 8 + 0.05);
  }
  pluck(f, t, vol, dest) { this.tone(f, t, 0.16, vol, "sine", dest); this.tone(2 * f, t, 0.1, vol * 0.35, "sine", dest); this.tone(3 * f, t, 0.06, vol * 0.15, "sine", dest); }
  bell(f, t, dur, decay, vol, dest) { this.tone(f, t, decay, vol, "sine", dest); this.tone(2 * f, t, 0.12, vol * 0.35, "sine", dest); this.tone(3.01 * f, t, 0.08, vol * 0.12, "sine", dest); }
  bass(f, t, len, dest) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = f; o.connect(g); g.connect(this.out(dest));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.006); g.gain.setTargetAtTime(0.08, t + 0.006, 0.28); g.gain.setTargetAtTime(0, t + len - 0.03, 0.02);
    o.start(t); o.stop(t + len + 0.2);
  }
  pad(freqs, t, dur, dest) {
    for (const f of freqs) for (const det of [-0.12, 0.12]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = f * 2 ** (det / 12); o.connect(g); g.connect(this.out(dest));
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 / (2 * freqs.length), t + 0.35); g.gain.linearRampToValueAtTime(0, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
  kick(t, dest) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(156, t); o.frequency.setTargetAtTime(46, t, 0.035);
    o.connect(g); g.connect(this.out(dest)); this.env(g, t, 0.001, 0.55, 0.12); o.start(t); o.stop(t + 0.4);
  }
  noiseHit(t, lo, hi, decay, vol, dest) {
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = Math.sqrt(lo * hi); f.Q.value = Math.sqrt(lo * hi) / (hi - lo);
    s.connect(f); f.connect(g); g.connect(this.out(dest)); this.env(g, t, 0.001, vol, decay); s.start(t); s.stop(t + 0.25);
  }
  clap(t, dest) { this.noiseHit(t, 900, 5200, 0.045, 0.22, dest); }
  hat(t, v, dest) { this.noiseHit(t, 7000, 16000, 0.012, 0.25 * v, dest); }
}
