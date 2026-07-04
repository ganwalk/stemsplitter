/* ============================================================
   StemSplitter — minimal client-side WAV (PCM16) encoder
   Replaces the server-side soundfile.write() call for the "download" path.
   ============================================================ */

function floatTo16(sample) {
  const s = Math.max(-1, Math.min(1, sample));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

/** Encode a stereo {L,R} Float32Array pair into a 16-bit PCM WAV Blob. */
export function encodeWav({ L, R }, sampleRate) {
  const n = L.length;
  const numChannels = 2;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = n * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);           // fmt chunk size
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);           // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < n; i++) {
    view.setInt16(offset, floatTo16(L[i]), true); offset += 2;
    view.setInt16(offset, floatTo16(R[i]), true); offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}
