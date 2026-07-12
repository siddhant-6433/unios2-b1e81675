import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles } from "lucide-react";
import { NavyaKnowledgeContent } from "./NavyaKnowledge";

// Voice agent provider toggle + tunable knobs. Flips the AI call backend
// between Gemini Live native-audio, the cascaded Sarvam STT → Gemini text →
// Sarvam TTS path, and the Cartesia streaming pipeline. Exposes the
// latency/voice-quality knobs the voice-agent reads on a 30s cache, so
// switching propagates within ~30s of the save (no redeploy required).
type Provider = "gemini" | "sarvam" | "cartesia";

type VoiceTuning = {
  gemini_silence_ms: number;
  sarvam_filler_threshold_ms: number;
  sarvam_pace: number;
  sarvam_speaker: string;
  sarvam_bulbul_model: string;
  // Round 2 — high & medium value
  gemini_voice: string;
  gemini_model: string;
  gemini_prefix_padding_ms: number;
  cascade_max_tokens: number;
  cascade_temperature: number;
  cascade_lang_override: "auto" | "hi-IN" | "en-IN";
  // Round 3 — ElevenLabs as alternative cascade TTS
  cascade_tts_provider: "sarvam" | "elevenlabs";
  elevenlabs_voice_id: string;
  // Cartesia streaming pipeline
  cartesia_voice_id: string;
  cartesia_model: string;
  cartesia_language: "hi" | "en";
  cartesia_filler_threshold_ms: number;
};

// v3-beta speakers (per Sarvam API): aditya/ritu/ashutosh/priya/neha/
// rahul/pooja/rohan/simran/kavya. v3-stable accepts a different mostly-
// disjoint set including suhani/anushka/manisha/shubh/etc. — using the
// v3-beta list here since that's our default model and the API rejects
// mismatched (model, speaker) pairs with HTTP 400.
const SARVAM_SPEAKERS = ["priya", "neha", "ritu", "pooja", "kavya", "simran", "aditya", "ashutosh", "rahul", "rohan"] as const;
const BULBUL_MODELS = ["bulbul:v3", "bulbul:v3-beta"] as const;
const GEMINI_VOICES = ["Aoede", "Charon", "Fenrir", "Kore", "Leda", "Puck", "Zephyr"] as const;
const GEMINI_MODELS = [
  "gemini-2.5-flash-native-audio-latest",
  "gemini-2.5-flash-native-audio-preview-09-2025",
  "gemini-2.5-flash-native-audio-preview-12-2025",
] as const;
const CASCADE_LANGS = [
  { v: "auto",  label: "Auto-detect from script" },
  { v: "hi-IN", label: "Force Hindi (hi-IN)" },
  { v: "en-IN", label: "Force English (en-IN)" },
] as const;
const CARTESIA_LANGS = [
  { v: "hi", label: "Hindi (hi)" },
  { v: "en", label: "English (en)" },
] as const;

function VoiceProviderCard() {
  const { toast } = useToast();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);
  const [tuning, setTuning] = useState<VoiceTuning | null>(null);
  const [tuningSaving, setTuningSaving] = useState(false);

  useEffect(() => {
    (supabase.rpc("get_voice_agent_provider" as any) as any).then(({ data }: any) => {
      setProvider(data === "sarvam" ? "sarvam" : data === "cartesia" ? "cartesia" : "gemini");
    });
    (supabase.rpc("get_voice_agent_settings" as any) as any).then(({ data }: any) => {
      // Defaults match the migration so the UI always renders something useful
      setTuning({
        gemini_silence_ms:          data?.gemini_silence_ms          ?? 1500,
        sarvam_filler_threshold_ms: data?.sarvam_filler_threshold_ms ?? 700,
        sarvam_pace:                Number(data?.sarvam_pace ?? 1.0),
        sarvam_speaker:             data?.sarvam_speaker             ?? "suhani",
        sarvam_bulbul_model:        data?.sarvam_bulbul_model        ?? "bulbul:v3-beta",
        gemini_voice:               data?.gemini_voice               ?? "Aoede",
        gemini_model:               data?.gemini_model               ?? "gemini-2.5-flash-native-audio-latest",
        gemini_prefix_padding_ms:   data?.gemini_prefix_padding_ms   ?? 300,
        cascade_max_tokens:         data?.cascade_max_tokens         ?? 150,
        cascade_temperature:        Number(data?.cascade_temperature ?? 0.4),
        cascade_lang_override:      (data?.cascade_lang_override === "hi-IN" || data?.cascade_lang_override === "en-IN") ? data.cascade_lang_override : "auto",
        cascade_tts_provider:       data?.cascade_tts_provider === "elevenlabs" ? "elevenlabs" : "sarvam",
        elevenlabs_voice_id:        data?.elevenlabs_voice_id ?? "",
        cartesia_voice_id:          data?.cartesia_voice_id ?? "",
        cartesia_model:             data?.cartesia_model ?? "sonic-3.5",
        cartesia_language:          data?.cartesia_language === "en" ? "en" : "hi",
        cartesia_filler_threshold_ms: data?.cartesia_filler_threshold_ms ?? 700,
      });
    });
  }, []);

  const flip = async (next: Provider) => {
    if (next === provider) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_voice_agent_provider" as any, { _provider: next });
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't change provider", description: error.message, variant: "destructive" });
      return;
    }
    setProvider(next);
    toast({ title: `Voice provider switched to ${next}`, description: "New calls land on the new engine within ~30s." });
  };

  // Patch one or more tuning fields. Only the changed field needs to be
  // sent — set_voice_agent_settings does a partial JSONB merge.
  const patchTuning = async (patch: Partial<VoiceTuning>) => {
    if (!tuning) return;
    const next: VoiceTuning = { ...tuning, ...patch };
    setTuning(next);
    setTuningSaving(true);
    const { error } = await supabase.rpc("set_voice_agent_settings" as any, { _settings: patch });
    setTuningSaving(false);
    if (error) {
      toast({ title: "Couldn't save setting", description: error.message, variant: "destructive" });
      // Refetch on failure so the UI snaps back to the actual stored value
      const { data } = await (supabase.rpc("get_voice_agent_settings" as any) as any);
      if (data) setTuning(data);
      return;
    }
    toast({ title: "Saved", description: "Active on new calls within ~30s." });
  };

  if (!provider) return null;

  const tuningLabel = provider === "gemini" ? "Gemini Live" : provider === "sarvam" ? "Sarvam Cascade" : "Cartesia Streaming";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
      {/* ── Provider toggle ── */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">AI Voice Agent backend</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            <span className="font-medium">Gemini Live</span> = end-to-end native audio (lower latency, less resilient).
            <span className="font-medium"> Sarvam</span> = STT + Gemini text + TTS (higher latency, more resilient, Indian-language native voices).
            <span className="font-medium"> Cartesia</span> = low-latency streaming TTS pipeline (Sonic).
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1 flex-wrap">
          <button
            disabled={saving}
            onClick={() => flip("gemini")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${provider === "gemini" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Gemini Live
          </button>
          <button
            disabled={saving}
            onClick={() => flip("sarvam")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${provider === "sarvam" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Sarvam Cascade
          </button>
          <button
            disabled={saving}
            onClick={() => flip("cartesia")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${provider === "cartesia" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Cartesia Streaming
          </button>
          <span
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground/50 cursor-not-allowed"
            title="Not yet available"
          >
            Plivo (experimental)
          </span>
        </div>
      </div>

      {/* ── Tunable settings ── only the section for the ACTIVE provider
              is shown so admins aren't editing knobs that don't apply. */}
      {tuning && (
        <div className="border-t border-border pt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">
              Tuning · {tuningLabel}
            </p>
            {tuningSaving && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          </div>

          {/* ── Gemini Live tuning ── */}
          {provider === "gemini" && (
            <div className="space-y-3">
              {/* Turn-end VAD timeout */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">Turn-end timeout</label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.gemini_silence_ms} ms</span>
                </div>
                <input
                  type="range" min={500} max={3000} step={100}
                  value={tuning.gemini_silence_ms}
                  onChange={(e) => setTuning({ ...tuning, gemini_silence_ms: Number(e.target.value) })}
                  onMouseUp={(e) => patchTuning({ gemini_silence_ms: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => patchTuning({ gemini_silence_ms: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  How long Gemini's VAD waits before declaring the caller done. Lower = snappier. Below ~1200 ms risks self-interrupt on Hindi pauses.
                </p>
              </div>

              {/* Prefix padding */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">Prefix padding</label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.gemini_prefix_padding_ms} ms</span>
                </div>
                <input
                  type="range" min={100} max={500} step={50}
                  value={tuning.gemini_prefix_padding_ms}
                  onChange={(e) => setTuning({ ...tuning, gemini_prefix_padding_ms: Number(e.target.value) })}
                  onMouseUp={(e) => patchTuning({ gemini_prefix_padding_ms: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => patchTuning({ gemini_prefix_padding_ms: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">VAD pre-speech context window. Default 300 ms. Lower = miss first phoneme; higher = small lag.</p>
              </div>

              {/* Voice + model side-by-side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Voice</label>
                  <select
                    value={tuning.gemini_voice}
                    onChange={(e) => patchTuning({ gemini_voice: e.target.value })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    {GEMINI_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Aoede=measured female · Kore=energetic · Charon=deep · Leda/Zephyr=calm.</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Model</label>
                  <select
                    value={tuning.gemini_model}
                    onChange={(e) => patchTuning({ gemini_model: e.target.value })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    {GEMINI_MODELS.map(m => <option key={m} value={m}>{m.replace("gemini-", "")}</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">native-audio = best quality. flash-live = lower latency, more synthetic.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Sarvam Cascade tuning ── */}
          {provider === "sarvam" && (
            <div className="space-y-3">
              {/* TTS provider switch — Sarvam Bulbul vs ElevenLabs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-border/40">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Cascade TTS provider</label>
                  <select
                    value={tuning.cascade_tts_provider}
                    onChange={(e) => patchTuning({ cascade_tts_provider: e.target.value as VoiceTuning["cascade_tts_provider"] })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    <option value="sarvam">Sarvam Bulbul</option>
                    <option value="elevenlabs">ElevenLabs (Turbo v2.5)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Bulbul = cheaper, faster (~500ms). ElevenLabs = better Hinglish prosody, ~$0.30/1k chars, ~800ms.
                  </p>
                </div>
                {tuning.cascade_tts_provider === "elevenlabs" && (
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">ElevenLabs voice ID</label>
                    <input
                      type="text"
                      value={tuning.elevenlabs_voice_id}
                      onChange={(e) => setTuning({ ...tuning, elevenlabs_voice_id: e.target.value })}
                      onBlur={(e) => patchTuning({ elevenlabs_voice_id: e.target.value.trim() })}
                      placeholder="paste voice_id from ElevenLabs"
                      className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Find in ElevenLabs dashboard → Voices → click voice → "View ID". e.g. for Anjura.
                    </p>
                  </div>
                )}
              </div>

              {/* Filler-ack threshold */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">Filler-ack threshold</label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.sarvam_filler_threshold_ms} ms</span>
                </div>
                <input
                  type="range" min={0} max={2500} step={100}
                  value={tuning.sarvam_filler_threshold_ms}
                  onChange={(e) => setTuning({ ...tuning, sarvam_filler_threshold_ms: Number(e.target.value) })}
                  onMouseUp={(e) => patchTuning({ sarvam_filler_threshold_ms: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => patchTuning({ sarvam_filler_threshold_ms: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  How long after the caller stops speaking before we play a short "ji…" filler while the LLM thinks. 0 = always. ≥2000 = effectively never.
                </p>
              </div>

              {/* Bulbul pace */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">Bulbul pace</label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.sarvam_pace.toFixed(2)}×</span>
                </div>
                <input
                  type="range" min={0.7} max={1.4} step={0.05}
                  value={tuning.sarvam_pace}
                  onChange={(e) => setTuning({ ...tuning, sarvam_pace: Number(e.target.value) })}
                  onMouseUp={(e) => patchTuning({ sarvam_pace: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => patchTuning({ sarvam_pace: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Bulbul speech speed. 1.0 = natural default. Higher = faster.</p>
              </div>

              {/* Bulbul speaker + model side-by-side — hidden when
                  ElevenLabs is the active TTS provider (those settings
                  don't apply to EL). */}
              {tuning.cascade_tts_provider === "sarvam" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">Bulbul speaker</label>
                    <select
                      value={tuning.sarvam_speaker}
                      onChange={(e) => patchTuning({ sarvam_speaker: e.target.value })}
                      className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                    >
                      {SARVAM_SPEAKERS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Filler audio re-renders automatically when the voice changes.</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">Bulbul model</label>
                    <select
                      value={tuning.sarvam_bulbul_model}
                      onChange={(e) => patchTuning({ sarvam_bulbul_model: e.target.value })}
                      className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                    >
                      {BULBUL_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-0.5">v3-beta = better prosody · v3 = stable fallback.</p>
                  </div>
                </div>
              )}

              {/* LLM tuning sub-section */}
              <div className="border-t border-border/60 pt-3 space-y-3">
                <p className="text-[10px] font-semibold text-foreground/70 uppercase tracking-wide">LLM (Gemini text)</p>

                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className="text-xs font-medium text-foreground">Reply max tokens</label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.cascade_max_tokens}</span>
                  </div>
                  <input
                    type="range" min={50} max={500} step={10}
                    value={tuning.cascade_max_tokens}
                    onChange={(e) => setTuning({ ...tuning, cascade_max_tokens: Number(e.target.value) })}
                    onMouseUp={(e) => patchTuning({ cascade_max_tokens: Number((e.target as HTMLInputElement).value) })}
                    onTouchEnd={(e) => patchTuning({ cascade_max_tokens: Number((e.target as HTMLInputElement).value) })}
                    className="w-full"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">~150 tokens ≈ 2-3 short sentences. Tighter = faster TTS, but cuts off long answers.</p>
                </div>

                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className="text-xs font-medium text-foreground">Temperature</label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.cascade_temperature.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min={0} max={1.5} step={0.05}
                    value={tuning.cascade_temperature}
                    onChange={(e) => setTuning({ ...tuning, cascade_temperature: Number(e.target.value) })}
                    onMouseUp={(e) => patchTuning({ cascade_temperature: Number((e.target as HTMLInputElement).value) })}
                    onTouchEnd={(e) => patchTuning({ cascade_temperature: Number((e.target as HTMLInputElement).value) })}
                    className="w-full"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">0 = deterministic. 0.4 = default. 0.7+ = more variety, occasionally off-script.</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Bulbul language override</label>
                  <select
                    value={tuning.cascade_lang_override}
                    onChange={(e) => patchTuning({ cascade_lang_override: e.target.value as VoiceTuning["cascade_lang_override"] })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    {CASCADE_LANGS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Auto reads phonetics from the script the LLM emitted. Force one if you see persistent mispronunciations.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Cartesia Streaming tuning ── */}
          {provider === "cartesia" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Cartesia voice ID</label>
                  <input
                    type="text"
                    value={tuning.cartesia_voice_id}
                    onChange={(e) => setTuning({ ...tuning, cartesia_voice_id: e.target.value })}
                    onBlur={(e) => patchTuning({ cartesia_voice_id: e.target.value.trim() })}
                    placeholder="paste voice_id from Cartesia"
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Find in Cartesia dashboard → Voices → copy the voice ID.</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Model</label>
                  <input
                    type="text"
                    value={tuning.cartesia_model}
                    onChange={(e) => setTuning({ ...tuning, cartesia_model: e.target.value })}
                    onBlur={(e) => patchTuning({ cartesia_model: e.target.value.trim() })}
                    placeholder="sonic-3.5"
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Default sonic-3.5. Cartesia streaming TTS model id.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Language</label>
                  <select
                    value={tuning.cartesia_language}
                    onChange={(e) => patchTuning({ cartesia_language: e.target.value as VoiceTuning["cartesia_language"] })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    {CARTESIA_LANGS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Synthesis language for the Cartesia voice.</p>
                </div>
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className="text-xs font-medium text-foreground">Filler-ack threshold</label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.cartesia_filler_threshold_ms} ms</span>
                  </div>
                  <input
                    type="number" min={0} max={2500} step={100}
                    value={tuning.cartesia_filler_threshold_ms}
                    onChange={(e) => setTuning({ ...tuning, cartesia_filler_threshold_ms: Number(e.target.value) })}
                    onBlur={(e) => patchTuning({ cartesia_filler_threshold_ms: Number((e.target as HTMLInputElement).value) })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Delay before a short filler plays while the LLM thinks. 0 = always.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NavyaVoiceAgent() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-pastel-purple p-2">
          <Sparkles className="h-5 w-5 text-foreground/70" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Navya Voice Agent</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Settings, knowledge and learning for the AI admissions counsellor
          </p>
        </div>
      </div>

      <Tabs defaultValue="settings" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          <TabsTrigger value="settings" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Voice Agent Settings
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Knowledge
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4">
          <VoiceProviderCard />
        </TabsContent>

        <TabsContent value="knowledge" className="mt-4">
          <NavyaKnowledgeContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}
