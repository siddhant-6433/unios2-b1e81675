import type { ReactNode } from "react";

export const academicInput = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-ring";

export function AcademicField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block space-y-1.5 text-sm font-medium"><span>{label}</span>{children}{hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
}

export function AcademicPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="rounded-xl border border-border bg-card p-5 space-y-4"><div><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>{children}</section>;
}

export function AcademicError({ message }: { message: string | null }) {
  return message ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{message}</div> : null;
}

export function readableAcademicError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "The request could not be completed. Please try again.";
  if (/stale|version|concurrent/i.test(message)) return "Someone updated this report while you were working. Refresh it before making further changes. Your unsaved entries remain on screen. " + message;
  return message;
}

/** Empty means missing; numeric zero is a real, entered mark. */
export function markFromInput(value: string): number | null {
  if (!value.trim()) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error("Enter a finite numeric mark.");
  return numeric;
}
