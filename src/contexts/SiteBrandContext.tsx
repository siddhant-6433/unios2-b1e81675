import { createContext, useContext } from "react";
import { getSiteBrand } from "@/lib/siteBranding";

const SiteBrandContext = createContext<ReturnType<typeof getSiteBrand> | null>(null);

export function SiteBrandProvider({ children }: { children: React.ReactNode }) {
  const brand = getSiteBrand();
  // The hostname is staged until the same release is enabled on the server.
  const enabled = import.meta.env.VITE_MIRAI_ROLLOUT_ENABLED === "true";
  return <SiteBrandContext.Provider value={brand}>
    {brand.isMirai && !enabled ? (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background p-6 text-center">
        <img src={brand.logo} alt={brand.logoAlt} className="h-20 w-56 object-contain" />
        <h1 className="text-2xl font-semibold">Mirai Uni is coming soon</h1>
        <p className="text-muted-foreground">Please use your current school portal until launch.</p>
      </main>
    ) : children}
  </SiteBrandContext.Provider>;
}

export function useSiteBrand() {
  return useContext(SiteBrandContext) ?? getSiteBrand();
}
