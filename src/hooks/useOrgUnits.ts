// Campus → institution → department, loaded once.
//
// Every dialog that needs this cascade currently re-implements it with three
// chained queries (AddStudentDialog, BulkStudentImportDialog). That works for a
// single form but not for the HR verification table, where 200 rows each need
// their own filtered institution list. All three tables are small (tens of
// rows), so fetch them once and filter in memory.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Campus { id: string; name: string; code: string | null }
export interface Institution { id: string; name: string; code: string | null; campus_id: string }
export interface Department { id: string; name: string; code: string | null; institution_id: string }

// Roles the students RLS already scopes to an assigned campus. Mirrored here so
// HR staff at one campus don't get a picker full of campuses they can't touch.
const CAMPUS_SCOPED_ROLES = new Set(["office_assistant", "school_coordinator", "principal"]);

export function useOrgUnits() {
  const { role } = useAuth();
  const [allCampuses, setAllCampuses] = useState<Campus[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [assignedCampus, setAssignedCampus] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      const [cam, inst, dept, prof] = await Promise.all([
        supabase.from("campuses").select("id, name, code").order("name"),
        supabase.from("institutions").select("id, name, code, campus_id").order("name"),
        supabase.from("departments").select("id, name, code, institution_id").order("name"),
        uid
          ? supabase.from("profiles").select("campus").eq("user_id", uid).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setAllCampuses((cam.data as Campus[]) || []);
      setInstitutions((inst.data as Institution[]) || []);
      setDepartments((dept.data as Department[]) || []);
      setAssignedCampus((prof.data as { campus?: string } | null)?.campus || "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const campuses = useMemo(() => {
    if (!role || !CAMPUS_SCOPED_ROLES.has(role)) return allCampuses;
    const assigned = assignedCampus.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (assigned.length === 0) return allCampuses;
    return allCampuses.filter(
      (c) => assigned.includes(c.name.toLowerCase()) || assigned.includes((c.code || "").toLowerCase()),
    );
  }, [allCampuses, assignedCampus, role]);

  const institutionsFor = (campusId: string | null | undefined) =>
    campusId ? institutions.filter((i) => i.campus_id === campusId) : [];
  const departmentsFor = (institutionId: string | null | undefined) =>
    institutionId ? departments.filter((d) => d.institution_id === institutionId) : [];

  /**
   * Resolve a free-text campus/institution/department name from an imported
   * sheet to an id. Matches on name or code, case-insensitively.
   */
  const matchByName = <T extends { id: string; name: string; code: string | null }>(
    list: T[],
    raw: string | null | undefined,
  ): string => {
    const q = (raw || "").trim().toLowerCase();
    if (!q) return "";
    return list.find((x) => x.name.toLowerCase() === q || (x.code || "").toLowerCase() === q)?.id || "";
  };

  return {
    loading,
    campuses,
    allCampuses,
    institutions,
    departments,
    institutionsFor,
    departmentsFor,
    matchByName,
    /** Auto-select when the user is scoped to exactly one campus. */
    lockedCampusId: campuses.length === 1 ? campuses[0].id : "",
  };
}
