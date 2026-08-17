/* ============================================================
   StemSplitter — console logic
   Upload → separate (polled job) → live multitrack mixer (Web Audio API)
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

const ICONS = { mic: "🎤", drum: "🥁", bass: "🎸", guitar: "🎸", piano: "🎹", wave: "〰️" };

const state = {
  cfg: null,
  file: null,
  mode: null,
  format: "wav",
  formatKeys: [],
  job: null,
  poll: null,
  // audio
  ctx: null,
  master: null,
  masterAnalyser: null,
  tracks: [],        // {channel, gain, analyser, buffer, source, muted, solo, faderEl, vuEl, waveCanvas, meta}
  playing: false,
  startedAt: 0,
  offset: 0,
  raf: null,
};

/* ============================================================
   BOOT
   ============================================================ */
async function boot() {
  const cfg = await (await fetch("/api/config")).json();
  state.cfg = cfg;
  state.mode = cfg.default_mode;
  state.format = cfg.default_format;
  state.formatKeys = Object.keys(cfg.output_formats);

  renderEngine(cfg.engine);
  renderModeBank(cfg.modes, cfg.default_mode);
  renderFormatKnob(cfg.output_formats, cfg.default_format);
  wireDropzone();
  wireTransport();
  drawMasterVu(); // idle animation
}

function renderEngine(engine) {
  const badge = $("#engineBadge");
  $("#engineName").textContent = engine.name === "demucs" ? "DEMUCS · STUDIO" : "PREVIEW · DSP";
  badge.classList.toggle("preview", engine.quality !== "studio");
  badge.title = engine.quality === "studio"
    ? "Motor neural Demucs — qualidade de estúdio"
    : "Motor DSP embutido — qualidade de prévia (instale demucs+torch para estúdio)";
}

function renderModeBank(modes, active) {
  const bank = $("#modeBank");
  bank.innerHTML = "";
  Object.entries(modes).forEach(([key, m]) => {
    const b = el("button", "mode-btn");
    if (key === active) b.classList.add("active");
    b.innerHTML = `${m.count}<small>${m.label}</small>`;
    b.onclick = () => {
      state.mode = key;
      [...bank.children].forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
    };
    bank.appendChild(b);
  });
}

function renderFormatKnob(formats, active) {
  const keys = Object.keys(formats);
  const ticks = $("#formatTicks");
  ticks.innerHTML = "";
  keys.forEach((_, i) => {
    const t = el("span");
    const ang = -135 + (270 / (keys.length - 1)) * i;
    t.style.transform = `translate(-50%,-50%) rotate(${ang}deg)`;
    ticks.appendChild(t);
  });
  const knob = $("#formatKnob");
  const setFormat = (idx) => {
    idx = Math.max(0, Math.min(keys.length - 1, idx));
    state.format = keys[idx];
    const ang = -135 + (270 / (keys.length - 1)) * idx;
    knob.querySelector(".knob-dial").style.transform = `rotate(${ang}deg)`;
    $("#formatReadout").textContent = keys[idx].toUpperCase();
  };
  setFormat(keys.indexOf(active));
  let idx = keys.indexOf(active);
  knob.addEventListener("click", () => { idx = (idx + 1) % keys.length; setFormat(idx); });
  knob.addEventListener("wheel", (e) => {
    e.preventDefault(); idx += e.deltaY > 0 ? 1 : -1;
    idx = (idx + keys.length) % keys.length; setFormat(idx);
  }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { idx = (idx + 1) % keys.length; setFormat(idx); }
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") { idx = (idx - 1 + keys.length) % keys.length; setFormat(idx); }
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
  const max = state.cfg.max_bytes;
  if (file.size > max) {
    return flashDeck(`Arquivo muito grande (máx ${(max / 1048576) | 0} MB)`, true);
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
   SEPARATION JOB
   ============================================================ */
function wireTransport() {
  $("#startBtn").onclick = startSeparation;
  $("#playBtn").onclick = togglePlay;
  $("#stopBtn").onclick = stopPlayback;
  $("#dlAllBtn").onclick = () => state.job && (location.href = `/api/jobs/${state.job.id}/download`);
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
  setProgress(0.01, "Enviando…");

  const fd = new FormData();
  fd.append("file", state.file);
  fd.append("mode", state.mode);
  fd.append("out_format", state.format);

  let res;
  try {
    res = await fetch("/api/separate", { method: "POST", body: fd });
  } catch (e) {
    return failJob("Falha de rede ao enviar.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "erro" }));
    return failJob(err.detail || "Falha ao iniciar.");
  }
  state.job = await res.json();
  pollJob();
}

function pollJob() {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    const r = await fetch(`/api/jobs/${state.job.id}`);
    if (!r.ok) return;
    const job = await r.json();
    state.job = job;
    setProgress(job.progress, job.stage);
    if (job.status === "done") { clearInterval(state.poll); finishJob(job); }
    if (job.status === "error") { clearInterval(state.poll); failJob(job.error || "Erro na separação."); }
  }, 500);
}

function setProgress(p, stage) {
  $("#progFill").style.width = `${Math.round(p * 100)}%`;
  $("#progStage").textContent = stage || "";
  $("#progPct").textContent = `${Math.round(p * 100)}%`;
}

function failJob(msg) {
  clearInterval(state.poll);
  const btn = $("#startBtn");
  btn.classList.remove("busy"); btn.disabled = false;
  $("#reelL").classList.remove("spin"); $("#reelR").classList.remove("spin");
  $("#progFill").classList.add("err");
  $("#progStage").textContent = `⚠ ${msg}`;
}

async function finishJob(job) {
  const btn = $("#startBtn");
  btn.classList.remove("busy"); btn.disabled = false;
  $("#reelL").classList.remove("spin"); $("#reelR").classList.remove("spin");
  $("#footInfo").textContent = `${job.source_name} — ${job.stems.length} faixas · ${job.engine}`;
  await buildMixer(job);
}

/* ============================================================
   MIXER (Web Audio)
   ============================================================ */
async function buildMixer(job) {
  const strips = $("#strips");
  strips.innerHTML = "";
  state.tracks = [];

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  state.ctx = new AudioCtx();
  state.master = state.ctx.createGain();
  state.master.gain.value = ($("#masterFader").value / 100) ** 1.5;
  state.masterAnalyser = state.ctx.createAnalyser();
  state.masterAnalyser.fftSize = 256;
  state.master.connect(state.masterAnalyser);
  state.masterAnalyser.connect(state.ctx.destination);

  for (const s of job.stems) {
    const track = buildStrip(s);
    strips.appendChild(track.stripEl);
    state.tracks.push(track);
  }

  $("#masterStrip").hidden = false;
  // decode buffers in parallel
  await Promise.all(state.tracks.map((t) => loadBuffer(t)));
  applyRouting();
  animate();
}

function buildStrip(stem) {
  const meta = stem.meta || {};
  const accent = meta.accent || "#888";
  const strip = el("div", "strip");
  strip.style.setProperty("--accent", accent);

  const plate = el("div", "strip-plate");
  plate.textContent = meta.label || stem.channel;
  const icon = el("div", "strip-icon");
  icon.textContent = ICONS[meta.icon] || "〰️";

  const wave = el("canvas", "strip-wave");
  wave.width = 120; wave.height = 46;

  const vu = el("div", "vu-vert");
  const vuFill = el("div", "vu-vert-fill"); vuFill.style.background =
    `linear-gradient(0deg, ${accent} 0%, #58f08a 60%, #ffb43a 82%, #ff5a4d 100%)`;
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
  dl.onclick = () => (location.href = stem.download);

  strip.append(plate, icon, wave, vu, faderWrap, btns, dl);

  const track = {
    channel: stem.channel, meta, url: stem.url, waveform: stem.waveform,
    gain: null, analyser: null, buffer: null, source: null,
    muted: false, solo: false, faderEl: fader, vuEl: vuFill, waveCanvas: wave,
    stripEl: strip,
  };

  fader.oninput = () => { setTrackGain(track); };
  muteBtn.onclick = () => { track.muted = !track.muted; muteBtn.classList.toggle("on", track.muted); applyRouting(); };
  soloBtn.onclick = () => { track.solo = !track.solo; soloBtn.classList.toggle("on", track.solo); applyRouting(); };

  drawWaveform(wave, stem.waveform, accent);
  return track;
}

async function loadBuffer(track) {
  const arr = await (await fetch(track.url)).arrayBuffer();
  track.buffer = await state.ctx.decodeAudioData(arr);
  track.gain = state.ctx.createGain();
  track.analyser = state.ctx.createAnalyser();
  track.analyser.fftSize = 256;
  track.gain.connect(track.analyser);
  track.analyser.connect(state.master);
  setTrackGain(track);
}

function setTrackGain(track) {
  if (!track.gain) return;
  const v = (track.faderEl.value / 100) ** 1.5;
  track.gain.gain.value = track.audible ? v : v; // base value; routing decides on/off
  applyRouting();
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
    // per-track VU
    state.tracks.forEach((t) => {
      if (!t.analyser) return;
      t.vuEl.style.height = `${rms(t.analyser) * 140}%`;
    });
    drawMasterVu();

    if (state.playing) {
      const pos = state.offset + (state.ctx.currentTime - state.startedAt);
      const dur = maxDuration();
      if (pos >= dur) { stopPlayback(); }
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

/* master VU (segmented bars on canvas) */
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

boot().catch((e) => console.error("boot failed", e));
