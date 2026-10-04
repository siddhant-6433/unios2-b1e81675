import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { getSiteBrand, canonicalApplicationUrl, initializeSiteBranding, MIRAI_THEME } from "@/lib/siteBranding";
import { applyPortalTheme, removePortalTheme, PORTAL_CONFIGS, detectPortal } from "@/components/apply/portalConfig";
import { SiteBrandProvider } from "@/contexts/SiteBrandContext";

function hostname(host: string) {
  vi.spyOn(window, "location", "get").mockReturnValue(new URL(`https://${host}/`) as unknown as Location);
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.documentElement.removeAttribute("style");
});

describe("Mirai website branding", () => {
  it("changes only the exact Mirai app hostname", () => {
    expect(getSiteBrand("uni.miraischool.in").isMirai).toBe(true);
    for (const host of ["uni.nimt.ac.in", "localhost", "uni.miraischool.in.evil.test", "preview.netlify.app"]) {
      expect(getSiteBrand(host).title).toBe("NIMT UniOs");
    }
  });
  it("restores Mirai colours after a nested portal changes and releases them", () => {
    hostname("uni.miraischool.in");
    initializeSiteBranding();
    applyPortalTheme(PORTAL_CONFIGS.beacon);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("227 100% 50%");
    removePortalTheme(PORTAL_CONFIGS.beacon);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(MIRAI_THEME["--primary"]);
    expect(document.title).toBe("Mirai Uni");
  });
  it("restores original CSS defaults on the NIMT hostname", () => {
    hostname("uni.nimt.ac.in");
    applyPortalTheme(PORTAL_CONFIGS.mirai);
    removePortalTheme(PORTAL_CONFIGS.mirai);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });
  it("defaults fresh Mirai applications to Mirai even with conflicting query parameters", () => {
    hostname("uni.miraischool.in");
    expect(detectPortal("?portal=nimt", "/apply/beacon")).toBe("mirai");
  });
  it("holds the Mirai domain until rollout is explicitly enabled", () => {
    hostname("uni.miraischool.in");
    vi.stubEnv("VITE_MIRAI_ROLLOUT_ENABLED", "false");
    render(<SiteBrandProvider><p>Actual portal</p></SiteBrandProvider>);
    expect(screen.getByText("Mirai Uni is coming soon")).toBeInTheDocument();
    expect(screen.queryByText("Actual portal")).not.toBeInTheDocument();
  });
  it("renders the existing app on Mirai after activation", () => {
    hostname("uni.miraischool.in");
    vi.stubEnv("VITE_MIRAI_ROLLOUT_ENABLED", "true");
    render(<SiteBrandProvider><p>Actual portal</p></SiteBrandProvider>);
    expect(screen.getByText("Actual portal")).toBeInTheDocument();
  });
  it("does not hold the NIMT app when Mirai rollout is disabled", () => {
    hostname("uni.nimt.ac.in");
    vi.stubEnv("VITE_MIRAI_ROLLOUT_ENABLED", "false");
    render(<SiteBrandProvider><p>Actual portal</p></SiteBrandProvider>);
    expect(screen.getByText("Actual portal")).toBeInTheDocument();
  });
});

describe("saved application domain routing", () => {
  it("preserves tokens, offer view, attribution and hash when redirecting Mirai", () => {
    expect(canonicalApplicationUrl("https://uni.nimt.ac.in/apply?token=abc&view=offer&utm_source=wa#fees", "mirai", true))
      .toBe("https://uni.miraischool.in/apply?token=abc&view=offer&utm_source=wa#fees");
  });
  it.each(["nimt", "beacon"] as const)("moves %s applications off the Mirai domain", portal => {
    expect(canonicalApplicationUrl("https://uni.miraischool.in/apply?token=abc#documents", portal, true))
      .toBe(`https://uni.nimt.ac.in/apply/${portal}?token=abc#documents`);
  });
  it("does not redirect local previews, the correct domain, or before activation", () => {
    expect(canonicalApplicationUrl("http://localhost:8080/apply?token=abc", "mirai", true)).toBeNull();
    expect(canonicalApplicationUrl("https://uni.miraischool.in/apply?token=abc", "mirai", true)).toBeNull();
    expect(canonicalApplicationUrl("https://uni.nimt.ac.in/apply?token=abc", "mirai", false)).toBeNull();
  });
});
