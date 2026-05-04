/**
 * Sarvam STT + TTS clients and audio-format conversion utilities.
 *
 * Used by the cascaded voice-agent path (Sarvam STT → Gemini text → Sarvam TTS)
 * which is an alternative to the Gemini Live native-audio agent.
 *
 * Audio format references:
 *   - Plivo bidirectional stream: mulaw (G.711 μ-law), 8 kHz, mono. Each
 *     base64-encoded chunk is typically 160 bytes = 20ms of audio.
 *   - Sarvam STT (saarika:v2): accepts WAV, 8 kHz mono linear PCM 16-bit
 *     works directly. Returns JSON {transcript: string, language_code: string}.
 *   - Sarvam TTS (bulbul:v3): with `speech_sample_rate: 8000` returns a
 *     base64-encoded WAV containing 8 kHz linear PCM 16-bit. We strip the
 *     44-byte header, encode to mulaw, base64 each 160-byte chunk, and ship
 *     to Plivo.
 *
 * This avoids any actual resampling (everything stays at 8 kHz) — the only
 * conversion is mulaw <-> linear PCM 16-bit.
 */

const SARVAM_BASE = "https://api.sarvam.ai";

// ─── G.711 μ-law (mulaw) <-> linear PCM 16-bit ──────────────────────

/** Decode one mulaw byte to a signed 16-bit linear PCM sample. */
export function mulawToLinear(mu: number): number {
  mu = ~mu & 0xff;
  const sign = (mu & 0x80) ? -1 : 1;
  const exponent = (mu & 0x70) >> 4;
  const mantissa = mu & 0x0f;
  let sample = (mantissa << (exponent + 3)) + (1 << (exponent + 7)) - 0x84;
  return sign * sample;
}

/** Encode one signed 16-bit linear PCM sample to a mulaw byte. */
export function linearToMulaw(s: number): number {
  const MAX = 32635;
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > MAX) s = MAX;
  s += 132;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Convert a base64 mulaw chunk (Plivo) → Int16 PCM samples. */
export function mulawBase64ToPcm16(base64Mulaw: string): Int16Array {
  const bin = atob(base64Mulaw);
  const out = new Int16Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = mulawToLinear(bin.charCodeAt(i));
  return out;
}

/** Convert Int16 PCM samples → base64-encoded mulaw bytes. */
export function pcm16ToMulawBase64(pcm: Int16Array): string {
  let bin = "";
  for (let i = 0; i < pcm.length; i++) bin += String.fromCharCode(linearToMulaw(pcm[i]));
  return btoa(bin);
}

// ─── WAV header helpers ─────────────────────────────────────────────

/** Build a 44-byte WAV header for mono 16-bit PCM. */
export function buildWavHeader(dataLen: number, sampleRate = 8000): Uint8Array {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  // "RIFF" chunk descriptor
  v.setUint32(0, 0x52494646, false); // "RIFF"
  v.setUint32(4, 36 + dataLen, true); // file size - 8
  v.setUint32(8, 0x57415645, false); // "WAVE"
  // "fmt " sub-chunk
  v.setUint32(12, 0x666d7420, false); // "fmt "
  v.setUint32(16, 16, true);          // sub-chunk size
  v.setUint16(20, 1, true);           // audio format = PCM
  v.setUint16(22, 1, true);           // channels = 1
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  // "data" sub-chunk
  v.setUint32(36, 0x64617461, false); // "data"
  v.setUint32(40, dataLen, true);
  return new Uint8Array(buf);
}

/** Wrap raw PCM samples in a WAV container for upload. */
export function pcmToWav(pcm: Int16Array, sampleRate = 8000): Uint8Array {
  const dataLen = pcm.length * 2;
  const header = buildWavHeader(dataLen, sampleRate);
  const out = new Uint8Array(44 + dataLen);
  out.set(header, 0);
  // little-endian int16 → bytes
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-32768, Math.min(32767, pcm[i] | 0));
    out[44 + 2 * i]     = s & 0xff;
    out[44 + 2 * i + 1] = (s >> 8) & 0xff;
  }
  return out;
}

/** Strip a 44-byte WAV header and return Int16 PCM samples. */
export function wavBase64ToPcm16(wavBase64: string): Int16Array {
  const bin = atob(wavBase64);
  // skip 44-byte header
  const len = (bin.length - 44) >> 1;
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const lo = bin.charCodeAt(44 + 2 * i);
    const hi = bin.charCodeAt(44 + 2 * i + 1);
    let s = (hi << 8) | lo;
    if (s & 0x8000) s -= 0x10000;
    out[i] = s;
  }
  return out;
}

// ─── Simple energy-based VAD ────────────────────────────────────────

/** RMS energy of an Int16 PCM frame. Used for cheap silence detection. */
export function rmsEnergy(pcm: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

// ─── Sarvam STT (Saarika) ───────────────────────────────────────────

export async function sarvamSTT(opts: {
  apiKey: string;
  pcm: Int16Array;
  languageCode?: string;
}): Promise<{ transcript: string; languageCode: string } | null> {
  const wav = pcmToWav(opts.pcm, 8000);
  const fd = new FormData();
  fd.append("file", new Blob([wav], { type: "audio/wav" }), "utterance.wav");
  fd.append("model", "saarika:v2");
  fd.append("language_code", opts.languageCode || "unknown"); // unknown → auto-detect
  fd.append("with_timestamps", "false");

  const res = await fetch(`${SARVAM_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": opts.apiKey },
    body: fd,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[sarvam-stt] HTTP ${res.status}: ${txt.slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  return {
    transcript: data.transcript || "",
    languageCode: data.language_code || opts.languageCode || "en-IN",
  };
}

// ─── Sarvam TTS (Bulbul v3) ─────────────────────────────────────────

export interface SarvamTTSOpts {
  apiKey: string;
  text: string;
  /** "ritu" | "simran" | "shubh" | "amol" | "vidya" | ... — picked on the dashboard. */
  speaker: string;
  /** "en-IN" | "hi-IN" | "ta-IN" | ... */
  languageCode?: string;
}

/**
 * Returns 8 kHz linear PCM 16-bit samples ready to encode to mulaw and ship
 * to Plivo. Returns null on API failure (caller should fall back to silence
 * or a generic prompt).
 */
export async function sarvamTTS(opts: SarvamTTSOpts): Promise<Int16Array | null> {
  const res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
    method: "POST",
    headers: {
      "api-subscription-key": opts.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: [opts.text],
      target_language_code: opts.languageCode || "en-IN",
      speaker: opts.speaker,
      model: "bulbul:v2",
      speech_sample_rate: 8000,
      enable_preprocessing: true,
      pitch: 0,
      pace: 1,
      loudness: 1.2,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[sarvam-tts] HTTP ${res.status}: ${txt.slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const wavBase64: string | undefined = data.audios?.[0];
  if (!wavBase64) {
    console.error(`[sarvam-tts] no audio in response`);
    return null;
  }
  return wavBase64ToPcm16(wavBase64);
}
