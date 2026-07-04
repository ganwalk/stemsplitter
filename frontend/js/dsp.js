/* ============================================================
   StemSplitter — client-side DSP separation engine
   Pure JS port of the numpy "preview" engine: no server, no ML model.
   Splits a stereo signal into 4 fundamental bands via mid/side
   decomposition + one-pole filters, then blends those bands into
   whatever channels the selected mode asks for.
   ============================================================ */

import { STEM_MODES } from "./config.js";

/** One-pole low-pass, applied in place over a mono Float32Array. */
function lowPass(x, sampleRate, cutoffHz) {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  const y = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += alpha * (x[i] - acc);
    y[i] = acc;
  }
  return y;
}

/** Complementary high-pass = signal - low-pass(signal). */
function highPass(x, sampleRate, cutoffHz) {
  const low = lowPass(x, sampleRate, cutoffHz);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] - low[i];
  return y;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Separate a decoded AudioBuffer into named channels for `mode`.
 * Returns { [channelKey]: { L: Float32Array, R: Float32Array } }.
 * `onProgress(fraction, stageLabel)` is called between stages so the UI can
 * update; this is async and yields a frame after each stage so a long
 * separation doesn't freeze the tab.
 */
export async function separate(audioBuffer, mode, onProgress = () => {}) {
  const sr = audioBuffer.sampleRate;
  const n = audioBuffer.length;
  const left = audioBuffer.getChannelData(0).slice();
  const right = audioBuffer.numberOfChannels > 1
    ? audioBuffer.getChannelData(1).slice()
    : audioBuffer.getChannelData(0).slice();

  onProgress(0.05, "Analisando espectro…");
  await nextFrame();
  const mid = new Float32Array(n);
  const side = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mid[i] = (left[i] + right[i]) * 0.5;
    side[i] = (left[i] - right[i]) * 0.5;
  }

  onProgress(0.25, "Isolando vocais…");
  await nextFrame();
  // Vocals: centre-panned content, band-limited to the vocal range.
  const vocalsMono = lowPass(highPass(mid, sr, 180), sr, 8000);

  onProgress(0.5, "Isolando graves…");
  await nextFrame();
  const bassMono = lowPass(mid, sr, 250);

  onProgress(0.68, "Detectando percussão…");
  await nextFrame();
  // Drums: high-frequency energy carried in the stereo field.
  const drumsMono = highPass(side, sr, 2500);

  onProgress(0.8, "Compondo resíduo…");
  await nextFrame();
  const residualL = new Float32Array(n);
  const residualR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = vocalsMono[i], b = bassMono[i], d = drumsMono[i];
    residualL[i] = left[i] - (v + b + d);
    residualR[i] = right[i] - (v + b + d);
  }

  const bands = {
    vocals: { L: vocalsMono, R: vocalsMono },
    bass: { L: bassMono, R: bassMono },
    drums: { L: drumsMono, R: drumsMono },
    residual: { L: residualL, R: residualR },
  };

  onProgress(0.9, "Agrupando canais…");
  await nextFrame();
  const spec = STEM_MODES[mode];
  const out = {};
  for (const { key, bands: parts } of spec.channels) {
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (const [bandName, weight] of parts) {
      const band = bands[bandName];
      for (let i = 0; i < n; i++) {
        L[i] += band.L[i] * weight;
        R[i] += band.R[i] * weight;
      }
    }
    out[key] = { L, R };
  }
  onProgress(1, "Concluído");
  return out;
}

/** Downsample a stereo {L,R} pair into per-bucket peak magnitudes for canvas rendering. */
export function peakWaveform(stereo, buckets = 120) {
  const { L, R } = stereo;
  const n = L.length;
  if (n === 0) return new Array(buckets).fill(0);
  const peaks = new Array(buckets).fill(0);
  const step = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * step);
    const end = Math.max(start + 1, Math.floor((b + 1) * step));
    let peak = 0;
    for (let i = start; i < end && i < n; i++) {
      const m = Math.abs((L[i] + R[i]) * 0.5);
      if (m > peak) peak = m;
    }
    peaks[b] = peak;
  }
  const max = Math.max(...peaks) || 1;
  return peaks.map((p) => Math.round((p / max) * 10000) / 10000);
}
