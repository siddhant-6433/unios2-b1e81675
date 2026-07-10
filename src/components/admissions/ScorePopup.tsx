import { useState, useEffect } from "react";

interface ScorePopupProps {
  points: number;
  label: string;
  visible: boolean;
  onDone?: () => void;
}

export function ScorePopup({ points, label, visible, onDone }: ScorePopupProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        onDone?.();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!show) return null;

  const isPositive = points > 0;

  return (
    <div className="fixed top-20 right-6 z-50 animate-bounce-in pointer-events-none">
      <div className={`rounded-xl px-5 py-3 shadow-lg border ${
        isPositive
          ? "bg-success/5 dark:bg-success/90/50 border-success/20 dark:border-success/60"
          : "bg-destructive/5 dark:bg-destructive/90/50 border-destructive/20 dark:border-destructive/50"
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-black ${isPositive ? "text-success" : "text-destructive"}`}>
            {isPositive ? `+${points}` : points}
          </span>
          <div>
            <p className={`text-sm font-semibold ${isPositive ? "text-success-foreground dark:text-success/60" : "text-destructive dark:text-destructive/60"}`}>
              {label}
            </p>
            <p className="text-[10px] text-muted-foreground">Score updated</p>
          </div>
        </div>
      </div>
    </div>
  );
}
