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

## 🚀 Como rodar

```bash
pip install -r requirements.txt

# (opcional) separação neural de qualidade de estúdio:
pip install demucs torch torchaudio

uvicorn backend.main:app --port 8000
```

Abra **http://localhost:8000**, arraste um áudio, escolha o número de faixas e o
formato de saída, e pressione **SEPARAR**.

> Sem `demucs`+`torch`, o app roda no motor **DSP de prévia** embutido: todo o fluxo,
> a mesa, a reprodução e os downloads funcionam — a qualidade da separação é menor e o
> selo no cabeçalho mostra `PREVIEW · DSP`.

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
