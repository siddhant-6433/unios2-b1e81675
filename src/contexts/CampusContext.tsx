import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export interface Campus {
  id: string;
  name: string;
  code: string;
}

const NO_ASSIGNED_CAMPUS_ID = "00000000-0000-0000-0000-000000000000";

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
  const canSelectAllCampuses = role === "super_admin";

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

        if (role && role !== "super_admin") {
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
