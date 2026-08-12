import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { variant?: "default" | "success" | "warning" | "destructive" }
>(({ className, value, variant = "default", ...props }, ref) => {
  const v = value || 0;
  const isComplete = v >= 100;
  const indicatorColor = {
    default: isComplete ? "bg-success" : "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
  }[variant];
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn("relative h-2 w-full overflow-hidden rounded bg-muted", isComplete && "animate-rs-success-pulse", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 transition-all duration-960 ease-emphasized blade-progress-pulse", indicatorColor)}
        style={{ transform: `translateX(-${100 - v}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
