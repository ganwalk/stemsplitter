#!/usr/bin/env bash
# Instalador + inicializador de um clique do StemSplitter (Mac/Linux).
# Na primeira execução instala tudo num ambiente virtual; depois só inicia.
set -e
cd "$(dirname "$0")"

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
if ! command -v "$PY" >/dev/null 2>&1; then
    echo
    echo "  Python não foi encontrado neste computador."
    echo "  Instale em: https://www.python.org/downloads/  e rode este script de novo."
    echo
    exit 1
fi

if [ ! -x "venv/bin/python" ]; then
    echo
    echo "  == Primeira execução: instalando o StemSplitter... =="
    echo "     (isso acontece só uma vez)"
    echo
    "$PY" -m venv venv
    venv/bin/python -m pip install --upgrade pip --quiet
    venv/bin/python -m pip install -r requirements.txt
    echo
    echo "  Instalação básica concluída!"
    echo
    read -r -p "  Instalar também a qualidade de estúdio (Demucs, ~2 GB)? [s/N] " RESP || RESP=""
    case "$RESP" in
        [sS]*) echo "  Baixando Demucs + PyTorch... isso pode demorar vários minutos."
               venv/bin/python -m pip install demucs torch torchaudio ;;
    esac
fi

exec venv/bin/python launcher.py
