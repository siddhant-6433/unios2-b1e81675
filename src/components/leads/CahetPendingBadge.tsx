import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Flame } from "lucide-react";
import {
  CahetRegisterDialog,
  isBptOrBmritCourse,
  type CahetRegisterTarget,
} from "@/components/leads/CahetRegisterDialog";

interface Props {
  leadId: string;
  leadName: string;
  phone?: string | null;
  courseName?: string | null;
  /**
   * When provided by the parent (from a batched cahet_registrations query),
   * skips the per-row DB lookup entirely. Pass `null` while the batch is
   * in-flight; pass `true`/`false` once resolved.
   * When omitted (undefined), the badge falls back to its own per-row fetch.
   */
  registeredOverride?: boolean | null;
  /** Optional callback fired after a successful registration save. */
  onRegistered?: () => void;
}

export function CahetPendingBadge({ leadId, leadName, phone, courseName, registeredOverride, onRegistered }: Props) {
  // If courseName is provided we can check eligibility client-side (free).
  // If it's not (e.g., followups view doesn't carry course), we fetch the
  // course name once for this lead. Slightly more DB chatter, but keeps the
  // badge usable everywhere without forcing every caller to join courses.
  const courseProvided = courseName !== undefined;
  const [resolvedCourse, setResolvedCourse] = useState<string | null | undefined>(
    courseProvided ? courseName : undefined,
  );
  const eligible = isBptOrBmritCourse(resolvedCourse);
  // When the parent provides registeredOverride, we use it directly and skip
  // the per-row fetch. fetchedRegistered is only populated in the fallback path.
  const [fetchedRegistered, setFetchedRegistered] = useState<boolean | null>(null);
  const registered = registeredOverride !== undefined ? registeredOverride : fetchedRegistered;
  const [open, setOpen] = useState<CahetRegisterTarget | null>(null);

  // Lazy course fetch when caller didn't pass it.
  useEffect(() => {
    if (courseProvided) return;
    let cancelled = false;
    supabase
      .from("leads")
      .select("courses:course_id(name)")
      .eq("id", leadId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const name = (data as any)?.courses?.name ?? null;
        setResolvedCourse(name);
      });
    return () => { cancelled = true; };
  }, [courseProvided, leadId]);

  // Per-row cahet registration check — skipped when parent provides registeredOverride.
  useEffect(() => {
    if (registeredOverride !== undefined) return;
    if (!eligible) return;
    let cancelled = false;
    supabase
      .from("cahet_registrations")
      .select("id")
      .eq("lead_id", leadId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setFetchedRegistered(!!data);
      });
    return () => { cancelled = true; };
  }, [registeredOverride, eligible, leadId]);

  if (!eligible) return null;
  if (registered) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 text-[10px] font-semibold">
        <Flame className="h-3 w-3" /> CAHET ✓ registered
      </span>
    );
  }
  if (registered === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen({ lead_id: leadId, lead_name: leadName, phone, course_name: courseName })}
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 px-2 py-0.5 text-[10px] font-semibold transition-colors"
        title="Mark CAHET registration for this lead"
      >
        <Flame className="h-3 w-3" /> CAHET pending — register
      </button>
      <CahetRegisterDialog
        target={open ? { ...open, course_name: resolvedCourse ?? open.course_name ?? null } : null}
        onClose={() => setOpen(null)}
        onSaved={() => {
          setOpen(null);
          setRegistered(true);
          onRegistered?.();
        }}
      />
    </>
  );
}
