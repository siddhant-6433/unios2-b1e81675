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
          ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800"
          : "bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800"
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-black ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
            {isPositive ? `+${points}` : points}
          </span>
          <div>
            <p className={`text-sm font-semibold ${isPositive ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}`}>
              {label}
            </p>
            <p className="text-[10px] text-muted-foreground">Score updated</p>
          </div>
        </div>
      </div>
    </div>
  );
}
