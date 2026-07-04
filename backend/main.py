"""FastAPI application: REST API + static skeuomorphic frontend.

Run with:  uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config, jobs, separator

app = FastAPI(title="StemSplitter", version=__version__)

_engine = separator.get_engine()


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/config")
def get_config() -> dict:
    """Everything the frontend needs to render controls."""
    return {
        "modes": {
            key: {
                "label": m["label"],
                "channels": m["channels"],
                "count": len(m["channels"]),
            }
            for key, m in config.STEM_MODES.items()
        },
        "default_mode": config.DEFAULT_STEM_MODE,
        "output_formats": {k: v["label"] for k, v in config.OUTPUT_FORMATS.items()},
        "default_format": config.DEFAULT_OUTPUT_FORMAT,
        "accepted_extensions": config.ACCEPTED_INPUT_EXTENSIONS,
        "max_bytes": config.MAX_UPLOAD_BYTES,
        "stem_meta": config.STEM_META,
        "engine": {"name": _engine.name, "quality": _engine.quality},
    }


@app.post("/api/separate")
async def separate(
    file: UploadFile = File(...),
    mode: str = Form(config.DEFAULT_STEM_MODE),
    out_format: str = Form(config.DEFAULT_OUTPUT_FORMAT),
) -> JSONResponse:
    if mode not in config.STEM_MODES:
        raise HTTPException(400, f"Modo inválido: {mode}")
    if out_format not in config.OUTPUT_FORMATS:
        raise HTTPException(400, f"Formato inválido: {out_format}")

    jobs.cleanup_old()

    suffix = Path(file.filename or "audio").suffix or ".bin"
    dst = config.UPLOAD_DIR / f"{Path(file.filename or 'audio').stem}_{id(file)}{suffix}"
    size = 0
    with dst.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > config.MAX_UPLOAD_BYTES:
                fh.close()
                dst.unlink(missing_ok=True)
                raise HTTPException(413, "Arquivo maior que o limite permitido.")
            fh.write(chunk)
    if size == 0:
        dst.unlink(missing_ok=True)
        raise HTTPException(400, "Arquivo vazio.")

    job = jobs.create_job(dst, file.filename or "audio", mode, out_format)
    return JSONResponse(job.public(), status_code=202)


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado.")
    return job.public()


@app.get("/api/jobs/{job_id}/stems/{channel}")
def get_stem(job_id: str, channel: str, download: int = 0):
    path = jobs.stem_path(job_id, channel)
    if not path or not path.exists():
        raise HTTPException(404, "Faixa não encontrada.")
    label = config.STEM_META.get(channel, {}).get("label", channel)
    filename = f"{label}{path.suffix}"
    return FileResponse(
        path,
        media_type="application/octet-stream" if download else None,
        filename=filename if download else None,
    )


@app.get("/api/jobs/{job_id}/download")
def download_zip(job_id: str):
    job = jobs.get_job(job_id)
    if not job or job.status != "done":
        raise HTTPException(404, "Job não finalizado.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for stem in job.stems:
            p = jobs.stem_path(job_id, stem.channel)
            if p and p.exists():
                label = config.STEM_META.get(stem.channel, {}).get("label", stem.channel)
                zf.write(p, arcname=f"{label}{p.suffix}")
    buf.seek(0)
    stem_name = Path(job.source_name).stem
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{stem_name}_stems.zip"'},
    )


# ---------------------------------------------------------------------------
# Static frontend (mounted last so /api takes priority)
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((config.FRONTEND_DIR / "index.html").read_text(encoding="utf-8"))


app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR)), name="frontend")
