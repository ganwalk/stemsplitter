# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

**StemSplitter** separates an audio file into up to **6 individual instrument
tracks** (the hero mode is **5 stems**: vocals, drums, bass, piano, other),
presented in a **skeuomorphic analog mixing console** where each stem is a live
channel strip you can solo, mute, level, play back, and download.

It is a **100% static, client-side web app** — plain HTML/CSS/JS, no build
step, no backend, no server-side processing. Everything (decoding, separation,
mixing, encoding) runs inside the visitor's own browser tab via the Web Audio
API. This is what makes it deployable on GitHub Pages: there is nothing to run
server-side.

## Architecture

```
Browser
  File input/drag-drop
        │
        ▼
  AudioContext.decodeAudioData()   — native browser decode (js/app.js)
        │
        ▼
  dsp.js  separate()               — mid/side + one-pole filter DSP, in JS
        │
        ▼
  Web Audio mixer (js/app.js)      — GainNode+AnalyserNode per stem, live playback
        │
        ▼
  wav.js encodeWav() / zip.js makeZip()  — on-demand download
```

There is **no server component**. Older revisions of this project used a
FastAPI backend + Demucs/ffmpeg for studio-quality neural separation; that was
removed so the whole app could ship as static files on GitHub Pages. If you
ever want to bring real neural separation back, it has to happen either via an
in-browser ONNX model (onnxruntime-web) or by reintroducing a server — both are
significant undertakings, not a small patch.

### Files (`frontend/`)
| File | Responsibility |
|------|----------------|
| `index.html` | Console markup: tape-deck loader, mode switch bank, transport, channel-strip container, master strip. |
| `css/console.css` | **All the skeuomorphism.** Wood chassis, brushed-metal faces, corner screws, physical faders, segmented VU meters, LED buttons — pure CSS gradients/shadows, no image assets. |
| `js/config.js` | Single source of truth: `STEM_MODES` (2/4/5/6-stem definitions, each channel described as a weighted blend of DSP bands) and `STEM_META` (per-channel label/icon/accent for the UI). |
| `js/dsp.js` | The separation engine. Decomposes stereo audio into 4 fundamental bands — `vocals`, `bass`, `drums`, `residual` — via mid/side decomposition and one-pole low/high-pass filters, then blends those bands per `STEM_MODES` into the channels shown on the console. Async and yields a frame between stages so the tab doesn't freeze. |
| `js/wav.js` | Encodes a `{L, R}` Float32 stereo pair into a 16-bit PCM WAV `Blob` — used for both individual stem downloads and the ZIP bundle. |
| `js/zip.js` | Minimal STORE-method (uncompressed) ZIP writer with real CRC-32 checksums, used by the "⤓ ZIP" master-strip button. No compression library needed since PCM audio doesn't compress well anyway. |
| `js/app.js` | Orchestrates everything: upload/drag-drop, mode selection, decode → separate → build mixer, then a live Web Audio mixer (fader→gain, mute/solo routing, transport with sample-accurate offset, animated VU meters, waveform canvases) and download wiring. |

## Separation modes (`js/config.js` → `STEM_MODES`)

The DSP engine only ever produces 4 real bands. Each mode is just a set of
channels, where each channel is a **weighted sum of bands that always sums to
1 per band** — this matters: an earlier version of this grouping (when it
lived in a Python backend) double-counted the residual band for the 5-stem
mode's "other" channel because "other" and "guitar" both aliased the full
residual signal. The current `bands: [[name, weight], ...]` shape makes that
class of bug structurally impossible — weights are explicit and reviewable
per channel.

| Mode | Channels |
|------|----------|
| `2stems` | vocals, accompaniment (= bass + drums + residual) |
| `4stems` | vocals, drums, bass, other (= residual) |
| **`5stems`** (default) | vocals, drums, bass, piano (= residual × 0.5), other (= residual × 0.5) |
| `6stems` | vocals, drums, bass, guitar/piano/other (= residual × ⅓ each) |

Because the DSP can't actually distinguish piano from guitar from generic
"other" — it only has 4 real bands — `piano`, `guitar`, and `other` are always
an even split of the same residual signal. This is a **preview-quality**
separation (frequency/stereo-field heuristics), not a neural model. Don't
oversell it in UI copy.

## Running it

There's nothing to install. Any static file server works:

```bash
cd frontend
python3 -m http.server 8000
# or: npx serve .
# open http://localhost:8000
```

Don't open `index.html` via `file://` directly — ES module imports
(`<script type="module">`) are blocked by CORS under the `file:` protocol in
most browsers. Always serve it over `http://`.

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` builds nothing — it just uploads the `frontend/`
directory as a Pages artifact on every push to `main` and deploys it. To
enable it on a repo: **Settings → Pages → Source: GitHub Actions**. No other
config needed.

## Conventions & gotchas
- **UI language is Portuguese (pt-BR)** — labels, stages, tooltips. Keep it consistent.
- Format support depends entirely on **what the visitor's browser can decode**
  via `decodeAudioData` — typically mp3/wav/ogg/m4a·aac/flac in Chrome and
  Firefox. Don't claim "any format" in copy; say "conforme suportado pelo
  navegador".
- `index.html` uses **relative** asset paths (`./css/...`, `./js/...`) on
  purpose — GitHub Pages project sites serve from a subpath
  (`user.github.io/repo/`), and absolute paths (`/css/...`) would 404 there.
  Don't "fix" these back to absolute paths.
- Output format is **WAV only**. There's no in-browser MP3/FLAC encoder here;
  don't add a fake format selector that doesn't do anything.
- When adding a stem type: add it to `STEM_META` (label/icon/accent) **and**
  give it a `bands` weighting in the relevant mode. Keep per-band weights
  summing to 1 across all channels that draw from that band, or you'll
  reintroduce the energy-doubling bug described above.
- No bundler — the frontend is dependency-free vanilla ES modules. Edit and reload.
- Everything happens in the tab; **no audio ever leaves the visitor's browser**
  — worth keeping true, it's a real privacy property of this design.

## Testing
No test suite (there's no backend to unit-test and the DSP is deterministic
numeric code best checked by ear/waveform). To sanity-check changes:
1. Serve `frontend/` locally (see above).
2. Open devtools console — it should stay silent through a full upload → separate
   → play/mute/solo → download cycle.
3. If you touch `dsp.js`, verify energy conservation: for any mode, the RMS of
   summed residual-derived stems (e.g. piano + other in `5stems`) should equal
   the RMS of a single undivided residual channel, not more.
