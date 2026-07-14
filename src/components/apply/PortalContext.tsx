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

export function PortalProvider({
  children,
  overridePortalId,
}: {
  children: React.ReactNode;
  overridePortalId?: PortalId | null;
}) {
  const location = useLocation();

  const portalId = useMemo<PortalId>(
    () => overridePortalId || detectPortal(location.search, location.pathname),
    [location.search, location.pathname, overridePortalId]
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
