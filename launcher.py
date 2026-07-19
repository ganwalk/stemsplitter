"""Inicia o StemSplitter e abre o navegador automaticamente.

Usado pelos instaladores de um clique (Iniciar-StemSplitter.bat no Windows,
iniciar-stemsplitter.sh no Mac/Linux). Também pode ser chamado direto:

    python launcher.py
"""
from __future__ import annotations

import socket
import threading
import time
import webbrowser

import uvicorn


def free_port(start: int = 8000, end: int = 8020) -> int:
    """Return the first free localhost port in [start, end)."""
    for port in range(start, end):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start


def open_browser_when_ready(port: int) -> None:
    url = f"http://localhost:{port}"
    for _ in range(120):  # up to ~30s for the server to come up
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.25)
    webbrowser.open(url)


if __name__ == "__main__":
    port = free_port()
    print()
    print("  ============================================")
    print(f"   StemSplitter em  http://localhost:{port}")
    print("   (o navegador abre sozinho em instantes)")
    print("   Para encerrar: Ctrl+C ou feche esta janela")
    print("  ============================================")
    print()
    threading.Thread(target=open_browser_when_ready, args=(port,), daemon=True).start()
    uvicorn.run("backend.main:app", host="127.0.0.1", port=port, log_level="warning")
