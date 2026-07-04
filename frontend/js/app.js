/* ============================================================
   StemSplitter — console logic (100% client-side)
   Decode (Web Audio API) → separate (dsp.js, in-browser) → live
   multitrack mixer (Web Audio API) → download (wav.js / zip.js).
   No server involved: everything below runs entirely in the tab.
   ============================================================ */

import { STEM_MODES, STEM_META, DEFAULT_STEM_MODE, MAX_UPLOAD_BYTES } from "./config.js";
import { separate, peakWaveform } from "./dsp.js";
import { encodeWav } from "./wav.js";
import { makeZip } from "./zip.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

const ICONS = { mic: "🎤", drum: "🥁", bass: "🎸", guitar: "🎸", piano: "🎹", wave: "〰️" };

const state = {
  file: null,
  mode: DEFAULT_STEM_MODE,
  // audio
  ctx: null,
  master: null,
  masterAnalyser: null,
  tracks: [],        // {channel, meta, bandData:{L,R}, sampleRate, buffer, gain, analyser, muted, solo, faderEl, vuEl, stripEl}
  playing: false,
  startedAt: 0,
  offset: 0,
  raf: null,
};

/* ============================================================
   BOOT
   ============================================================ */
function boot() {
  renderModeBank(state.mode);
  wireDropzone();
  wireTransport();
  drawMasterVu(); // idle animation
}

function renderModeBank(active) {
  const bank = $("#modeBank");
  bank.innerHTML = "";
  Object.entries(STEM_MODES).forEach(([key, m]) => {
    const b = el("button", "mode-btn");
    if (key === active) b.classList.add("active");
    b.innerHTML = `${m.channels.length}<small>${m.label}</small>`;
    b.onclick = () => {
      state.mode = key;
      [...bank.children].forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
    };
    bank.appendChild(b);
  });
}

/* ============================================================
   UPLOAD
   ============================================================ */
function wireDropzone() {
  const dz = $("#dropzone");
  const input = $("#fileInput");
  dz.onclick = () => input.click();
  input.onchange = () => input.files[0] && loadFile(input.files[0]);
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
}

function loadFile(file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    return flashDeck(`Arquivo muito grande (máx ${(MAX_UPLOAD_BYTES / 1048576) | 0} MB)`, true);
  }
  state.file = file;
  const dz = $("#dropzone");
  dz.classList.add("loaded");
  $("#dzTitle").textContent = file.name;
  $("#dzSub").textContent = `${(file.size / 1048576).toFixed(1)} MB · pronto para separar`;
  $("#startBtn").disabled = false;
  $("#footInfo").textContent = file.name;
}

function flashDeck(msg, err) {
  $("#dzSub").textContent = msg;
  if (err) $("#dzSub").style.color = "var(--led-red)";
  setTimeout(() => { $("#dzSub").style.color = ""; }, 2600);
}

/* ============================================================
   SEPARATION (entirely in-browser)
   ============================================================ */
function wireTransport() {
  $("#startBtn").onclick = startSeparation;
  $("#playBtn").onclick = togglePlay;
  $("#stopBtn").onclick = stopPlayback;
  $("#dlAllBtn").onclick = downloadAllZip;
  $("#masterFader").oninput = (e) => {
    if (state.master) state.master.gain.value = (e.target.value / 100) ** 1.5;
  };
}

async function startSeparation() {
  if (!state.file) return;
  teardownAudio();
  const btn = $("#startBtn");
  btn.disabled = true; btn.classList.add("busy");
  $("#reelL").classList.add("spin"); $("#reelR").classList.add("spin");
  $("#progFill").classList.remove("err");
  setProgress(0.02, "Decodificando áudio…");

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  state.ctx = new AudioCtx();

  let audioBuffer;
  try {
    const arrayBuf = await state.file.arrayBuffer();
    audioBuffer = await state.ctx.decodeAudioData(arrayBuf);
  } catch (e) {
    return failJob("Não foi possível decodificar este arquivo. Formatos suportados dependem do navegador (mp3, wav, ogg, m4a/aac, flac costumam funcionar).");
  }

  let bands;
  try {
    bands = await separate(audioBuffer, state.mode, (p, label) => setProgress(0.05 + 0.8 * p, label));
  } catch (e) {
    return failJob(`Falha ao separar: ${e.message}`);
  }

  setProgress(0.92, "Montando a mesa…");
  await buildMixer(audioBuffer.sampleRate, bands);

  setProgress(1, "Concluído");
  btn.classList.remove("busy"); btn.disabled = false;
  $("#reelL").classList.remove("spin"); $("#reelR").classList.remove("spin");
  $("#footInfo").textContent = `${state.file.name} — ${state.tracks.length} faixas · DSP local`;
}

function setProgress(p, stage) {
  $("#progFill").style.width = `${Math.round(p * 100)}%`;
  $("#progStage").textContent = stage || "";
  $("#progPct").textContent = `${Math.round(p * 100)}%`;
}

function failJob(msg) {
  const btn = $("#startBtn");
  btn.classList.remove("busy"); btn.disabled = false;
  $("#reelL").classList.remove("spin"); $("#reelR").classList.remove("spin");
  $("#progFill").classList.add("err");
  $("#progStage").textContent = `⚠ ${msg}`;
}

/* ============================================================
   MIXER (Web Audio)
   ============================================================ */
async function buildMixer(sampleRate, bands) {
  const strips = $("#strips");
  strips.innerHTML = "";
  state.tracks = [];

  state.master = state.ctx.createGain();
  state.master.gain.value = ($("#masterFader").value / 100) ** 1.5;
  state.masterAnalyser = state.ctx.createAnalyser();
  state.masterAnalyser.fftSize = 256;
  state.master.connect(state.masterAnalyser);
  state.masterAnalyser.connect(state.ctx.destination);

  const spec = STEM_MODES[state.mode];
  for (const { key } of spec.channels) {
    const stereo = bands[key];
    if (!stereo) continue;
    const track = buildStrip(key, stereo, sampleRate);
    strips.appendChild(track.stripEl);
    state.tracks.push(track);
  }

  $("#masterStrip").hidden = false;
  applyRouting();
  animate();
}

function buildStrip(channel, stereo, sampleRate) {
  const meta = STEM_META[channel] || { label: channel, icon: "wave", accent: "#888" };
  const accent = meta.accent || "#888";
  const strip = el("div", "strip");
  strip.style.setProperty("--accent", accent);

  const plate = el("div", "strip-plate");
  plate.textContent = meta.label || channel;
  const icon = el("div", "strip-icon");
  icon.textContent = ICONS[meta.icon] || "〰️";

  const wave = el("canvas", "strip-wave");
  wave.width = 120; wave.height = 46;

  const vu = el("div", "vu-vert");
  const vuFill = el("div", "vu-vert-fill");
  vuFill.style.background = `linear-gradient(0deg, ${accent} 0%, #58f08a 60%, #ffb43a 82%, #ff5a4d 100%)`;
  vu.appendChild(vuFill);

  const faderWrap = el("div", "fader-track");
  const fader = el("input", "fader");
  fader.type = "range"; fader.min = 0; fader.max = 100; fader.value = 82;
  faderWrap.appendChild(fader);

  const btns = el("div", "strip-btns");
  const muteBtn = el("button", "led-btn mute");
  muteBtn.innerHTML = `<span class="led"></span>MUTE`;
  const soloBtn = el("button", "led-btn solo");
  soloBtn.innerHTML = `<span class="led"></span>SOLO`;
  btns.append(muteBtn, soloBtn);

  const dl = el("button", "strip-dl");
  dl.textContent = "⤓ BAIXAR";

  strip.append(plate, icon, wave, vu, faderWrap, btns, dl);

  const track = {
    channel, meta, bandData: stereo, sampleRate,
    gain: null, analyser: null, buffer: null, source: null, wavBlob: null,
    muted: false, solo: false, faderEl: fader, vuEl: vuFill, waveCanvas: wave,
    stripEl: strip,
  };

  fader.oninput = () => applyRouting();
  muteBtn.onclick = () => { track.muted = !track.muted; muteBtn.classList.toggle("on", track.muted); applyRouting(); };
  soloBtn.onclick = () => { track.solo = !track.solo; soloBtn.classList.toggle("on", track.solo); applyRouting(); };
  dl.onclick = async () => {
    dl.textContent = "…";
    const blob = await stemBlob(track);
    triggerDownload(blob, `${meta.label || channel}.wav`);
    dl.textContent = "⤓ BAIXAR";
  };

  drawWaveform(wave, peakWaveform(stereo), accent);

  track.buffer = makeAudioBuffer(state.ctx, stereo, sampleRate);
  track.gain = state.ctx.createGain();
  track.analyser = state.ctx.createAnalyser();
  track.analyser.fftSize = 256;
  track.gain.connect(track.analyser);
  track.analyser.connect(state.master);

  return track;
}

function makeAudioBuffer(ctx, { L, R }, sampleRate) {
  const buf = ctx.createBuffer(2, L.length, sampleRate);
  buf.copyToChannel(L, 0);
  buf.copyToChannel(R, 1);
  return buf;
}

async function stemBlob(track) {
  if (!track.wavBlob) track.wavBlob = encodeWav(track.bandData, track.sampleRate);
  return track.wavBlob;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function downloadAllZip() {
  if (!state.tracks.length) return;
  const btn = $("#dlAllBtn");
  const original = btn.textContent;
  btn.textContent = "⤓ …"; btn.disabled = true;
  try {
    const entries = [];
    for (const t of state.tracks) {
      entries.push({ name: `${t.meta.label || t.channel}.wav`, blob: await stemBlob(t) });
    }
    const zip = await makeZip(entries);
    const base = (state.file?.name || "audio").replace(/\.[^.]+$/, "");
    triggerDownload(zip, `${base}_stems.zip`);
  } finally {
    btn.textContent = original; btn.disabled = false;
  }
}

function applyRouting() {
  const anySolo = state.tracks.some((t) => t.solo);
  state.tracks.forEach((t) => {
    if (!t.gain) return;
    const base = (t.faderEl.value / 100) ** 1.5;
    const audible = !t.muted && (!anySolo || t.solo);
    t.gain.gain.value = audible ? base : 0.0001;
  });
}

/* ============================================================
   TRANSPORT
   ============================================================ */
function togglePlay() {
  if (!state.ctx) return;
  if (state.ctx.state === "suspended") state.ctx.resume();
  state.playing ? pausePlayback() : startPlayback();
}

function startPlayback() {
  const dur = maxDuration();
  if (state.offset >= dur - 0.05) state.offset = 0;
  state.tracks.forEach((t) => {
    if (!t.buffer) return;
    const src = state.ctx.createBufferSource();
    src.buffer = t.buffer;
    src.connect(t.gain);
    src.start(0, state.offset);
    t.source = src;
  });
  state.startedAt = state.ctx.currentTime;
  state.playing = true;
  $("#playBtn").classList.add("on"); $("#playBtn").textContent = "❚❚";
}

function pausePlayback() {
  state.offset += state.ctx.currentTime - state.startedAt;
  stopSources();
  state.playing = false;
  $("#playBtn").classList.remove("on"); $("#playBtn").textContent = "▶";
}

function stopPlayback() {
  stopSources();
  state.offset = 0; state.playing = false;
  $("#playBtn").classList.remove("on"); $("#playBtn").textContent = "▶";
  updateTime(0);
}

function stopSources() {
  state.tracks.forEach((t) => { if (t.source) { try { t.source.stop(); } catch (e) {} t.source = null; } });
}

function maxDuration() {
  return Math.max(0.01, ...state.tracks.map((t) => (t.buffer ? t.buffer.duration : 0)));
}

/* ============================================================
   RENDER LOOP — VU meters + transport time
   ============================================================ */
function animate() {
  cancelAnimationFrame(state.raf);
  const loop = () => {
    state.tracks.forEach((t) => {
      if (!t.analyser) return;
      t.vuEl.style.height = `${rms(t.analyser) * 140}%`;
    });
    drawMasterVu();

    if (state.playing) {
      const pos = state.offset + (state.ctx.currentTime - state.startedAt);
      const dur = maxDuration();
      if (pos >= dur) stopPlayback();
      else updateTime(pos);
    }
    state.raf = requestAnimationFrame(loop);
  };
  loop();
}

function rms(analyser) {
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(sum / buf.length) / 140);
}

function updateTime(pos) {
  const dur = maxDuration();
  $("#footTime").textContent = `${fmt(pos)} / ${fmt(dur)}`;
}
function fmt(s) {
  s = Math.max(0, s | 0);
  return `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function drawMasterVu() {
  const c = $("#masterVu"); const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  const level = state.masterAnalyser ? rms(state.masterAnalyser) : 0.04 + 0.02 * Math.sin(Date.now() / 400);
  const segs = 24, gap = 2, w = (c.width - (segs - 1) * gap) / segs;
  for (let i = 0; i < segs; i++) {
    const on = i / segs < level;
    const x = i * (w + gap);
    let col = "#1e3a2a";
    if (on) col = i / segs > 0.82 ? "#ff5a4d" : i / segs > 0.62 ? "#ffb43a" : "#58f08a";
    g.fillStyle = col;
    g.shadowBlur = on ? 6 : 0; g.shadowColor = col;
    g.fillRect(x, 6, w, c.height - 12);
  }
  g.shadowBlur = 0;
}

function drawWaveform(canvas, peaks, accent) {
  const g = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height, mid = h / 2;
  g.clearRect(0, 0, w, h);
  const n = peaks.length, bw = w / n;
  g.fillStyle = accent;
  for (let i = 0; i < n; i++) {
    const ph = Math.max(1, peaks[i] * (h - 4));
    g.globalAlpha = 0.35 + peaks[i] * 0.65;
    g.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.4), ph);
  }
  g.globalAlpha = 1;
}

/* ============================================================
   CLEANUP
   ============================================================ */
function teardownAudio() {
  cancelAnimationFrame(state.raf);
  stopSources();
  if (state.ctx) { state.ctx.close().catch(() => {}); }
  state.ctx = null; state.tracks = []; state.playing = false; state.offset = 0;
  $("#masterStrip").hidden = true;
  $("#strips").innerHTML = '<div class="empty-hint" id="emptyHint">Processando…</div>';
  $("#playBtn").classList.remove("on"); $("#playBtn").textContent = "▶";
}

boot();
