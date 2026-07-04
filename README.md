<h1 align="center">🎛️ StemSplitter</h1>
<p align="center"><i>Separe áudio em faixas individuais por instrumento — direto no navegador, numa mesa de mixagem skeuomórfica.</i></p>

---

**StemSplitter** é um web app **100% estático** que roda inteiramente no seu
navegador: nenhum áudio é enviado a servidor algum. Ele decodifica o arquivo,
separa em até **6 faixas por instrumento** — o modo principal entrega **5
faixas**: **vocais, bateria, baixo, piano e outros** — e abre tudo numa **mesa
de separação analógica** onde cada instrumento vira um _channel strip_ ao
vivo: fader físico, VU meter, mute/solo, reprodução multitrack e download
individual ou em `.zip`.

## ✨ Recursos

- 🔒 **100% local** — todo o processamento acontece no seu navegador via Web Audio API; nenhum upload, nenhum servidor.
- 🎚️ **2 / 4 / 5 / 6 faixas** selecionáveis (karaokê → estúdio completo).
- 🪵 **Visual skeuomórfico** — chassi de madeira, alumínio escovado, parafusos, faders reais, VU meters segmentados, LEDs. CSS puro, sem imagens.
- 🔊 **Mixer ao vivo** via Web Audio API: solo, mute, nível por faixa, transporte play/stop.
- ⬇️ **Exportação em WAV** de cada faixa individualmente ou de todas em um `.zip`.
- 🌐 **Hospedável de graça no GitHub Pages** — é só HTML/CSS/JS estático.

## 🚀 Como rodar

Não há dependências para instalar. Sirva a pasta `frontend/` com qualquer
servidor estático (não abra `index.html` direto como `file://` — módulos ES
exigem `http://`):

```bash
cd frontend
python3 -m http.server 8000
# ou: npx serve .
```

Abra **http://localhost:8000**, arraste um áudio, escolha o número de faixas
e pressione **SEPARAR**.

## ⚠️ Sobre a qualidade da separação

A separação roda com heurísticas de DSP (decomposição mid/side + filtros de
frequência) — **não** é um modelo neural. É uma separação de "prévia": útil
para karaokê, referência e prototipagem, mas não tem a qualidade de
ferramentas baseadas em redes neurais (como Demucs), que exigem um backend com
Python/PyTorch e não rodam de graça num navegador ou no GitHub Pages.

Os formatos de entrada aceitos dependem do que o **seu navegador** consegue
decodificar via `decodeAudioData` — mp3, wav, ogg, m4a/aac e flac costumam
funcionar em Chrome e Firefox.

## 🏗️ Arquitetura

```
Navegador
  decodeAudioData() → separação em DSP (js/dsp.js) → mixer Web Audio ao vivo → download (WAV/ZIP)
```

Sem banco de dados, sem build, sem backend. Detalhes completos em
[`CLAUDE.md`](./CLAUDE.md).

## 📦 Deploy no GitHub Pages

Já vem configurado: `.github/workflows/pages.yml` publica o conteúdo de
`frontend/` a cada push em `main`. Para ativar num repositório:

**Settings → Pages → Source: GitHub Actions**

## 📁 Estrutura

```
frontend/
  index.html        estrutura da mesa
  css/console.css    todo o visual skeuomórfico
  js/config.js       modos de separação + metadados por faixa
  js/dsp.js          motor de separação (DSP, roda no navegador)
  js/wav.js          encoder WAV
  js/zip.js          empacotador ZIP (sem compressão)
  js/app.js          orquestração: upload, mixer, transporte, download
.github/workflows/pages.yml   deploy automático no GitHub Pages
CLAUDE.md            documentação de arquitetura para desenvolvimento
```
