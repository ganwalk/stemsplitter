#!/usr/bin/env bash
# Convenience launcher for StemSplitter.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8000}"

if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "Installing core dependencies…"
  pip install -r requirements.txt
fi

echo "▶ StemSplitter em http://localhost:${PORT}"
exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port "${PORT}" "$@"
