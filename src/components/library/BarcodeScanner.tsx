// Camera barcode scanner for the web Library module.
//
// Prefers the native BarcodeDetector API (Chrome/Edge/Android — fast, no bundle
// cost). Falls back to ZXing, lazily imported only when a scan starts, so it is
// code-split and never loads for users who don't scan. Uses the rear camera and
// works on a phone browser; the surrounding pages are laid out mobile-first.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { IScannerControls } from "@zxing/browser";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];

export function BarcodeScanner({
  open,
  onClose,
  onDetected,
  title,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep callbacks in refs so a parent re-render doesn't restart the camera.
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onDetectedRef.current = onDetected;
    onCloseRef.current = onClose;
  }, [onDetected, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let controls: IScannerControls | null = null;

    const cleanup = () => {
      if (raf) cancelAnimationFrame(raf);
      try {
        controls?.stop();
      } catch {
        /* already stopped */
      }
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const finish = (raw: string) => {
      const value = raw.trim();
      if (cancelled || !value) return;
      cancelled = true;
      cleanup();
      onDetectedRef.current(value);
      onCloseRef.current();
    };

    (async () => {
      const video = videoRef.current;
      if (!video) return;
      setError(null);
      try {
        const DetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        if (DetectorCtor) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
          video.srcObject = stream;
          await video.play();
          const detector = new DetectorCtor({ formats: NATIVE_FORMATS });
          const loop = async () => {
            if (cancelled) return;
            try {
              const codes = await detector.detect(video);
              const first = codes?.[0]?.rawValue;
              if (first) {
                finish(first);
                return;
              }
            } catch {
              /* transient detect error; keep scanning */
            }
            raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            video,
            (result) => {
              if (result) finish(result.getText());
            },
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera unavailable — enter the code manually.");
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between p-4 text-white">
        <p className="text-sm font-semibold">{title || "Scan barcode"}</p>
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-x-10 top-1/2 h-0.5 -translate-y-1/2 bg-destructive shadow-[0_0_14px_3px_rgba(239,68,68,0.8)]" />
      </div>
      <div className="p-4 text-center text-sm text-white/80">
        {error || "Point the rear camera at the barcode"}
      </div>
    </div>
  );
}
