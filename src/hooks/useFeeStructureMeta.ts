import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { FeeStructureMetadata } from "@/lib/feeTermLabels";

/**
 * Resolve the display metadata of a course's active fee structure.
 *
 * `fee_structures.metadata` is where a programme declares how its collection
 * periods are named — `period_label: "Semester"` plus per-term `year_N.label`
 * ("Sem 1"). D.AOTT's stetho_batch structure bills 5 semesters but, like every
 * other programme, stores them under `year_1..year_5` terms, so the term string
 * alone cannot tell you whether "year_2" is a year or a semester. Only this
 * metadata can.
 *
 * Resolution is by course (preferring the student's own session), NOT by
 * `students.fee_structure_version` — that column is null for every student in
 * production — and not by `courses.type`, which says 'semester' for 21 courses
 * whose fees really are annual.
 *
 * RLS: policy `public_read_fee_structures` is SELECT USING (true) for anon and
 * authenticated, so the anonymous applicant portal can read this too.
 */

const FIELDS = "id, version, session_id, metadata, created_at";

type StructureRow = {
  id: string;
  version: string | null;
  session_id: string | null;
  metadata: FeeStructureMetadata;
  created_at: string | null;
};

export interface ResolvedFeeStructure {
  version: string | null;
  metadata: FeeStructureMetadata;
}

// Prefer the structure attached to the student's admission session; otherwise
// take the most recently created active one for the course.
function pick(rows: StructureRow[], sessionId?: string | null): StructureRow | null {
  if (!rows.length) return null;
  if (sessionId) {
    const exact = rows.find((r) => r.session_id === sessionId);
    if (exact) return exact;
  }
  return rows[0];
}

export function useFeeStructureMeta(
  courseId?: string | null,
  sessionId?: string | null,
): ResolvedFeeStructure {
  const [resolved, setResolved] = useState<ResolvedFeeStructure>({ version: null, metadata: null });

  useEffect(() => {
    let cancelled = false;
    if (!courseId) {
      setResolved({ version: null, metadata: null });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("fee_structures")
        .select(FIELDS)
        .eq("course_id", courseId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const row = pick((data || []) as StructureRow[], sessionId);
      setResolved({ version: row?.version ?? null, metadata: row?.metadata ?? null });
    })();
    return () => { cancelled = true; };
  }, [courseId, sessionId]);

  return resolved;
}

/**
 * List surfaces (finance dashboards, due reports, partner portal) show ledger
 * rows across many courses at once. One query for every course on screen beats
 * a hook per row.
 */
export function useFeeStructureMetaByCourse(
  courseIds: (string | null | undefined)[],
): Record<string, FeeStructureMetadata> {
  const [map, setMap] = useState<Record<string, FeeStructureMetadata>>({});
  const key = Array.from(new Set(courseIds.filter(Boolean) as string[])).sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    if (!ids.length) {
      setMap({});
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("fee_structures")
        .select(`course_id, ${FIELDS}`)
        .in("course_id", ids)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const next: Record<string, FeeStructureMetadata> = {};
      // Rows arrive newest-first; keep the first one seen per course.
      for (const row of (data || []) as (StructureRow & { course_id: string })[]) {
        if (!(row.course_id in next)) next[row.course_id] = row.metadata ?? null;
      }
      setMap(next);
    })();
    return () => { cancelled = true; };
  }, [key]);

  return map;
}
