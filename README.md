<h1 align="center">🎛️ StemSplitter</h1>
<p align="center"><i>Separe qualquer áudio em faixas individuais por instrumento — numa mesa de mixagem skeuomórfica.</i></p>

---

**StemSplitter** é um web app que recebe **qualquer formato de áudio** (mp3, wav, flac,
m4a, ogg, opus, aac, wma, aiff… e até trilhas de vídeo) e o separa em até **6 faixas
distintas por instrumento** — o modo principal entrega **5 faixas**: **vocais, bateria,
baixo, piano e outros**.

O resultado abre numa **mesa de separação analógica** onde cada instrumento vira um
_channel strip_ ao vivo: fader físico, VU meter, mute/solo, reprodução multitrack e
download individual ou em `.zip`.

## ✨ Recursos

- 🎧 **Qualquer formato de entrada** — decodificado por um ffmpeg embutido (sem instalar nada no sistema).
- 🎚️ **2 / 4 / 5 / 6 faixas** selecionáveis (karaokê → estúdio completo).
- 🧠 **Separação neural** de qualidade de estúdio com [Demucs](https://github.com/facebookresearch/demucs) quando disponível; **fallback DSP** embutido para rodar em qualquer lugar sem dependências pesadas.
- 🪵 **Visual skeuomórfico** — chassi de madeira, alumínio escovado, parafusos, knobs e faders reais, VU meters segmentados, LEDs. CSS puro, sem imagens.
- 🔊 **Mixer ao vivo** via Web Audio API: solo, mute, nível por faixa, transporte play/stop.
- ⬇️ **Exportação** de cada faixa (wav/flac/mp3) ou de todas em um `.zip`.

## 🚀 Instalação em 1 clique

Só precisa ter o [Python](https://www.python.org/downloads/) instalado (no Windows,
marque **"Add Python to PATH"** durante a instalação dele).

Depois de baixar este projeto ([ZIP aqui](https://github.com/ganwalk/stemsplitter/archive/refs/heads/main.zip)
→ extraia a pasta), é um clique:

| Sistema | Faça isso |
|---|---|
| **Windows** | Dê **duplo clique** em `Iniciar-StemSplitter.bat` |
| **Mac / Linux** | Rode `./iniciar-stemsplitter.sh` no terminal (uma vez: `chmod +x iniciar-stemsplitter.sh`) |

Na **primeira execução** ele instala tudo sozinho (e pergunta se você quer a
qualidade de estúdio Demucs, ~2 GB — pode dizer não e instalar depois). Nas
seguintes, ele só liga o servidor. **O navegador abre sozinho** na mesa de mixagem.

Para encerrar: `Ctrl+C` (ou feche a janela do terminal).

<details>
<summary>Prefere instalar manualmente? (clique para expandir)</summary>

```bash
pip install -r requirements.txt

# (opcional) separação neural de qualidade de estúdio:
pip install demucs torch torchaudio

uvicorn backend.main:app --port 8000
# ou: ./run.sh
```

Abra **http://localhost:8000**.
</details>

Na mesa: arraste um áudio, escolha o número de faixas e o formato de saída, e
pressione **SEPARAR**.

> Sem `demucs`+`torch`, o app roda no motor **DSP de prévia** embutido: todo o fluxo,
> a mesa, a reprodução e os downloads funcionam — a qualidade da separação é menor e o
> selo no cabeçalho mostra `PREVIEW · DSP`.

Este app roda como um servidor (não é hospedável em GitHub Pages ou outro host
estático) — pense nele como algo para rodar na sua máquina, ou num servidor
próprio se quiser acesso remoto.

## 🏗️ Arquitetura

Processo único FastAPI que serve a API **e** o frontend estático — sem banco de dados,
sem build. Detalhes completos em [`CLAUDE.md`](./CLAUDE.md).

```
Navegador (mesa skeuomórfica + Web Audio API)
   → FastAPI (backend/main.py)
   → ffmpeg decode → motor de separação → encode
```

## 📁 Estrutura

```
backend/    FastAPI, motores de separação, I/O de áudio, jobs
frontend/   HTML + CSS skeuomórfico + JS (Web Audio API)
CLAUDE.md   documentação de arquitetura para desenvolvimento
```
