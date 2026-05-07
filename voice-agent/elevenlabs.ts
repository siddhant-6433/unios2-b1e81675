/**
 * ElevenLabs TTS — alternative cascade output to Sarvam Bulbul.
 *
 * Why: ElevenLabs Hinglish voices (e.g. "Anjura – Hiring & Onboarding
 * Hinglish Bot") sound noticeably more natural for English-mixed Hindi
 * than Bulbul does. Tradeoff: ~600-1200ms per request (vs Sarvam's
 * ~400-800ms) and ~$0.30 per 1k characters on Turbo v2.5.
 *
 * The output pipeline matches sarvamTTS so the cascade handler can
 * drop-in swap providers: returns 8 kHz linear PCM 16-bit Int16Array
 * ready to encode to mulaw via pcm16ToMulawBase64().
 *
 * We request `pcm_8000` directly from ElevenLabs (no resample needed)
 * and pull `eleven_turbo_v2_5` for the Hindi/Hinglish-friendly low-
 * latency model.
 */

const ELEVENLABS_BASE = "https://api.elevenlabs.io";

export interface ElevenLabsTTSOpts {
  apiKey: string;
  text: string;
  /** Voice ID from the ElevenLabs dashboard. e.g. Anjura's voice_id. */
  voiceId: string;
  /** "eleven_turbo_v2_5" (default — fast, multilingual incl. Hindi).
   *  Other options: "eleven_multilingual_v2" (higher quality, slower). */
  model?: string;
  /** 0.0-1.0 — higher = more consistent voice but more robotic. */
  stability?: number;
  /** 0.0-1.0 — higher = closer match to the original cloned voice. */
  similarityBoost?: number;
  /** 0.0-1.0 — higher = more expressive / dramatic delivery. */
  style?: number;
  /** Speed multiplier — Turbo supports 0.7-1.2. */
  speed?: number;
}

/**
 * Returns 8 kHz linear PCM 16-bit samples ready to encode to mulaw and ship
 * to Plivo. Returns null on API failure (caller should fall back to silence
 * or a generic prompt).
 *
 * Verbose logging: every failure path logs WHY (HTTP status, body preview,
 * empty response, malformed PCM). This is the only way to diagnose mid-call
 * voice switches, since the cascade auto-falls-back to Sarvam Bulbul and
 * the caller hears a different voice without us knowing the reason.
 */
export async function elevenLabsTTS(opts: ElevenLabsTTSOpts): Promise<Int16Array | null> {
  if (!opts.voiceId) {
    console.error("[elevenlabs-tts] voiceId is required (skipping)");
    return null;
  }
  if (!opts.apiKey) {
    console.error("[elevenlabs-tts] apiKey is required (skipping)");
    return null;
  }
  const text = (opts.text || "").trim();
  if (!text) {
    console.warn("[elevenlabs-tts] empty text (skipping)");
    return null;
  }
  // ElevenLabs returns raw PCM when output_format=pcm_8000 — same sample
  // rate as Plivo expects, so no resampling. Stream endpoint is faster
  // than the buffered one but we just want the full payload here.
  const url = `${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=pcm_8000`;
  const body: Record<string, any> = {
    text,
    model_id: opts.model || "eleven_turbo_v2_5",
    voice_settings: {
      stability: typeof opts.stability === "number" ? opts.stability : 0.5,
      similarity_boost: typeof opts.similarityBoost === "number" ? opts.similarityBoost : 0.75,
      style: typeof opts.style === "number" ? opts.style : 0.0,
      use_speaker_boost: true,
      speed: typeof opts.speed === "number" ? opts.speed : 1.0,
    },
  };

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": opts.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/pcm",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`[elevenlabs-tts] network error after ${Date.now() - t0}ms: ${(err as Error).message} | text="${text.slice(0, 60)}"`);
    return null;
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    // Map common status codes to plain English so logs are scannable.
    const reason = res.status === 401 ? "auth/quota — check ELEVENLABS_API_KEY and plan balance"
      : res.status === 422 ? "voice_id invalid OR text rejected (special chars?)"
      : res.status === 429 ? "rate limited — too many requests"
      : res.status === 503 ? "EL upstream unavailable — transient"
      : `HTTP ${res.status}`;
    console.error(`[elevenlabs-tts] ${reason} (after ${Date.now() - t0}ms): ${txt.slice(0, 300)} | voice=${opts.voiceId.slice(0, 8)} text="${text.slice(0, 60)}"`);
    return null;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 2) {
    console.error(`[elevenlabs-tts] empty PCM response after ${Date.now() - t0}ms (text="${text.slice(0, 60)}")`);
    return null;
  }
  // PCM 16-bit little-endian → Int16Array (length = bytes / 2)
  const out = new Int16Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const lo = buf[2 * i];
    const hi = buf[2 * i + 1];
    let s = (hi << 8) | lo;
    if (s & 0x8000) s -= 0x10000;
    out[i] = s;
  }
  console.log(`[elevenlabs-tts] ${out.length} samples (${Math.round(out.length / 8)}ms audio) in ${Date.now() - t0}ms | text="${text.slice(0, 60)}"`);
  return out;
}
