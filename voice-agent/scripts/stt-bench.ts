/**
 * STT accuracy bench: Sarvam Saarika vs Cartesia Ink on real Plivo call
 * recordings (8kHz telephony, Hindi/Hinglish caller).
 *
 * Run:
 *   cd voice-agent && SARVAM_API_KEY=... CARTESIA_API_KEY=... \
 *     deno run -A scripts/stt-bench.ts
 *
 * Downloads each MP3, converts to 8kHz mono s16 WAV (ffmpeg → afconvert
 * fallback), strips the 44-byte header, and runs the full recording through
 * both providers. Sarvam's batch API caps duration, so on failure we fall
 * back to 15s chunks and concatenate transcripts.
 */

import { sarvamSTT } from "../sarvam.ts";
import { cartesiaSTT } from "../cartesia.ts";

const RECORDINGS = [
  "https://aps1.media.plivo.com/v1/Account/MAOTIZYJEZNJQTOTQYMC/Recording/a99fac6f-8b1a-4d2e-8cbc-176fb16abb40.mp3",
  "https://aps1.media.plivo.com/v1/Account/MAOTIZYJEZNJQTOTQYMC/Recording/d349df1f-4d7f-4d6b-85bc-c803251289d9.mp3",
];

const SAMPLE_RATE = 8000;
const CHUNK_SECS = 15;

const SARVAM_API_KEY = Deno.env.get("SARVAM_API_KEY");
const CARTESIA_API_KEY = Deno.env.get("CARTESIA_API_KEY");
if (!SARVAM_API_KEY || !CARTESIA_API_KEY) {
  console.error("Set SARVAM_API_KEY and CARTESIA_API_KEY env vars.");
  Deno.exit(1);
}

async function haveCmd(cmd: string): Promise<boolean> {
  try {
    const out = await new Deno.Command("which", { args: [cmd], stdout: "null", stderr: "null" }).output();
    return out.success;
  } catch {
    return false;
  }
}

/** MP3 bytes → 8kHz mono s16 WAV bytes, via ffmpeg or afconvert. */
async function mp3ToWav(mp3: Uint8Array): Promise<Uint8Array> {
  const tmpIn = await Deno.makeTempFile({ suffix: ".mp3" });
  const tmpOut = await Deno.makeTempFile({ suffix: ".wav" });
  await Deno.writeFile(tmpIn, mp3);
  try {
    let args: string[];
    let bin: string;
    if (await haveCmd("ffmpeg")) {
      bin = "ffmpeg";
      args = ["-y", "-i", tmpIn, "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "wav", tmpOut];
    } else if (await haveCmd("afconvert")) {
      bin = "afconvert";
      // -d LEI16 = little-endian signed 16-bit, -c 1 mono, -f WAVE
      args = ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "1", tmpIn, tmpOut];
    } else {
      throw new Error("Neither ffmpeg nor afconvert found — install one to run this bench.");
    }
    const res = await new Deno.Command(bin, { args, stdout: "null", stderr: "piped" }).output();
    if (!res.success) {
      throw new Error(`${bin} failed: ${new TextDecoder().decode(res.stderr).slice(0, 300)}`);
    }
    return await Deno.readFile(tmpOut);
  } finally {
    await Deno.remove(tmpIn).catch(() => {});
    await Deno.remove(tmpOut).catch(() => {});
  }
}

/** Strip 44-byte WAV header → little-endian Int16 PCM. */
function wavToPcm16(wav: Uint8Array): Int16Array {
  // Locate the "data" chunk instead of assuming 44 — afconvert may emit extra
  // chunks before it.
  let off = 12; // past "RIFF"<size>"WAVE"
  while (off + 8 <= wav.length) {
    const id = String.fromCharCode(wav[off], wav[off + 1], wav[off + 2], wav[off + 3]);
    const size = wav[off + 4] | (wav[off + 5] << 8) | (wav[off + 6] << 16) | (wav[off + 7] << 24);
    if (id === "data") {
      const start = off + 8;
      const dv = new DataView(wav.buffer, wav.byteOffset + start, size);
      const out = new Int16Array(size >> 1);
      for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, true);
      return out;
    }
    off += 8 + size + (size & 1);
  }
  throw new Error("no data chunk in WAV");
}

async function sarvamFull(pcm: Int16Array): Promise<string> {
  const r = await sarvamSTT({ apiKey: SARVAM_API_KEY!, pcm, languageCode: "unknown" });
  if (r) return r.transcript;
  // Fallback: 15s chunks (batch API duration cap).
  const chunkLen = CHUNK_SECS * SAMPLE_RATE;
  const parts: string[] = [];
  for (let i = 0; i < pcm.length; i += chunkLen) {
    const slice = pcm.subarray(i, Math.min(i + chunkLen, pcm.length));
    const cr = await sarvamSTT({ apiKey: SARVAM_API_KEY!, pcm: slice, languageCode: "unknown" });
    if (cr) parts.push(cr.transcript);
  }
  return parts.join(" ").trim();
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const v = await fn();
  return [v, Date.now() - t0];
}

for (let n = 0; n < RECORDINGS.length; n++) {
  const url = RECORDINGS[n];
  console.log(`\n${"=".repeat(72)}\nRECORDING ${n + 1}: ${url.split("/").pop()}\n${"=".repeat(72)}`);

  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`  download failed: HTTP ${resp.status}`);
    continue;
  }
  const mp3 = new Uint8Array(await resp.arrayBuffer());
  const wav = await mp3ToWav(mp3);
  const pcm = wavToPcm16(wav);
  console.log(`  ${(pcm.length / SAMPLE_RATE).toFixed(1)}s of audio (${pcm.length} samples)\n`);

  const [sarvam, sarvamMs] = await timed(() => sarvamFull(pcm));
  const [cart, cartMs] = await timed(async () => {
    const r = await cartesiaSTT({ apiKey: CARTESIA_API_KEY!, pcm, language: "hi" });
    return r?.transcript ?? "";
  });

  console.log(`SARVAM SAARIKA  (${sarvamMs}ms):`);
  console.log(`  ${sarvam || "(empty)"}\n`);
  console.log(`CARTESIA INK    (${cartMs}ms):`);
  console.log(`  ${cart || "(empty)"}`);
}
