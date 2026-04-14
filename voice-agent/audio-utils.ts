/**
 * Audio format conversion utilities for bridging Plivo ↔ Gemini Live API.
 *
 * Plivo streams:  mulaw 8kHz (base64)
 * Gemini expects: PCM 16-bit signed LE 16kHz (base64)
 * Gemini returns: PCM 16-bit signed LE 24kHz (base64)
 *
 * We need:
 * - mulawToPcm16k:  Plivo → Gemini  (decode mulaw 8k → PCM 16k with upsampling)
 * - pcm24kToMulaw8k: Gemini → Plivo  (downsample 24k → 8k, then encode mulaw)
 */

// μ-law decompression table (ITU-T G.711)
const MULAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i & 0xff;
  const sign = (mu & 0x80) ? -1 : 1;
  mu = mu & 0x7f;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MULAW_DECODE_TABLE[i] = sign * sample;
}

// μ-law compression: PCM int16 → mulaw byte
const MULAW_BIAS = 0x84;
const MULAW_MAX = 0x7fff;
const MULAW_CLIP = 32635;

function pcmToMulawSample(sample: number): number {
  const sign = (sample < 0) ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;

  let exponent = 7;
  const mask = 0x4000;
  for (let i = 0; i < 7; i++) {
    if (sample & (mask >> i)) break;
    exponent--;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/**
 * Decode mulaw 8kHz base64 → PCM 16kHz base64 (for Gemini input).
 * Simple linear interpolation for 8k→16k upsampling.
 */
export function mulawToGeminiPcm(mulawBase64: string): string {
  const mulawBytes = Uint8Array.from(atob(mulawBase64), c => c.charCodeAt(0));
  const pcm8k = new Int16Array(mulawBytes.length);

  // Decode mulaw → PCM 8kHz
  for (let i = 0; i < mulawBytes.length; i++) {
    pcm8k[i] = MULAW_DECODE_TABLE[mulawBytes[i]];
  }

  // Upsample 8kHz → 16kHz via linear interpolation
  const pcm16k = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    pcm16k[i * 2] = pcm8k[i];
    pcm16k[i * 2 + 1] = i < pcm8k.length - 1
      ? Math.round((pcm8k[i] + pcm8k[i + 1]) / 2)
      : pcm8k[i];
  }

  // Convert to base64
  const bytes = new Uint8Array(pcm16k.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Encode Gemini PCM 24kHz base64 → mulaw 8kHz base64 (for Plivo output).
 * Downsample 24k→8k (take every 3rd sample) then encode mulaw.
 */
export function geminiPcmToMulaw(pcm24kBase64: string): string {
  const raw = Uint8Array.from(atob(pcm24kBase64), c => c.charCodeAt(0));
  const pcm24k = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

  // Downsample 24kHz → 8kHz (factor 3)
  const pcm8kLen = Math.floor(pcm24k.length / 3);
  const mulaw = new Uint8Array(pcm8kLen);

  for (let i = 0; i < pcm8kLen; i++) {
    mulaw[i] = pcmToMulawSample(pcm24k[i * 3]);
  }

  // Convert to base64
  let binary = "";
  for (let i = 0; i < mulaw.length; i++) binary += String.fromCharCode(mulaw[i]);
  return btoa(binary);
}
