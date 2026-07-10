import { cn } from "@/lib/utils";

export function PageLoader({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-20", className)}>
      <div className="flex gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-primary/50 animate-bounce [animation-delay:0ms]" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary/50 animate-bounce [animation-delay:150ms]" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary/50 animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="text-xs text-muted-foreground">Loading…</span>
    </div>
  );
}
