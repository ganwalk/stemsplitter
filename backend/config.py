"""Central configuration for the StemSplitter backend.

All tunables live here so the rest of the code stays declarative.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# --- Paths -----------------------------------------------------------------
# In a PyInstaller bundle, __file__ lives inside the unpacked bundle dir, so
# FRONTEND_DIR (bundled as data) still resolves correctly relative to it —
# but that dir is read-only/ephemeral, so job data must go to the system
# temp dir instead of BASE_DIR/data.
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
_FROZEN = getattr(sys, "frozen", False)
_DEFAULT_DATA = (Path(tempfile.gettempdir()) / "stemsplitter-data") if _FROZEN else (BASE_DIR / "data")
DATA_DIR = Path(os.environ.get("STEMSPLITTER_DATA", _DEFAULT_DATA))
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"

for _d in (UPLOAD_DIR, OUTPUT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --- Audio -----------------------------------------------------------------
# Everything is normalised to this before separation so any input format works.
TARGET_SAMPLE_RATE = 44100
TARGET_CHANNELS = 2

# Upload guard rails.
MAX_UPLOAD_BYTES = int(os.environ.get("STEMSPLITTER_MAX_BYTES", 200 * 1024 * 1024))  # 200 MB

# Formats we advertise as accepted (ffmpeg handles far more; this is just the UI hint).
ACCEPTED_INPUT_EXTENSIONS = [
    ".mp3", ".wav", ".flac", ".ogg", ".oga", ".m4a", ".aac",
    ".wma", ".aiff", ".aif", ".alac", ".opus", ".webm", ".mp4", ".mkv",
]

# Output containers the user can choose.
OUTPUT_FORMATS = {
    "wav": {"ext": "wav", "codec": "pcm_s16le", "label": "WAV · lossless"},
    "flac": {"ext": "flac", "codec": "flac", "label": "FLAC · lossless"},
    "mp3": {"ext": "mp3", "codec": "libmp3lame", "label": "MP3 · 320k"},
}
DEFAULT_OUTPUT_FORMAT = "wav"

# --- Separation modes ------------------------------------------------------
# Each mode maps to a neural model + a grouping of that model's raw sources
# into the channels shown on the mixing console.  "up to 5" is the hero mode.
#
# htdemucs raw sources    : drums, bass, other, vocals
# htdemucs_6s raw sources : drums, bass, other, vocals, guitar, piano
STEM_MODES = {
    "2stems": {
        "label": "Karaokê",
        "model": "htdemucs",
        "channels": ["vocals", "accompaniment"],
        "groups": {
            "vocals": ["vocals"],
            "accompaniment": ["drums", "bass", "other"],
        },
    },
    "4stems": {
        "label": "Padrão",
        "model": "htdemucs",
        "channels": ["vocals", "drums", "bass", "other"],
        "groups": {
            "vocals": ["vocals"],
            "drums": ["drums"],
            "bass": ["bass"],
            "other": ["other"],
        },
    },
    "5stems": {
        "label": "Instrumentos",
        "model": "htdemucs_6s",
        "channels": ["vocals", "drums", "bass", "piano", "other"],
        "groups": {
            "vocals": ["vocals"],
            "drums": ["drums"],
            "bass": ["bass"],
            "piano": ["piano"],
            "other": ["other", "guitar"],
        },
    },
    "6stems": {
        "label": "Estúdio",
        "model": "htdemucs_6s",
        "channels": ["vocals", "drums", "bass", "guitar", "piano", "other"],
        "groups": {
            "vocals": ["vocals"],
            "drums": ["drums"],
            "bass": ["bass"],
            "guitar": ["guitar"],
            "piano": ["piano"],
            "other": ["other"],
        },
    },
}
DEFAULT_STEM_MODE = "5stems"

# Cosmetic metadata used by the frontend to label & colour each channel strip.
STEM_META = {
    "vocals":        {"label": "Vocais",         "icon": "mic",     "accent": "#e8503a"},
    "drums":         {"label": "Bateria",        "icon": "drum",    "accent": "#e0a52e"},
    "bass":          {"label": "Baixo",          "icon": "bass",    "accent": "#3a7de8"},
    "guitar":        {"label": "Guitarra",       "icon": "guitar",  "accent": "#2eb872"},
    "piano":         {"label": "Piano",          "icon": "piano",   "accent": "#9b6ee8"},
    "other":         {"label": "Outros",         "icon": "wave",    "accent": "#8a94a6"},
    "accompaniment": {"label": "Instrumental",   "icon": "wave",    "accent": "#8a94a6"},
}
