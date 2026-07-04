"""Audio I/O helpers.

The public promise of StemSplitter is "process ANY audio format".  We keep that
promise by shelling out to a portable ffmpeg binary (shipped by the
``imageio-ffmpeg`` wheel, so no system install is required) to decode whatever
the user throws at us into a clean, normalised float32 array.
"""
from __future__ import annotations

import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
import soundfile as sf

from . import config


@lru_cache(maxsize=1)
def ffmpeg_exe() -> str:
    """Return a path to a usable ffmpeg binary (bundled first, system fallback)."""
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # pragma: no cover - only if imageio_ffmpeg missing
        return "ffmpeg"


def decode_to_array(src: Path, sample_rate: int = config.TARGET_SAMPLE_RATE,
                    channels: int = config.TARGET_CHANNELS) -> np.ndarray:
    """Decode *any* container/codec into a ``(samples, channels)`` float32 array.

    We ask ffmpeg for raw 32-bit float PCM on stdout and read it directly, which
    avoids a temp file and works identically for mp3/flac/m4a/ogg/video/etc.
    """
    cmd = [
        ffmpeg_exe(), "-nostdin", "-v", "error",
        "-i", str(src),
        "-f", "f32le", "-acodec", "pcm_f32le",
        "-ac", str(channels), "-ar", str(sample_rate),
        "pipe:1",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg could not decode {src.name}: "
            f"{proc.stderr.decode('utf-8', 'ignore')[-400:]}"
        )
    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    if audio.size == 0:
        raise RuntimeError(f"{src.name} decoded to an empty stream (unsupported / corrupt).")
    return audio.reshape(-1, channels).copy()


def encode_array(audio: np.ndarray, dst: Path, out_format: str,
                 sample_rate: int = config.TARGET_SAMPLE_RATE) -> Path:
    """Write a ``(samples, channels)`` array to ``dst`` in the requested format.

    WAV/FLAC go straight through libsndfile; lossy targets (mp3) are piped to
    ffmpeg so we still only depend on the bundled binary.
    """
    fmt = config.OUTPUT_FORMATS[out_format]
    dst = dst.with_suffix("." + fmt["ext"])
    audio = np.clip(audio, -1.0, 1.0).astype(np.float32)

    if out_format in ("wav", "flac"):
        sf.write(str(dst), audio, sample_rate, subtype="PCM_16" if out_format == "wav" else None)
        return dst

    # Lossy: hand raw PCM to ffmpeg.
    cmd = [
        ffmpeg_exe(), "-nostdin", "-v", "error", "-y",
        "-f", "f32le", "-ar", str(sample_rate), "-ac", str(audio.shape[1]),
        "-i", "pipe:0",
        "-codec:a", fmt["codec"], "-b:a", "320k",
        str(dst),
    ]
    proc = subprocess.run(cmd, input=audio.tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "ignore")[-400:])
    return dst


def peak_waveform(audio: np.ndarray, buckets: int = 480) -> list[float]:
    """Downsample a signal into per-bucket peak magnitudes for canvas rendering."""
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio
    if mono.size == 0:
        return [0.0] * buckets
    n = min(buckets, mono.size)
    edges = np.linspace(0, mono.size, n + 1, dtype=int)
    peaks = [float(np.abs(mono[a:b]).max()) if b > a else 0.0
             for a, b in zip(edges[:-1], edges[1:])]
    m = max(peaks) or 1.0
    peaks = [round(p / m, 4) for p in peaks]
    peaks += [0.0] * (buckets - len(peaks))
    return peaks
