import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export interface Campus {
  id: string;
  name: string;
  code: string;
}

const NO_ASSIGNED_CAMPUS_ID = "00000000-0000-0000-0000-000000000000";

// Roles whose data access is org-wide rather than scoped to an assigned campus.
// Mirrors the database: super_admin bypasses campus RLS entirely, and
// admission_head is granted org-wide read (see the admission-head org-wide
// campus scope migration). Every other staff role is restricted to its assigned
// campus(es) and fails closed to NO_ASSIGNED_CAMPUS_ID when it has none.
//
// This exists so the "no assigned campus" sentinel is never treated as a real
// campus filter by callers that do `selectedCampusId !== "all"`. Passing the
// sentinel UUID through produced queries like `campus_id = '000...0'`, which
// match nothing and blanked the whole CRM for an unassigned admission head.
const ORG_WIDE_CAMPUS_ROLES = new Set(["super_admin", "admission_head"]);

interface CampusContextType {
  campuses: Campus[];
  selectedCampusId: string; // "all" | NO_ASSIGNED_CAMPUS_ID | uuid
  setSelectedCampusId: (id: string) => void;
  selectedCampusName: string;
  canSelectAllCampuses: boolean;
  loading: boolean;
}

const CampusContext = createContext<CampusContextType>({
  campuses: [],
  selectedCampusId: "all",
  setSelectedCampusId: () => {},
  selectedCampusName: "All Campuses",
  canSelectAllCampuses: false,
  loading: true,
});

export const useCampus = () => useContext(CampusContext);

export const CampusProvider = ({ children }: { children: ReactNode }) => {
  const { role, profile } = useAuth();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [selectedCampusId, setSelectedCampusId] = useState("all");
  const [loading, setLoading] = useState(true);
  const canSelectAllCampuses = role !== null && ORG_WIDE_CAMPUS_ROLES.has(role);

  const chooseCampus = (id: string) => {
    if (id === "all" && !canSelectAllCampuses) return;
    setSelectedCampusId(id);
  };

  useEffect(() => {
    setLoading(true);
    if (!role) {
      setCampuses([]);
      setSelectedCampusId(NO_ASSIGNED_CAMPUS_ID);
      setLoading(false);
      return;
    }
    supabase
      .from("campuses")
      .select("id, name, code")
      .order("name")
      .then(({ data }) => {
        if (!data) { setLoading(false); return; }
        let visibleCampuses = data as Campus[];

        // Campus-scoped roles see only their assigned campuses. If their
        // profile has no matching campus assignment, fail closed instead of
        // falling back to "all". Org-wide roles (super_admin, admission_head)
        // are never scoped and default to all campuses.
        if (role && !ORG_WIDE_CAMPUS_ROLES.has(role)) {
          const assignedNames = (profile?.campus || "")
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
          const matches = data.filter(
            (c) => assignedNames.includes(c.name.toLowerCase()) || assignedNames.includes(c.code.toLowerCase())
          );
          visibleCampuses = matches;
          if (matches.length > 0) {
            setSelectedCampusId(matches[0].id);
          } else {
            setSelectedCampusId(NO_ASSIGNED_CAMPUS_ID);
          }
        } else {
          setSelectedCampusId("all");
        }

        setCampuses(visibleCampuses);
        setLoading(false);
      });
  }, [role, profile?.campus]);

  const selectedCampusName =
    selectedCampusId === "all"
      ? "All Campuses"
      : selectedCampusId === NO_ASSIGNED_CAMPUS_ID
        ? "No assigned campus"
      : campuses.find((c) => c.id === selectedCampusId)?.name ?? "All Campuses";

  return (
    <CampusContext.Provider
      value={{ campuses, selectedCampusId, setSelectedCampusId: chooseCampus, selectedCampusName, canSelectAllCampuses, loading }}
    >
      {children}
    </CampusContext.Provider>
  );
};
