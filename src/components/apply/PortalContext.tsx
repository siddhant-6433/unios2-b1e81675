import { createContext, useContext, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  PortalConfig,
  PortalId,
  PORTAL_CONFIGS,
  detectPortal,
  applyPortalTheme,
  removePortalTheme,
} from "./portalConfig";

const PortalContext = createContext<PortalConfig>(PORTAL_CONFIGS.nimt);

export function usePortal() {
  return useContext(PortalContext);
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  const portalId = useMemo<PortalId>(
    () => detectPortal(location.search, location.pathname),
    [location.search, location.pathname]
  );

  const config = PORTAL_CONFIGS[portalId];

  useEffect(() => {
    applyPortalTheme(config);
    return () => removePortalTheme(config);
  }, [config]);

  return (
    <PortalContext.Provider value={config}>{children}</PortalContext.Provider>
  );
}
