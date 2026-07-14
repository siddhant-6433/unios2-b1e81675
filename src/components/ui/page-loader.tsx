import { cn } from "@/lib/utils";

function BladeSpinner({ size = 20, className }: { size?: number; className?: string }) {
  const color = "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cn("animate-spin text-primary", className)}>
      <path fillOpacity={0.2} d="M24 12C24 18.6274 18.6274 24 12 24C5.37258 24 0 18.6274 0 12C0 5.37258 5.37258 0 12 0C18.6274 0 24 5.37258 24 12ZM3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12Z" fill={color} />
      <path d="M24 12C24 13.8937 23.5518 15.7606 22.6921 17.4479C21.8324 19.1352 20.5855 20.5951 19.0534 21.7082C17.5214 22.8213 15.7476 23.556 13.8772 23.8523C12.0068 24.1485 10.0928 23.9979 8.29181 23.4127L9.21886 20.5595C10.5696 20.9984 12.0051 21.1114 13.4079 20.8892C14.8107 20.667 16.141 20.116 17.2901 19.2812C18.4391 18.4463 19.3743 17.3514 20.0191 16.0859C20.6639 14.8204 21 13.4203 21 12H24Z" fill={color} />
      <path d="M0 12C0 10.1063 0.448176 8.23944 1.30791 6.55211C2.16764 4.86479 3.41451 3.4049 4.94656 2.2918C6.47862 1.17869 8.25236 0.443983 10.1228 0.147739C11.9932 -0.148504 13.9072 0.00213 15.7082 0.587322L14.7811 3.44049C13.4304 3.0016 11.9949 2.88862 10.5921 3.11081C9.18927 3.33299 7.85896 3.88402 6.70992 4.71885C5.56088 5.55367 4.62573 6.64859 3.98093 7.91409C3.33613 9.17958 3 10.5797 3 12H0Z" fill={color} />
    </svg>
  );
}

function SkeletonBar({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={cn("rounded-lg blade-skeleton", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}

export function PageLoader({ className, variant = "default" }: {
  className?: string;
  variant?: "default" | "table" | "cards" | "detail";
}) {
  if (variant === "table") {
    return (
      <div className={cn("space-y-0 animate-rs-slide-up", className)}>
        <div className="h-10 rounded-t-lg blade-skeleton" />
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="flex gap-4 border-b border-border/20 px-4 py-3" style={{ animationDelay: `${i * 60}ms` }}>
            <SkeletonBar className="h-4 w-24" delay={i * 60} />
            <SkeletonBar className="h-4 w-32 flex-1" delay={i * 60 + 30} />
            <SkeletonBar className="h-4 w-20" delay={i * 60 + 60} />
            <SkeletonBar className="h-4 w-16" delay={i * 60 + 90} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div className={cn("space-y-4 animate-rs-slide-up", className)}>
        <SkeletonBar className="h-6 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <SkeletonBar key={i} className="h-28 rounded-xl" delay={i * 80} />
          ))}
        </div>
        <SkeletonBar className="h-48 rounded-xl" delay={400} />
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div className={cn("flex gap-6 animate-rs-slide-up", className)}>
        <div className="w-1/3 space-y-3">
          <SkeletonBar className="h-32 rounded-xl" />
          <SkeletonBar className="h-20 rounded-xl" delay={100} />
          <SkeletonBar className="h-20 rounded-xl" delay={200} />
        </div>
        <div className="flex-1 space-y-3">
          <SkeletonBar className="h-8 w-64" />
          <SkeletonBar className="h-4 w-96" delay={80} />
          <SkeletonBar className="h-64 rounded-xl" delay={160} />
        </div>
      </div>
    );
  }

  // Default: title + subtitle + content rows + indeterminate bar at top
  return (
    <div className={cn("space-y-4 animate-rs-slide-up", className)}>
      <div className="blade-indeterminate h-0.5 w-full rounded-full bg-primary/20" />
      <div className="space-y-2">
        <SkeletonBar className="h-6 w-48" />
        <SkeletonBar className="h-4 w-72" delay={60} />
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map(i => (
          <SkeletonBar key={i} className="h-16 w-full rounded-xl" delay={120 + i * 80} />
        ))}
      </div>
    </div>
  );
}

export { BladeSpinner };
