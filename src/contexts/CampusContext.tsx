import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export interface Campus {
  id: string;
  name: string;
  code: string;
}

interface CampusContextType {
  campuses: Campus[];
  selectedCampusId: string; // "all" | uuid
  setSelectedCampusId: (id: string) => void;
  selectedCampusName: string;
  loading: boolean;
}

const CampusContext = createContext<CampusContextType>({
  campuses: [],
  selectedCampusId: "all",
  setSelectedCampusId: () => {},
  selectedCampusName: "All Campuses",
  loading: true,
});

export const useCampus = () => useContext(CampusContext);

export const CampusProvider = ({ children }: { children: ReactNode }) => {
  const { role, profile } = useAuth();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [selectedCampusId, setSelectedCampusId] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("campuses")
      .select("id, name, code")
      .order("name")
      .then(({ data }) => {
        if (!data) { setLoading(false); return; }
        let visibleCampuses = data as Campus[];

        // Office assistants are branch-scoped. The database enforces the same
        // profile.campus -> campuses.name/code match via RLS helper functions.
        if (role && role !== "super_admin" && profile?.campus) {
          const assignedNames = profile.campus.split(",").map((s) => s.trim().toLowerCase());
          const matches = data.filter(
            (c) => assignedNames.includes(c.name.toLowerCase()) || assignedNames.includes(c.code.toLowerCase())
          );
          if (role === "office_assistant" || role === "school_coordinator") {
            visibleCampuses = matches.length ? matches : [];
          }
          if (matches.length > 0) {
            setSelectedCampusId(matches[0].id);
          } else if (role === "office_assistant" || role === "school_coordinator") {
            setSelectedCampusId("all");
          }
        }

        setCampuses(visibleCampuses);
        setLoading(false);
      });
  }, [role, profile?.campus]);

  const selectedCampusName =
    selectedCampusId === "all"
      ? "All Campuses"
      : campuses.find((c) => c.id === selectedCampusId)?.name ?? "All Campuses";

  return (
    <CampusContext.Provider
      value={{ campuses, selectedCampusId, setSelectedCampusId, selectedCampusName, loading }}
    >
      {children}
    </CampusContext.Provider>
  );
};
