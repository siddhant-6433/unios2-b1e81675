/**
 * Cartesia Ink (STT) + Sonic (TTS) clients.
 *
 * Drop-in replacements for Sarvam/ElevenLabs in the cascade pipeline.
 * Sonic supports pcm_mulaw at 8kHz natively — no resample needed.
 * Ink accepts WAV files and returns transcripts.
 *
 * Env: CARTESIA_API_KEY (sk_car_...)
 */

import { pcmToWav } from "./sarvam.ts";

const CARTESIA_BASE = "https://api.cartesia.ai";
const CARTESIA_VERSION = "2026-03-01";

// ── TTS (Sonic) ─────────────────────────────────────────────────────

export interface CartesiaTTSOpts {
  apiKey: string;
  text: string;
  voiceId: string;
  model?: string;
  language?: string;
  speed?: number;
}

/**
 * Returns base64-encoded mulaw 8kHz audio ready to ship to Plivo.
 * No PCM→mulaw conversion needed — Cartesia outputs mulaw natively.
 * Returns null on failure (caller falls back to Sarvam).
 */
export async function cartesiaTTS(opts: CartesiaTTSOpts): Promise<string | null> {
  if (!opts.voiceId || !opts.apiKey) {
    console.error("[cartesia-tts] voiceId and apiKey required (skipping)");
    return null;
  }
  const text = (opts.text || "").trim();
  if (!text) return null;

  const body: Record<string, any> = {
    model_id: opts.model || "sonic-3.5",
    transcript: text,
    voice: { mode: "id", id: opts.voiceId },
    output_format: {
      container: "raw",
      encoding: "pcm_mulaw",
      sample_rate: 8000,
    },
    language: opts.language || "hi",
  };
  if (typeof opts.speed === "number" && opts.speed !== 1.0) {
    body.generation_config = { speed: opts.speed };
  }

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${CARTESIA_BASE}/tts/bytes`, {
      method: "POST",
      headers: {
        "Cartesia-Version": CARTESIA_VERSION,
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`[cartesia-tts] network error after ${Date.now() - t0}ms: ${(err as Error).message}`);
    return null;
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const reason = res.status === 401 ? "auth — check CARTESIA_API_KEY"
      : res.status === 422 ? "invalid request (voice_id? text?)"
      : res.status === 429 ? "rate limited"
      : `HTTP ${res.status}`;
    console.error(`[cartesia-tts] ${reason} (${Date.now() - t0}ms): ${txt.slice(0, 300)}`);
    return null;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 2) {
    console.error(`[cartesia-tts] empty response (${Date.now() - t0}ms)`);
    return null;
  }
  // Raw mulaw bytes → base64 for Plivo playAudio
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const b64 = btoa(binary);
  console.log(`[cartesia-tts] ${buf.length} mulaw bytes in ${Date.now() - t0}ms | text="${text.slice(0, 60)}"`);
  return b64;
}

/**
 * Convenience: returns Int16Array PCM 8kHz (same interface as sarvamTTS/elevenLabsTTS)
 * for use in filler cache which expects PCM. Most callers should use cartesiaTTS()
 * directly for the mulaw output.
 */
export async function cartesiaTTSPcm(opts: CartesiaTTSOpts): Promise<Int16Array | null> {
  if (!opts.voiceId || !opts.apiKey) return null;
  const text = (opts.text || "").trim();
  if (!text) return null;

  const body: Record<string, any> = {
    model_id: opts.model || "sonic-3.5",
    transcript: text,
    voice: { mode: "id", id: opts.voiceId },
    output_format: {
      container: "raw",
      encoding: "pcm_s16le",
      sample_rate: 8000,
    },
    language: opts.language || "hi",
  };
  if (typeof opts.speed === "number" && opts.speed !== 1.0) {
    body.generation_config = { speed: opts.speed };
  }

  const res = await fetch(`${CARTESIA_BASE}/tts/bytes`, {
    method: "POST",
    headers: {
      "Cartesia-Version": CARTESIA_VERSION,
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res?.ok) return null;

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 2) return null;
  const out = new Int16Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const lo = buf[2 * i];
    const hi = buf[2 * i + 1];
    let s = (hi << 8) | lo;
    if (s & 0x8000) s -= 0x10000;
    out[i] = s;
  }
  return out;
}

// ── Streaming STT (Ink-2 over WebSocket) ────────────────────────────
//
// Persistent connection per call. Plivo mulaw frames are forwarded
// directly (Ink accepts pcm_mulaw natively — zero conversion).
// Transcription happens WHILE the caller speaks; on finalize() the
// assembled final transcript is delivered via onFinal almost instantly.

export class CartesiaSttStream {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private language: string;
  private finalChunks: string[] = [];
  private closed = false;
  /** Resolvers waiting on the next finalized transcript. */
  private finalizeWaiters: Array<(text: string) => void> = [];
  onError?: (msg: string) => void;

  constructor(opts: { apiKey: string; language?: string }) {
    this.apiKey = opts.apiKey;
    this.language = opts.language || "hi";
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // ink-2 is English-only; ink-whisper covers 99+ languages incl. Hindi.
      const model = this.language === "en" ? "ink-2" : "ink-whisper";
      const url = `wss://api.cartesia.ai/stt/websocket` +
        `?model=${model}&encoding=pcm_mulaw&sample_rate=8000` +
        `&language=${encodeURIComponent(this.language)}` +
        `&cartesia_version=${CARTESIA_VERSION}&api_key=${encodeURIComponent(this.apiKey)}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timeout = setTimeout(() => reject(new Error("STT WS connect timeout")), 5000);
      ws.onopen = () => { clearTimeout(timeout); resolve(); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "transcript" && msg.is_final && msg.text) {
            this.finalChunks.push(msg.text);
          } else if (msg.type === "flush_done") {
            const text = this.finalChunks.join(" ").trim();
            this.finalChunks = [];
            const waiter = this.finalizeWaiters.shift();
            if (waiter) waiter(text);
          } else if (msg.type === "error") {
            console.error(`[cartesia-stt-ws] error:`, msg.message || JSON.stringify(msg).slice(0, 200));
            this.onError?.(msg.message || "stt error");
          }
        } catch { /* binary or malformed — ignore */ }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        if (!this.closed) this.onError?.("stt ws error");
        reject(new Error("STT WS error"));
      };
      ws.onclose = () => {
        // Wake any pending finalize waiters with whatever we have so a
        // dropped WS doesn't hang the turn forever.
        const text = this.finalChunks.join(" ").trim();
        this.finalChunks = [];
        for (const w of this.finalizeWaiters.splice(0)) w(text);
      };
    });
  }

  get ready(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  sendAudio(mulawBytes: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(mulawBytes);
  }

  /** End-of-turn: flush and resolve with the assembled final transcript. */
  finalize(timeoutMs = 3000): Promise<string> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      const text = this.finalChunks.join(" ").trim();
      this.finalChunks = [];
      return Promise.resolve(text);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // flush_done never arrived — resolve with what we have
        const idx = this.finalizeWaiters.indexOf(wrapped);
        if (idx >= 0) this.finalizeWaiters.splice(idx, 1);
        const text = this.finalChunks.join(" ").trim();
        this.finalChunks = [];
        resolve(text);
      }, timeoutMs);
      const wrapped = (text: string) => { clearTimeout(timer); resolve(text); };
      this.finalizeWaiters.push(wrapped);
      this.ws!.send("finalize");
    });
  }

  close() {
    this.closed = true;
    try { this.ws?.send("done"); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

// ── Streaming TTS (Sonic over WebSocket) ────────────────────────────
//
// Persistent connection per call. speak() streams base64 mulaw chunks
// to onChunk as Sonic generates them (~40-100ms TTFB). cancel() halts
// an in-flight generation for barge-in.

export class CartesiaTtsStream {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private closed = false;
  private activeContext: string | null = null;
  /** Per-context chunk callback + done resolver. */
  private handlers = new Map<string, { onChunk: (b64: string) => void; onDone: () => void }>();

  constructor(opts: { apiKey: string }) {
    this.apiKey = opts.apiKey;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.cartesia.ai/tts/websocket` +
        `?cartesia_version=${CARTESIA_VERSION}&api_key=${encodeURIComponent(this.apiKey)}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timeout = setTimeout(() => reject(new Error("TTS WS connect timeout")), 5000);
      ws.onopen = () => { clearTimeout(timeout); resolve(); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          const ctx = msg.context_id;
          const h = ctx ? this.handlers.get(ctx) : undefined;
          if (msg.type === "chunk" && msg.data && h) {
            h.onChunk(msg.data);
          } else if (msg.type === "done" && h) {
            h.onDone();
            this.handlers.delete(ctx);
            if (this.activeContext === ctx) this.activeContext = null;
          } else if (msg.type === "error") {
            console.error(`[cartesia-tts-ws] error:`, (msg.error || msg.message || "").slice?.(0, 200) || JSON.stringify(msg).slice(0, 200));
            if (h) { h.onDone(); this.handlers.delete(ctx); }
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error("TTS WS error")); };
      ws.onclose = () => {
        for (const [ctx, h] of this.handlers) { h.onDone(); this.handlers.delete(ctx); }
      };
    });
  }

  get ready(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  /**
   * Stream TTS for `text`. onChunk fires per base64 mulaw chunk.
   * Resolves when generation completes (or errors/cancels).
   */
  speak(opts: {
    text: string; voiceId: string; model?: string; language?: string; speed?: number;
    contextId: string; onChunk: (b64: string) => void;
  }): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("TTS WS not open"));
    return new Promise((resolve) => {
      this.handlers.set(opts.contextId, { onChunk: opts.onChunk, onDone: resolve });
      this.activeContext = opts.contextId;
      const req: Record<string, any> = {
        model_id: opts.model || "sonic-3.5",
        transcript: opts.text,
        voice: { mode: "id", id: opts.voiceId },
        output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 },
        language: opts.language || "hi",
        context_id: opts.contextId,
        continue: false,
      };
      if (typeof opts.speed === "number" && opts.speed !== 1.0) {
        req.generation_config = { speed: opts.speed };
      }
      this.ws!.send(JSON.stringify(req));
    });
  }

  /** Barge-in: halt in-flight generation. */
  cancel(contextId?: string) {
    const ctx = contextId || this.activeContext;
    if (!ctx) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ context_id: ctx, cancel: true }));
    }
    const h = this.handlers.get(ctx);
    if (h) { h.onDone(); this.handlers.delete(ctx); }
    if (this.activeContext === ctx) this.activeContext = null;
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

// ── STT (Ink) ───────────────────────────────────────────────────────

export interface CartesiaSTTOpts {
  apiKey: string;
  pcm: Int16Array;
  language?: string;
}

/**
 * Transcribe PCM audio via Cartesia Ink. Returns transcript or null.
 */
export async function cartesiaSTT(opts: CartesiaSTTOpts): Promise<{ transcript: string } | null> {
  if (!opts.apiKey || !opts.pcm?.length) return null;

  const wav = pcmToWav(opts.pcm, 8000);
  const fd = new FormData();
  fd.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "utterance.wav");
  fd.append("model", "ink-whisper");
  fd.append("language", opts.language || "hi");

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${CARTESIA_BASE}/stt`, {
      method: "POST",
      headers: {
        "Cartesia-Version": CARTESIA_VERSION,
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: fd,
    });
  } catch (err) {
    console.error(`[cartesia-stt] network error after ${Date.now() - t0}ms: ${(err as Error).message}`);
    return null;
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[cartesia-stt] HTTP ${res.status} (${Date.now() - t0}ms): ${txt.slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  console.log(`[cartesia-stt] "${(data.text || "").slice(0, 80)}" in ${Date.now() - t0}ms`);
  return { transcript: data.text || "" };
}
