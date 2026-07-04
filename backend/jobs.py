"""In-memory job manager for separation runs.

A job moves through: queued -> decoding -> separating -> encoding -> done|error.
Progress is polled by the frontend.  Everything is kept in a simple dict so the
app has zero external infrastructure (no Redis/DB) — perfect for a single-box
web app or a demo.
"""
from __future__ import annotations

import shutil
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import audio, config, separator

_ENGINE = separator.get_engine()


@dataclass
class Stem:
    channel: str
    filename: str
    waveform: list[float]


@dataclass
class Job:
    id: str
    source_name: str
    mode: str
    out_format: str
    status: str = "queued"
    progress: float = 0.0
    stage: str = "Na fila"
    engine: str = _ENGINE.name
    quality: str = _ENGINE.quality
    duration: float = 0.0
    stems: list[Stem] = field(default_factory=list)
    error: str | None = None
    created: float = field(default_factory=time.time)

    def public(self) -> dict:
        return {
            "id": self.id,
            "source_name": self.source_name,
            "mode": self.mode,
            "out_format": self.out_format,
            "status": self.status,
            "progress": round(self.progress, 3),
            "stage": self.stage,
            "engine": self.engine,
            "quality": self.quality,
            "duration": round(self.duration, 2),
            "error": self.error,
            "stems": [
                {
                    "channel": s.channel,
                    "meta": config.STEM_META.get(s.channel, {}),
                    "url": f"/api/jobs/{self.id}/stems/{s.channel}",
                    "download": f"/api/jobs/{self.id}/stems/{s.channel}?download=1",
                    "waveform": s.waveform,
                }
                for s in self.stems
            ],
        }


_JOBS: dict[str, Job] = {}
_LOCK = threading.Lock()


def create_job(src_path: Path, source_name: str, mode: str, out_format: str) -> Job:
    job = Job(id=uuid.uuid4().hex[:12], source_name=source_name, mode=mode, out_format=out_format)
    with _LOCK:
        _JOBS[job.id] = job
    threading.Thread(target=_run, args=(job, src_path), daemon=True).start()
    return job


def get_job(job_id: str) -> Job | None:
    return _JOBS.get(job_id)


def stem_path(job_id: str, channel: str) -> Path | None:
    job = _JOBS.get(job_id)
    if not job:
        return None
    for s in job.stems:
        if s.channel == channel:
            return config.OUTPUT_DIR / job_id / s.filename
    return None


def _run(job: Job, src_path: Path) -> None:
    out_dir = config.OUTPUT_DIR / job.id
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        def prog(p: float, stage: str, base: float, span: float) -> None:
            job.progress = base + span * p
            job.stage = stage

        job.status = "decoding"
        job.stage = "Decodificando áudio…"
        job.progress = 0.02
        mix = audio.decode_to_array(src_path)
        job.duration = mix.shape[0] / config.TARGET_SAMPLE_RATE

        job.status = "separating"
        stems = _ENGINE.separate(
            mix, job.mode,
            progress=lambda p, s: prog(p, s, base=0.05, span=0.7),
        )

        job.status = "encoding"
        channels = config.STEM_MODES[job.mode]["channels"]
        ordered = [c for c in channels if c in stems]
        for i, channel in enumerate(ordered):
            job.stage = f"Exportando {config.STEM_META.get(channel, {}).get('label', channel)}…"
            job.progress = 0.78 + 0.2 * (i / max(1, len(ordered)))
            data = stems[channel]
            dst = audio.encode_array(data, out_dir / channel, job.out_format)
            job.stems.append(Stem(
                channel=channel,
                filename=dst.name,
                waveform=audio.peak_waveform(data),
            ))

        job.status = "done"
        job.progress = 1.0
        job.stage = "Concluído"
    except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
        job.status = "error"
        job.error = str(exc)
        job.stage = "Erro"
        traceback.print_exc()
    finally:
        try:
            src_path.unlink(missing_ok=True)
        except Exception:
            pass


def cleanup_old(max_age_seconds: int = 3600) -> None:
    """Drop jobs (and their files) older than *max_age_seconds*."""
    now = time.time()
    with _LOCK:
        stale = [j for j in _JOBS.values() if now - j.created > max_age_seconds]
        for job in stale:
            _JOBS.pop(job.id, None)
            shutil.rmtree(config.OUTPUT_DIR / job.id, ignore_errors=True)
