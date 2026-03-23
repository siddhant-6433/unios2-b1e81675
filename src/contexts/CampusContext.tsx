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
        setCampuses(data as Campus[]);

        // Non-super-admins: pre-select their campus if profile.campus matches a campus name
        if (role && role !== "super_admin" && profile?.campus) {
          const match = data.find(
            (c) => c.name.toLowerCase() === profile.campus!.toLowerCase()
          );
          if (match) setSelectedCampusId(match.id);
        }
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
