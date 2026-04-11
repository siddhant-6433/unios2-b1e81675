import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, Square, Play, Pause, Trash2, Send, Loader2 } from "lucide-react";

interface VoiceMessageRecorderProps {
  consultantId: string;
  onSent?: () => void;
}

export function VoiceMessageRecorder({ consultantId, onSent }: VoiceMessageRecorderProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };

      mr.start();
      startTimeRef.current = Date.now();
      setDuration(0);
      timerRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 200);
      setRecording(true);
    } catch (err: any) {
      toast({
        title: "Microphone access denied",
        description: err.message || "Please allow microphone access in your browser",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const discardRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setPlaying(false);
  };

  const sendMessage = async () => {
    if (!audioBlob || !user?.id) return;
    setSending(true);

    try {
      const fileName = `${consultantId}/${Date.now()}.webm`;
      const { error: uploadErr } = await supabase.storage
        .from("consultant-voice")
        .upload(fileName, audioBlob, { contentType: "audio/webm" });

      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage.from("consultant-voice").getPublicUrl(fileName);

      const { error: insertErr } = await supabase
        .from("consultant_voice_messages" as any)
        .insert({
          consultant_id: consultantId,
          sender_user_id: user.id,
          audio_url: pub.publicUrl,
          audio_path: fileName,
          duration_seconds: duration,
          subject: subject.trim() || null,
        });

      if (insertErr) throw insertErr;

      toast({ title: "Voice message sent", description: "The admission team will respond shortly." });
      discardRecording();
      setSubject("");
      onSent?.();
    } catch (e: any) {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    }
    setSending(false);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            Send Voice Message
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Record a quick voice note to the NIMT admission team
          </p>
        </div>

        {!audioBlob ? (
          <div className="flex flex-col items-center justify-center py-6 space-y-3 rounded-xl border-2 border-dashed border-border/60">
            {recording ? (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 animate-pulse">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                </div>
                <p className="text-sm font-mono text-foreground">{formatTime(duration)}</p>
                <Button onClick={stopRecording} size="sm" variant="destructive" className="gap-2">
                  <Square className="h-3.5 w-3.5" /> Stop Recording
                </Button>
              </>
            ) : (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Mic className="h-6 w-6 text-primary" />
                </div>
                <Button onClick={startRecording} size="sm" className="gap-2">
                  <Mic className="h-3.5 w-3.5" /> Start Recording
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <button
                onClick={togglePlayback}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Recording ready</p>
                <p className="text-xs text-muted-foreground">Duration: {formatTime(duration)}</p>
              </div>
              <button
                onClick={discardRecording}
                className="text-muted-foreground hover:text-destructive p-1 transition-colors"
                title="Discard"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <audio ref={audioRef} src={audioUrl || undefined} onEnded={() => setPlaying(false)} className="hidden" />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Subject (optional)
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Question about B.Sc Nursing fees"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                maxLength={100}
              />
            </div>

            <Button onClick={sendMessage} disabled={sending} className="w-full gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send to Admission Team
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
