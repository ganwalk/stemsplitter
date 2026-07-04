/* ============================================================
   StemSplitter — client-side configuration
   JS port of the modes/metadata that used to live in backend/config.py.
   Everything here is static: no server, no /api/config call.
   ============================================================ */

// The DSP engine (dsp.js) only ever produces 4 fundamental bands:
// vocals, bass, drums, residual (everything else). Each mode blends
// those bands — with weights that always sum to 1 per band, so energy
// is conserved and nothing is silently doubled or lost — into the
// channels shown on the console.
export const STEM_MODES = {
  "2stems": {
    label: "Karaokê",
    channels: [
      { key: "vocals", label: "Vocais", bands: [["vocals", 1]] },
      { key: "accompaniment", label: "Instrumental", bands: [["bass", 1], ["drums", 1], ["residual", 1]] },
    ],
  },
  "4stems": {
    label: "Padrão",
    channels: [
      { key: "vocals", bands: [["vocals", 1]] },
      { key: "drums", bands: [["drums", 1]] },
      { key: "bass", bands: [["bass", 1]] },
      { key: "other", bands: [["residual", 1]] },
    ],
  },
  "5stems": {
    label: "Instrumentos",
    channels: [
      { key: "vocals", bands: [["vocals", 1]] },
      { key: "drums", bands: [["drums", 1]] },
      { key: "bass", bands: [["bass", 1]] },
      { key: "piano", bands: [["residual", 0.5]] },
      { key: "other", bands: [["residual", 0.5]] },
    ],
  },
  "6stems": {
    label: "Estúdio",
    channels: [
      { key: "vocals", bands: [["vocals", 1]] },
      { key: "drums", bands: [["drums", 1]] },
      { key: "bass", bands: [["bass", 1]] },
      { key: "guitar", bands: [["residual", 1 / 3]] },
      { key: "piano", bands: [["residual", 1 / 3]] },
      { key: "other", bands: [["residual", 1 / 3]] },
    ],
  },
};
export const DEFAULT_STEM_MODE = "5stems";

export const STEM_META = {
  vocals:        { label: "Vocais",       icon: "mic",    accent: "#e8503a" },
  drums:         { label: "Bateria",      icon: "drum",   accent: "#e0a52e" },
  bass:          { label: "Baixo",        icon: "bass",   accent: "#3a7de8" },
  guitar:        { label: "Guitarra",     icon: "guitar", accent: "#2eb872" },
  piano:         { label: "Piano",        icon: "piano",  accent: "#9b6ee8" },
  other:         { label: "Outros",       icon: "wave",   accent: "#8a94a6" },
  accompaniment: { label: "Instrumental", icon: "wave",   accent: "#8a94a6" },
};

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB, mirrors the old server guard rail
