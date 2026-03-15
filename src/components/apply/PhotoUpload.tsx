import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, Upload, Loader2, CheckCircle, Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  applicationId: string;
  onUploaded: (url: string) => void;
  existingUrl?: string;
}

export function PhotoUpload({ applicationId, onUploaded, existingUrl }: Props) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<string | null>(existingUrl || null);
  const [processing, setProcessing] = useState(false);
  const [showWebcam, setShowWebcam] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Attach stream to video element whenever showWebcam becomes true
  useEffect(() => {
    if (showWebcam && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [showWebcam]);

  const processAndUpload = useCallback(async (imageDataUrl: string) => {
    setProcessing(true);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('process-passport-photo', {
        body: { image: imageDataUrl, applicationId },
      });

      if (fnError) throw fnError;

      const processedUrl = fnData?.processedImage || imageDataUrl;
      setPreview(processedUrl);

      const base64 = processedUrl.split(',')[1];
      if (!base64) throw new Error('Invalid image data');
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const path = `${applicationId}/passport_photo.png`;
      const { error: uploadErr } = await supabase.storage
        .from('application-documents')
        .upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (uploadErr) throw uploadErr;

      onUploaded(path);
      toast({ title: 'Passport photo uploaded successfully' });
    } catch (err: any) {
      console.error('Photo processing error:', err);
      try {
        const base64 = imageDataUrl.split(',')[1];
        if (base64) {
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'image/png' });
          const path = `${applicationId}/passport_photo.png`;
          await supabase.storage.from('application-documents').upload(path, blob, { upsert: true, contentType: 'image/png' });
          onUploaded(path);
          setPreview(imageDataUrl);
          toast({ title: 'Photo uploaded (without background processing)', description: 'AI processing unavailable, original photo saved.' });
        }
      } catch {
        toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
      }
    } finally {
      setProcessing(false);
    }
  }, [applicationId, onUploaded, toast]);

  const handleFileUpload = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max 2MB allowed', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => processAndUpload(reader.result as string);
    reader.readAsDataURL(file);
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 480, height: 640 },
      });
      streamRef.current = stream;
      setShowWebcam(true);
    } catch {
      toast({ title: 'Camera access denied', description: 'Please allow camera permission', variant: 'destructive' });
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    stopWebcam();
    processAndUpload(dataUrl);
  };

  const stopWebcam = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setShowWebcam(false);
  };

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">
            Passport Photo <span className="text-destructive">*</span>
          </h4>
          {preview && !processing && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setPreview(null); }}>
              <RotateCcw className="h-3 w-3 mr-1" /> Retake
            </Button>
          )}
        </div>

        <div className="p-3 rounded-lg bg-muted/50 border border-border/40">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>• White or light background preferred</li>
              <li>• Face clearly visible, front-facing, bust level</li>
              <li>• No caps, sunglasses, or face coverings</li>
              <li>• JPG or PNG, max 2MB</li>
            </ul>
          </div>
        </div>

        {processing && (
          <div className="flex flex-col items-center gap-2 py-6">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-xs text-muted-foreground">Processing photo & removing background…</p>
          </div>
        )}

        {preview && !processing && (
          <div className="flex justify-center">
            <img src={preview} alt="Passport photo" className="w-32 h-40 object-cover rounded-lg border border-border" />
          </div>
        )}

        {/* Always render video element, hide when not active */}
        <div className={showWebcam && !processing ? "space-y-3" : "hidden"}>
          <video ref={videoRef} className="w-full max-w-xs mx-auto rounded-lg border border-border" autoPlay playsInline muted />
          <div className="flex justify-center gap-3">
            <Button onClick={capturePhoto} size="sm" className="gap-2">
              <Camera className="h-4 w-4" /> Capture
            </Button>
            <Button onClick={stopWebcam} variant="outline" size="sm">Cancel</Button>
          </div>
        </div>

        {!preview && !processing && !showWebcam && (
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" size="sm" className="gap-2 flex-1" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> Upload Photo
            </Button>
            <Button variant="outline" size="sm" className="gap-2 flex-1" onClick={startWebcam}>
              <Camera className="h-4 w-4" /> Use Webcam
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
            />
          </div>
        )}

        {preview && !processing && (
          <div className="flex items-center gap-2 text-primary">
            <CheckCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Photo uploaded</span>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </CardContent>
    </Card>
  );
}
