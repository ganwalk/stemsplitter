@echo off
setlocal EnableDelayedExpansion
title StemSplitter
cd /d "%~dp0"

rem ---- localizar o Python ----
set "PY=python"
where py >nul 2>nul && set "PY=py -3"
%PY% --version >nul 2>nul
if errorlevel 1 (
    echo.
    echo  Python nao foi encontrado neste computador.
    echo  Baixe e instale em:  https://www.python.org/downloads/
    echo  IMPORTANTE: na instalacao, marque a opcao "Add Python to PATH".
    echo  Depois execute este arquivo novamente.
    echo.
    pause
    exit /b 1
)

rem ---- primeira execucao: instalar tudo ----
if not exist "venv\Scripts\python.exe" (
    echo.
    echo  == Primeira execucao: instalando o StemSplitter... ==
    echo     ^(isso acontece so uma vez^)
    echo.
    %PY% -m venv venv || goto :erro
    venv\Scripts\python.exe -m pip install --upgrade pip --quiet
    venv\Scripts\python.exe -m pip install -r requirements.txt || goto :erro
    echo.
    echo  Instalacao basica concluida!
    echo.
    set /p RESP="  Instalar tambem a qualidade de estudio (Demucs, ~2 GB)? [s/N] "
    if /i "!RESP!"=="s" (
        echo  Baixando Demucs + PyTorch... isso pode demorar varios minutos.
        venv\Scripts\python.exe -m pip install demucs torch torchaudio
    )
)

rem ---- iniciar (o navegador abre sozinho) ----
venv\Scripts\python.exe launcher.py
pause
exit /b 0

:erro
echo.
echo  Algo deu errado na instalacao. Verifique sua conexao e tente de novo.
pause
exit /b 1
