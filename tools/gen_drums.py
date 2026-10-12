#!/usr/bin/env python3
"""
Procedurally synthesise a large, license-clean lofi drum library.

Every one-shot is generated from scratch with numpy (no scipy, no external
audio), given a "dusty tape" character, and written as 16-bit mono WAV plus a
manifest.json the web app reads at boot. Deterministic: a fixed master seed
reproduces the exact same library.

Usage:  python gen_drums.py <output_dir>
"""
from __future__ import annotations

import json
import os
import sys
import wave
import zlib

import numpy as np

SR = 22050  # 22.05 kHz keeps files small; lofi drums live well under Nyquist


# --------------------------------------------------------------------------
# Helpers

def t(n: int) -> np.ndarray:
    return np.arange(n) / SR


def exp_env(n: int, tau: float, attack: float = 0.001) -> np.ndarray:
    """Percussive attack + exponential decay envelope."""
    tt = t(n)
    env = np.exp(-tt / max(tau, 1e-4))
    a = max(int(attack * SR), 1)
    if a > 1:
        env[:a] *= np.linspace(0.0, 1.0, a)
    return env


def fft_filter(x: np.ndarray, mask_fn) -> np.ndarray:
    """Zero-phase filtering by shaping the magnitude spectrum."""
    n = len(x)
    X = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    return np.fft.irfft(X * mask_fn(freqs), n)


def lowpass(fc: float, order: float = 2.0):
    return lambda f: 1.0 / np.sqrt(1.0 + (f / max(fc, 1e-6)) ** (2 * order))


def highpass(fc: float, order: float = 2.0):
    return lambda f: (f / max(fc, 1e-6)) ** order / np.sqrt(1.0 + (f / max(fc, 1e-6)) ** (2 * order))


def bandpass(fc: float, width_oct: float = 0.8):
    lo = fc * 2 ** (-width_oct / 2)
    hi = fc * 2 ** (width_oct / 2)
    return lambda f: np.exp(-0.5 * (np.log2(np.maximum(f, 1e-6) / fc) / (width_oct / 2.355)) ** 2) \
        * (1.0 / (1.0 + (lo / np.maximum(f, 1e-6)) ** 4)) * (1.0 / (1.0 + (f / hi) ** 4)) ** 0.5


def sine(freq, n: int, phase0: float = 0.0) -> np.ndarray:
    f = np.asarray(freq, dtype=float) * np.ones(n)
    phase = phase0 + 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase)


def noise(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.standard_normal(n) * 0.5


def metallic(n: int, base: float, ratios, rng: np.random.Generator) -> np.ndarray:
    out = np.zeros(n)
    for r in ratios:
        out += np.sign(np.sin(2 * np.pi * base * r * t(n) + rng.uniform(0, 2 * np.pi)))
    return out / max(len(ratios), 1)


def normalize(x: np.ndarray, peak: float = 0.72) -> np.ndarray:
    m = np.max(np.abs(x)) or 1.0
    return x * (peak / m)


def declick(x: np.ndarray, ms: float = 2.0) -> np.ndarray:
    a = max(int(SR * ms / 1000), 1)
    if len(x) <= 2 * a:
        return x
    w = np.ones(len(x))
    w[:a] = np.linspace(0, 1, a)
    w[-a:] = np.linspace(1, 0, a)
    return x * w


# --------------------------------------------------------------------------
# Lofi "dusty tape" mastering chain applied to every one-shot

def lofi_chain(x: np.ndarray, rng: np.random.Generator, *, drive=None, tone=None,
               bits=None, hiss=None, hp=None) -> np.ndarray:
    drive = drive if drive is not None else rng.uniform(1.0, 2.6)
    tone = tone if tone is not None else rng.uniform(6000, 9500)
    bits = bits if bits is not None else rng.integers(6, 11)
    hiss = hiss if hiss is not None else rng.uniform(0.0, 0.012)
    hp = hp if hp is not None else rng.uniform(24, 45)

    # tape saturation
    x = np.tanh(x * drive) / np.tanh(drive)
    # bit crush
    levels = 2 ** (bits - 1)
    x = np.round(x * levels) / levels
    # dusty top end + remove rumble
    x = fft_filter(x, lowpass(tone))
    x = fft_filter(x, highpass(hp))
    # faint vinyl hiss
    if hiss > 0:
        x = x + noise(len(x), rng) * hiss
    return declick(x)


# --------------------------------------------------------------------------
# Recipes — each returns a fresh one-shot for a variant

def make_kick(rng):
    f0 = rng.uniform(46, 60)
    dur = rng.uniform(0.28, 0.5)
    n = int(dur * SR)
    f = f0 * (1 + (rng.uniform(2.5, 5.0) - 1) * np.exp(-t(n) / rng.uniform(0.02, 0.05)))
    body = sine(f, n)
    body *= exp_env(n, rng.uniform(0.09, 0.22), 0.002)
    click = noise(int(0.006 * SR), rng)
    click = fft_filter(click, highpass(rng.uniform(1500, 2600)))
    click *= exp_env(len(click), 0.003) * rng.uniform(0.15, 0.5)
    x = body.copy()
    x[: len(click)] += click
    return lofi_chain(x, rng, drive=rng.uniform(1.6, 3.2), tone=rng.uniform(1600, 3200))


def make_snare(rng):
    dur = rng.uniform(0.18, 0.32)
    n = int(dur * SR)
    tune = rng.uniform(175, 235)
    tone = sine(tune, n) * 0.5 + sine(tune * 1.62, n) * 0.35
    tone *= exp_env(n, rng.uniform(0.05, 0.1))
    body = noise(n, rng)
    body = fft_filter(body, bandpass(rng.uniform(1300, 2300), 1.0))
    body *= exp_env(n, rng.uniform(0.09, 0.2))
    x = tone * rng.uniform(0.4, 0.8) + body * rng.uniform(0.7, 1.1)
    return lofi_chain(x, rng, drive=rng.uniform(1.1, 2.0), tone=rng.uniform(6500, 9500))


def make_hat(rng, open_=False):
    dur = rng.uniform(0.22, 0.5) if open_ else rng.uniform(0.05, 0.12)
    n = int(dur * SR)
    base = rng.uniform(300, 420)
    metal = metallic(n, base, [2, 3, 4.16, 5.43, 6.79, 8.21], rng)
    metal = fft_filter(metal, bandpass(rng.uniform(7000, 10000) if not open_ else rng.uniform(5500, 8000), 0.7))
    hiss = fft_filter(noise(n, rng), highpass(rng.uniform(6000, 9000)))
    x = metal * rng.uniform(0.6, 1.0) + hiss * rng.uniform(0.4, 0.9)
    x *= exp_env(n, rng.uniform(0.16, 0.42) if open_ else rng.uniform(0.02, 0.05))
    return lofi_chain(x, rng, drive=rng.uniform(0.8, 1.6), tone=rng.uniform(9000, 12000), hp=4000)


def make_rim(rng):
    dur = rng.uniform(0.06, 0.13)
    n = int(dur * SR)
    tone = sine(rng.uniform(1500, 1900), n) * 0.5 + sine(rng.uniform(400, 520), n) * 0.4
    tone *= exp_env(n, rng.uniform(0.03, 0.06))
    tick = fft_filter(noise(n, rng), bandpass(rng.uniform(1500, 2600), 1.2))
    tick *= exp_env(n, rng.uniform(0.02, 0.04))
    x = tone * rng.uniform(0.5, 0.9) + tick * rng.uniform(0.5, 1.0)
    return lofi_chain(x, rng, drive=rng.uniform(0.8, 1.6), tone=rng.uniform(7000, 10000))


def make_shaker(rng):
    dur = rng.uniform(0.09, 0.2)
    n = int(dur * SR)
    x = fft_filter(noise(n, rng), highpass(rng.uniform(5000, 8500)))
    env = exp_env(n, rng.uniform(0.05, 0.12), attack=rng.uniform(0.006, 0.02))
    x *= env
    return lofi_chain(x, rng, drive=rng.uniform(0.6, 1.2), tone=rng.uniform(9000, 12000), hp=3000)


def make_tom(rng):
    f0 = rng.uniform(90, 165)
    dur = rng.uniform(0.2, 0.4)
    n = int(dur * SR)
    f = f0 * (1 + 0.35 * np.exp(-t(n) / 0.05))
    body = sine(f, n) * exp_env(n, rng.uniform(0.12, 0.3), 0.003)
    attack = fft_filter(noise(int(0.01 * SR), rng), bandpass(rng.uniform(800, 1600), 1.0))
    attack *= exp_env(len(attack), 0.006) * rng.uniform(0.2, 0.5)
    x = body.copy()
    x[: len(attack)] += attack
    return lofi_chain(x, rng, drive=rng.uniform(1.0, 1.9), tone=rng.uniform(2500, 4500))


def make_clap(rng):
    dur = rng.uniform(0.22, 0.34)
    n = int(dur * SR)
    spacing = rng.uniform(0.006, 0.014)
    x = np.zeros(n)
    bursts = int(rng.integers(3, 5))
    for i in range(bursts):
        start = int(i * spacing * SR)
        if start >= n:
            break
        b = fft_filter(noise(n - start, rng), bandpass(rng.uniform(900, 1900), 1.1))
        b *= exp_env(len(b), rng.uniform(0.01, 0.02)) * (1.0 - i * 0.12)
        x[start:] += b
    tail = fft_filter(noise(n, rng), bandpass(rng.uniform(800, 1600), 0.9))
    tail *= exp_env(n, rng.uniform(0.12, 0.24), attack=0.02)
    x += tail * 0.6
    return lofi_chain(x, rng, drive=rng.uniform(0.9, 1.6), tone=rng.uniform(6000, 9000))


def make_crash(rng):
    dur = rng.uniform(0.6, 0.95)
    n = int(dur * SR)
    base = rng.uniform(280, 360)
    x = metallic(n, base, [2, 3, 4.16, 5.43, 6.79, 8.21], rng) * 0.7
    x += fft_filter(noise(n, rng), highpass(rng.uniform(4000, 7000))) * 0.6
    x *= exp_env(n, rng.uniform(0.35, 0.7), attack=0.002)
    return lofi_chain(x, rng, drive=rng.uniform(0.8, 1.4), tone=rng.uniform(10000, 13000), hp=2500)


RECIPES = {
    "kick": (make_kick, 18),
    "snare": (make_snare, 18),
    "hat": (lambda r: make_hat(r, open_=False), 18),
    "openhat": (lambda r: make_hat(r, open_=True), 12),
    "rim": (make_rim, 12),
    "shaker": (make_shaker, 12),
    "tom": (make_tom, 12),
    "clap": (make_clap, 12),
    "crash": (make_crash, 10),
}


def write_wav(path: str, x: np.ndarray) -> None:
    data = np.clip(x, -1.0, 1.0)
    pcm = (data * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> None:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "public/drums"
    rng = np.random.default_rng(0x10F1)
    manifest = {}
    total = 0
    bytes_total = 0
    for instrument, (fn, count) in RECIPES.items():
        folder = os.path.join(out_dir, instrument)
        os.makedirs(folder, exist_ok=True)
        files = []
        for i in range(1, count + 1):
            # a per-variant rng keeps generation order-independent and reproducible
            salt = zlib.crc32(f"{instrument}:{i}".encode()) & 0xFFFFFF
            vrng = np.random.default_rng(0x10F1 + salt)
            x = normalize(fn(vrng))
            rel = f"{instrument}/{i:02d}.wav"
            path = os.path.join(out_dir, rel)
            write_wav(path, x)
            files.append(rel)
            bytes_total += os.path.getsize(path)
            total += 1
        manifest[instrument] = files
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"wrote {total} samples, {bytes_total/1024/1024:.2f} MB to {out_dir}")
    for k, v in manifest.items():
        print(f"  {k:8s} {len(v)}")


if __name__ == "__main__":
    main()
