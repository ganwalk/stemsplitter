"""Source separation engines.

Two engines are available and selected automatically:

* ``DemucsEngine`` — the real deal.  Uses Facebook's Hybrid Transformer Demucs
  (state of the art) when ``demucs`` + ``torch`` are installed.  Produces clean,
  studio-usable stems.

* ``PreviewEngine`` — a pure-numpy DSP fallback (mid/side + multiband filtering)
  that requires nothing beyond the core deps.  It lets the whole app — upload,
  pipeline, mixing console, playback, download — work out of the box.  Quality is
  "preview" grade, not studio grade.

Both return the same shape: ``{channel_name: (samples, 2) float32 array}`` already
grouped according to the requested :data:`config.STEM_MODES` entry.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np

from . import config


def demucs_available() -> bool:
    return importlib.util.find_spec("demucs") is not None and \
        importlib.util.find_spec("torch") is not None


# ---------------------------------------------------------------------------
# Grouping helper shared by both engines
# ---------------------------------------------------------------------------
def _group(sources: dict[str, np.ndarray], mode: str) -> dict[str, np.ndarray]:
    """Sum a model's raw sources into the console channels for *mode*."""
    spec = config.STEM_MODES[mode]
    out: dict[str, np.ndarray] = {}
    for channel, parts in spec["groups"].items():
        stack = [sources[p] for p in parts if p in sources]
        if not stack:
            continue
        out[channel] = np.sum(stack, axis=0).astype(np.float32)
    return out


class Engine:
    name = "base"
    quality = "unknown"

    def separate(self, audio: np.ndarray, mode: str,
                 progress=lambda p, s: None) -> dict[str, np.ndarray]:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Real engine: Demucs
# ---------------------------------------------------------------------------
class DemucsEngine(Engine):
    name = "demucs"
    quality = "studio"
    _cache: dict[str, object] = {}

    def _model(self, model_name: str):
        if model_name not in self._cache:
            from demucs.pretrained import get_model  # lazy: heavy import
            self._cache[model_name] = get_model(model_name)
        return self._cache[model_name]

    def separate(self, audio, mode, progress=lambda p, s: None):
        import torch
        from demucs.apply import apply_model

        spec = config.STEM_MODES[mode]
        progress(0.05, f"Carregando modelo {spec['model']}…")
        model = self._model(spec["model"])
        model.eval()

        # demucs wants (batch, channels, samples)
        wav = torch.from_numpy(audio.T).float().unsqueeze(0)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)

        progress(0.15, "Separando faixas (rede neural)…")
        with torch.no_grad():
            out = apply_model(model, wav, split=True, overlap=0.25, progress=False)[0]
        out = out * ref.std() + ref.mean()

        sources = {name: out[i].cpu().numpy().T.astype(np.float32)
                   for i, name in enumerate(model.sources)}
        progress(0.9, "Agrupando canais…")
        return _group(sources, mode)


# ---------------------------------------------------------------------------
# Fallback engine: numpy DSP preview
# ---------------------------------------------------------------------------
class PreviewEngine(Engine):
    name = "preview"
    quality = "preview"

    @staticmethod
    def _biquad(x: np.ndarray, sr: int, kind: str, cutoff: float) -> np.ndarray:
        """Very small one-pole/one-zero filter, applied per channel."""
        import math

        dt = 1.0 / sr
        rc = 1.0 / (2 * math.pi * cutoff)
        alpha = dt / (rc + dt)
        y = np.empty_like(x)
        if kind == "low":
            acc = np.zeros(x.shape[1])
            for i in range(x.shape[0]):
                acc = acc + alpha * (x[i] - acc)
                y[i] = acc
            return y
        # high-pass = signal - low-pass
        return x - PreviewEngine._biquad(x, sr, "low", cutoff)

    def separate(self, audio, mode, progress=lambda p, s: None):
        sr = config.TARGET_SAMPLE_RATE
        progress(0.1, "Analisando espectro…")
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        left, right = audio[:, 0], audio[:, 1]
        mid = (left + right) * 0.5
        side = (left - right) * 0.5

        progress(0.35, "Extraindo bandas…")
        # Vocals: centre content (mid), band-limited to the vocal range.
        centre = np.stack([mid, mid], axis=1)
        vocals = self._biquad(centre, sr, "high", 180.0)
        vocals = self._biquad(vocals, sr, "low", 8000.0)

        progress(0.55, "Isolando graves…")
        bass = self._biquad(np.stack([mid, mid], axis=1), sr, "low", 250.0)

        progress(0.7, "Detectando percussão…")
        # Drums: transient/high energy in the stereo field.
        stereo = np.stack([side, side], axis=1)
        drums = self._biquad(stereo, sr, "high", 2500.0)

        progress(0.82, "Compondo restante…")
        raw = {"vocals": vocals, "bass": bass, "drums": drums}
        # "other"/"guitar"/"piano" = whatever remains after the above.
        residual = audio - (vocals + bass + drums)
        residual = residual.astype(np.float32)
        for extra in ("other", "guitar", "piano"):
            raw[extra] = residual / 1.0  # they share the residual; grouping sums them back safely

        # Prevent the shared-residual channels from stacking to >1x on grouping:
        spec = config.STEM_MODES[mode]
        residual_channels = [c for c, parts in spec["groups"].items()
                             if all(p in ("other", "guitar", "piano") for p in parts)]
        if residual_channels:
            share = 1.0 / len(residual_channels)
            for extra in ("other", "guitar", "piano"):
                raw[extra] = residual * share

        progress(0.92, "Agrupando canais…")
        return _group(raw, mode)


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------
def get_engine() -> Engine:
    return DemucsEngine() if demucs_available() else PreviewEngine()
