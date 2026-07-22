/**
 * Quick diagnostic: call Cartesia TTS, measure output duration vs expected.
 * Usage: deno run --allow-net scripts/tts-diag.ts
 */

const API_KEY = "sk_car_XCQaLw9pihx2TdxibKtPBF";
const VOICE_ID = "95d51f79-c397-46f9-b49a-23763d3eaa2d"; // Arushi

const phrases = [
  { text: "नमस्ते, मैं नव्या बोल रही हूँ N I M T से।", expectedSec: 3 },
  { text: "आपने M B A के बारे में enquiry की थी, क्या जानकारी चाहिए आपको?", expectedSec: 4 },
  { text: "Hello, this is a test of the Cartesia text to speech system.", expectedSec: 3.5 },
];

for (const { text, expectedSec } of phrases) {
  const t0 = Date.now();
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Cartesia-Version": "2026-03-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic-3.5",
      transcript: text,
      voice: { mode: "id", id: VOICE_ID },
      output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 },
      language: "hi",
    }),
  });

  if (!res.ok) {
    console.error(`FAIL ${res.status}: ${await res.text()}`);
    continue;
  }

  const buf = await res.arrayBuffer();
  const bytes = buf.byteLength;
  const actualSec = bytes / 8000; // 1 byte = 1 mulaw sample @ 8kHz
  const latencyMs = Date.now() - t0;
  const ratio = actualSec / expectedSec;

  console.log(`"${text.slice(0, 50)}..."`);
  console.log(`  Bytes: ${bytes} | Duration: ${actualSec.toFixed(2)}s | Expected: ~${expectedSec}s | Ratio: ${ratio.toFixed(2)}x | Latency: ${latencyMs}ms`);
  console.log(`  ${ratio > 1.4 ? "⚠️  SLOW — Cartesia outputting stretched audio" : ratio < 0.6 ? "⚠️  FAST" : "✅ Normal range"}`);
  console.log();
}
