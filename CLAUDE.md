# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

**StemSplitter** is a web app that takes *any* audio file and separates it into up
to **6 individual instrument tracks** (the hero mode is **5 stems**), presented in
a **skeuomorphic analog mixing console** where each stem is a live channel strip you
can solo, mute, level, play back, and download.

It is a single-process FastAPI app: the same server exposes the REST API **and**
serves the static frontend. No database, no build step, no external services.

## Architecture

```
Browser (skeuomorphic console, Web Audio API)
        │  fetch / multipart upload / polling
        ▼
FastAPI (backend/main.py)
        │  background thread per job (backend/jobs.py)
        ▼
ffmpeg decode → separation engine → ffmpeg/soundfile encode
(backend/audio.py)   (backend/separator.py)   (backend/audio.py)
```

### Backend (`backend/`)
| File | Responsibility |
|------|----------------|
| `config.py` | **Single source of truth.** Paths, audio params, upload limits, the `STEM_MODES` table (mode → model → channel grouping), output formats, and per-channel UI metadata (`STEM_META`). Change behaviour here first. |
| `audio.py` | All audio I/O. Decodes *any* input via a **bundled** ffmpeg (`imageio-ffmpeg`, no system install) into a normalised `(samples, 2)` float32 array; encodes stems to wav/flac/mp3; computes downsampled waveform peaks for the canvas. |
| `separator.py` | Pluggable separation engines returning `{channel: array}`. `DemucsEngine` (real, neural, "studio") is used automatically **if** `demucs`+`torch` are installed; otherwise `PreviewEngine` (pure-numpy DSP, "preview" quality) keeps the whole app working with zero heavy deps. `_group()` sums a model's raw sources into the console channels for the chosen mode. |
| `jobs.py` | In-memory job store. Each upload spawns a daemon thread: `decode → separate → encode`, updating `progress`/`stage` for the frontend to poll. Files live under `data/`. |
| `main.py` | FastAPI routes (`/api/*`) + static mount for `frontend/`. |

### Frontend (`frontend/`)
| File | Responsibility |
|------|----------------|
| `index.html` | Console markup: tape-deck loader, mode switch bank, format knob, transport, channel-strip container, master strip. |
| `css/console.css` | **All the skeuomorphism.** Wood chassis, brushed-metal faces, corner screws, rotary knob, physical faders, segmented VU meters, LED buttons — pure CSS gradients/shadows, no image assets. |
| `js/app.js` | Loads `/api/config`, drives upload + polling, then builds a live **Web Audio API** mixer: one `GainNode`+`AnalyserNode` per stem into a master bus, fader→gain, mute/solo routing, transport (play/pause/stop with sample-accurate offset), animated VU meters, waveform rendering, per-stem + ZIP download. |

## Separation modes (`config.STEM_MODES`)

| Mode | Model | Channels |
|------|-------|----------|
| `2stems` | htdemucs | vocals, accompaniment |
| `4stems` | htdemucs | vocals, drums, bass, other |
| **`5stems`** (default) | htdemucs_6s | vocals, drums, bass, piano, other |
| `6stems` | htdemucs_6s | vocals, drums, bass, guitar, piano, other |

`5stems` folds Demucs' `guitar` source into `other`, giving a clean, musical
five-track split (the taxonomy most people mean by "5 stems").

## Running it

```bash
pip install -r requirements.txt          # core: fastapi, ffmpeg-bundled, numpy…
# optional, unlocks studio-quality neural separation (~2 GB, downloads model weights):
pip install demucs torch torchaudio

uvicorn backend.main:app --reload --port 8000
# open http://localhost:8000
```

Without `demucs`+`torch` the app runs on the built-in DSP **preview** engine — the
full pipeline, console, playback and downloads all work; stem quality is lower and
the header badge shows `PREVIEW · DSP` (amber) instead of `DEMUCS · STUDIO` (green).

## Conventions & gotchas
- **UI language is Portuguese (pt-BR)** — labels, stages, tooltips. Keep it consistent.
- **`data/` is disposable** and git-ignored; `jobs.cleanup_old()` prunes runs > 1h.
- ffmpeg comes from the `imageio-ffmpeg` wheel — **do not** assume/require a system
  ffmpeg. Get the path via `audio.ffmpeg_exe()`.
- When adding a stem type: add it to `STEM_META` (label/icon/accent) **and** to the
  relevant mode's `groups` in `config.py`. The frontend renders whatever the API
  returns — no per-stem code changes needed.
- The frontend is dependency-free vanilla ES modules; there is **no bundler**. Edit
  and reload.
- Grouped/residual channels must not sum past full-scale — see the share-splitting in
  `PreviewEngine.separate` and the clip guard in `audio.encode_array`.

## Testing
Smoke-testable without the heavy ML stack:
```bash
uvicorn backend.main:app --port 8000 &
curl -F "file=@song.mp3" -F "mode=5stems" -F "out_format=wav" localhost:8000/api/separate
# → poll GET /api/jobs/<id> until status=done, then GET the stem URLs / /download (zip)
```
