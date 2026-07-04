#!/usr/bin/env bash
# SessionStart hook: make the repo immediately runnable/testable.
# Installs only the lightweight core deps (NOT torch/demucs, which are ~2 GB and
# optional). The app runs on its built-in DSP preview engine without them.
set -e
cd "$(dirname "$0")/.."

if python3 -c "import fastapi, soundfile, imageio_ffmpeg" 2>/dev/null; then
  echo "StemSplitter core deps present."
else
  echo "Installing StemSplitter core dependencies…"
  pip install -q -r requirements.txt || echo "warning: dependency install failed"
fi
