import { createContext, useContext, useState, type ReactNode } from "react";

interface CounsellorFilterContextType {
  counsellorFilter: string;
  setCounsellorFilter: (id: string) => void;
}

const CounsellorFilterContext = createContext<CounsellorFilterContextType>({
  counsellorFilter: "all",
  setCounsellorFilter: () => {},
});

export function CounsellorFilterProvider({ children }: { children: ReactNode }) {
  const [counsellorFilter, setCounsellorFilter] = useState("all");
  return (
    <CounsellorFilterContext.Provider value={{ counsellorFilter, setCounsellorFilter }}>
      {children}
    </CounsellorFilterContext.Provider>
  );
}

export function useCounsellorFilter() {
  return useContext(CounsellorFilterContext);
}
