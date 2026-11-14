#!/usr/bin/env python3
"""Находит доли (биты) в отрывках песен → opt/beats.js (window.BEATS).

Зачем: искры и свечение «бьют» в такт музыке. Анализатор в браузере сглаживает звук и ловит удар
с опозданием, а тут доли считаются заранее по всему отрывку — на сайте удар срабатывает ровно
по времени воспроизведения, на телефоне это ещё и дешевле.

Метод: огибающая атак (спектральный поток, низам — больший вес) → темп по автокорреляции →
сетка долей динамическим программированием (Ellis, 2007) → каждая доля подтягивается к ближайшей атаке.
Сила доли (0..1) — насколько сильный там удар: сайт делает вспышку больше или меньше.

Запуск из корня проекта:  python3 tools/beats.py      (нужны ffmpeg и numpy)
"""
import json, subprocess
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR, N, HOP = 22050, 1024, 256
FPS = SR / HOP  # ~86 кадров огибающей в секунду


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', str(path), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def onset_env(x):
    frames = np.lib.stride_tricks.sliding_window_view(x, N)[::HOP] * np.hanning(N)
    mag = np.log1p(100 * np.abs(np.fft.rfft(frames, axis=1)))
    freqs = np.fft.rfftfreq(N, 1 / SR)
    w = np.where(freqs < 200, 3.0, np.where(freqs < 4000, 1.0, 0.3))  # бочка важнее тарелок
    flux = (np.maximum(0, np.diff(mag, axis=0)) * w).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux -= np.convolve(flux, np.ones(16) / 16, mode='same')  # убираем медленный фон
    flux = np.maximum(0, flux)
    return flux / (flux.max() or 1)


def tempo(env):
    ac = np.correlate(env, env, mode='full')[len(env) - 1:]
    lags = np.arange(len(ac))
    bpm = 60 * FPS / np.maximum(lags, 1)
    ok = (bpm >= 70) & (bpm <= 180)
    weight = np.exp(-0.5 * (np.log2(bpm / 115) / 0.9) ** 2)  # мягко предпочитаем ~115 BPM
    lag = lags[ok][np.argmax((ac * weight)[ok])]
    return lag  # период в кадрах огибающей


def track(env, period, tight=100):
    n = len(env); score = env.copy(); back = -np.ones(n, dtype=int)
    lo, hi = int(round(period / 2)), int(round(period * 2))
    for t in range(hi, n):
        prev = np.arange(t - hi, t - lo)
        cost = -tight * np.log((t - prev) / period) ** 2
        k = np.argmax(score[prev] + cost)
        score[t] = env[t] + score[prev[k]] + cost[k]; back[t] = prev[k]
    t = int(np.argmax(score[-hi:]) + n - hi); beats = []
    while t >= 0:
        beats.append(t); t = back[t]
    return np.array(beats[::-1])


out = {}
for mp3 in sorted((ROOT / 'media' / 'previews').glob('*.mp3')):
    env = onset_env(load(mp3))
    period = tempo(env)
    beats = track(env, period)
    # подтягиваем к ближайшей атаке (±35 мс) и считаем силу удара
    r = int(0.035 * FPS); res = []
    for b in beats:
        a, z = max(0, b - r), min(len(env), b + r + 1)
        p = a + int(np.argmax(env[a:z]))
        res.append([round(p / FPS, 3), round(float(env[p]), 2)])
    strengths = np.array([s for _, s in res]); top = np.percentile(strengths, 90) or 1
    res = [[t, round(float(min(1, s / top)), 2)] for t, s in res]
    key = f'media/previews/{mp3.name}'
    out[key] = res
    print(f'{mp3.name:28s} {60 * FPS / period:6.1f} BPM  {len(res)} долей')

(ROOT / 'opt' / 'beats.js').write_text(
    '// сгенерировано tools/beats.py — не править руками. [время, сила 0..1] для каждой доли\n'
    f'window.BEATS = {json.dumps(out, separators=(",", ":"))};\n', encoding='utf-8')
print('opt/beats.js', (ROOT / 'opt' / 'beats.js').stat().st_size // 1024, 'KB')
