"""Original, procedurally composed soundtrack: a light, upbeat groove plus turn clicks and chimes.

Everything here is synthesized from scratch (no samples, no existing recordings)."""
import json
import sys
import wave
import numpy as np
from scipy.signal import butter, lfilter

SR = 44100
BPM = 104
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, attack, decay, sustain=0.0, release=None):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = sustain + (1 - sustain) * np.exp(-t / decay)
    e = a * d
    if release:
        r = int(release * SR)
        if r < n:
            e[-r:] *= np.linspace(1, 0, r)
    return e


def add(buf, start, sig, pan=0.0):
    i = int(start * SR)
    if i >= buf.shape[1] or i < 0:
        return
    j = min(buf.shape[1], i + len(sig))
    l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    buf[0, i:j] += sig[: j - i] * l
    buf[1, i:j] += sig[: j - i] * r


def band(x, lo, hi):
    b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], btype='band')
    return lfilter(b, a, x)


def high(x, f):
    b, a = butter(2, f / (SR / 2), btype='high')
    return lfilter(b, a, x)


# ---------------------------------------------------------------- instruments
def pad(freqs, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for f in freqs:
        for det in (-0.12, 0.12):
            ff = f * 2 ** (det / 12)
            s += np.sin(2 * np.pi * ff * t) + 0.25 * np.sin(4 * np.pi * ff * t)
    return s / (2 * len(freqs)) * env(n, 0.35, 99, 1.0, release=0.4)


def pluck(f, dur=0.45, bright=0.35):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + bright * np.sin(4 * np.pi * f * t) + 0.15 * np.sin(6 * np.pi * f * t)
    return s * env(n, 0.004, 0.16)


def bell(f, dur=0.9, decay=0.35):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2.0 * f * t) * np.exp(-t / 0.12)
         + 0.12 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t / 0.08))
    return s * env(n, 0.003, decay)


def bass(f, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)
    return s * env(n, 0.006, 0.28, 0.25, release=0.05)


def kick():
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(n, 0.001, 0.12)


def clap():
    n = int(0.16 * SR)
    noise = rng.standard_normal(n)
    return band(noise, 900, 5200) * env(n, 0.002, 0.045) * 0.9


def hat(v=1.0):
    n = int(0.045 * SR)
    return high(rng.standard_normal(n), 7000) * env(n, 0.001, 0.012) * 0.5 * v


def click():
    """A plastic 'tick' for each cube turn."""
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    tick = band(rng.standard_normal(n), 1800, 6500) * env(n, 0.0005, 0.007)
    thock = np.sin(2 * np.pi * 340 * t) * env(n, 0.001, 0.012) * 0.6
    return (tick + thock) * 0.9


# ---------------------------------------------------------------- composition
CHORDS = {  # midi notes, mid register
    'C': [60, 64, 67], 'G': [59, 62, 67], 'Am': [57, 60, 64], 'F': [57, 60, 65],
}
ROOT = {'C': 48, 'G': 43, 'Am': 45, 'F': 41}
PROG = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G']
# an original 8-bar tune (beats, midi)
MELODY = [
    [(0, 76, .5), (.5, 79, .5), (1, 81, .5), (1.5, 79, .5), (2, 76, 1), (3, 74, 1)],
    [(0, 79, 1.5), (1.5, 76, .5), (2, 74, 2)],
    [(0, 72, .5), (.5, 74, .5), (1, 76, 1), (2, 81, 1), (3, 79, 1)],
    [(0, 77, 1), (1, 76, 1), (2, 72, 2)],
    [(0, 76, .5), (.5, 79, .5), (1, 81, .5), (1.5, 79, .5), (2, 76, 1), (3, 74, 1)],
    [(0, 79, 1), (1, 81, .5), (1.5, 79, .5), (2, 76, 2)],
    [(0, 77, 1), (1, 76, 1), (2, 74, 1), (3, 72, 1)],
    [(0, 74, 2), (2, 79, 2)],
]
ARP = [0, 1, 2, 3, 2, 1, 0, 2]  # chord-tone index per eighth (3 = octave)


def compose(duration):
    buf = np.zeros((2, int((duration + 3) * SR)))
    music = np.zeros_like(buf)
    n_bars = int(np.ceil(duration / BAR))
    for b in range(n_bars):
        t0 = b * BAR
        ch = PROG[b % len(PROG)]
        notes = CHORDS[ch]
        last = b >= n_bars - 2
        groove = 2 <= b < n_bars - 2
        add(music, t0, pad([hz(m) for m in notes], BAR + 0.3) * 0.16)
        # arpeggio
        for e in range(8):
            idx = ARP[e]
            m = notes[0] + 12 if idx == 3 else notes[idx]
            add(music, t0 + e * BEAT / 2, pluck(hz(m + 12)) * (0.10 if e % 2 == 0 else 0.075), pan=0.25)
        if groove or last:
            for beat_i, length in [(0, 1.5), (1.5, 0.5), (2, 1.5), (3.5, 0.5)]:
                add(music, t0 + beat_i * BEAT, bass(hz(ROOT[ch]), length * BEAT) * 0.32)
        if groove:
            for k in range(4):
                if k in (0, 2):
                    add(music, t0 + k * BEAT, kick() * 0.55)
                else:
                    add(music, t0 + k * BEAT, clap() * 0.22)
                add(music, t0 + (k + 0.5) * BEAT, hat(1.0), pan=-0.3)
                add(music, t0 + k * BEAT, hat(0.45), pan=-0.3)
            # melody in two sections, so it does not get tiring
            if 4 <= b < 12 or 16 <= b < 24:
                for beat_i, m, length in MELODY[(b - 4) % 8]:
                    add(music, t0 + beat_i * BEAT, bell(hz(m), dur=max(0.5, length * BEAT + 0.3), decay=0.32) * 0.085,
                        pan=-0.1)
    # final chord ring
    end_t = n_bars * BAR
    for i, m in enumerate([60, 64, 67, 72]):
        add(music, end_t + i * 0.06, bell(hz(m + 12), dur=2.5, decay=0.9) * 0.06)
    return music


def sfx(events, length):
    buf = np.zeros((2, length))
    for t, kind in events:
        if kind == 'click':
            add(buf, t, click() * 0.30)
        elif kind == 'chime':
            add(buf, t, bell(hz(84), dur=1.0, decay=0.4) * 0.16, pan=0.1)
            add(buf, t + 0.09, bell(hz(91), dur=1.2, decay=0.5) * 0.16, pan=0.1)
        elif kind == 'outro':
            for i, m in enumerate([72, 76, 79, 84]):
                add(buf, t + 0.2 + i * 0.1, bell(hz(m + 12), dur=1.6, decay=0.6) * 0.12)
    return buf


def main(events_path, out_wav):
    meta = json.load(open(events_path))
    duration = meta['duration']
    music = compose(duration)
    fx = sfx(meta['events'], music.shape[1])
    mix = 0.75 * music + fx
    mix = mix[:, : int(duration * SR)]
    # gentle fades
    fi, fo = int(0.25 * SR), int(2.2 * SR)
    mix[:, :fi] *= np.linspace(0, 1, fi)
    mix[:, -fo:] *= np.linspace(1, 0, fo) ** 1.5
    mix = np.tanh(mix * 1.2) / np.tanh(1.2)
    mix *= 0.89 / np.max(np.abs(mix))
    pcm = (mix.T * 32767).astype(np.int16)
    with wave.open(out_wav, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', out_wav, f'{duration:.2f}s')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
