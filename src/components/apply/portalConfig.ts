import nimtLogo from "@/assets/mirai-logo-dark.svg"; // placeholder for NIMT — reuse dark logo
import miraiLogoGreen from "@/assets/mirai-logo-green.svg";

export type PortalId = "nimt" | "mirai";

export interface PortalConfig {
  id: PortalId;
  name: string;
  tagline: string;
  logo: string;
  /** CSS custom-property overrides applied to :root when this portal loads */
  cssVars: Record<string, string>;
  /** Only show courses from these institution types (empty = all) */
  institutionTypes: string[];
  /** Filter course names matching these keywords (empty = all) */
  gradeKeywords: string[];
  /** Program categories visible in this portal */
  programCategories: string[];
}

export const PORTAL_CONFIGS: Record<PortalId, PortalConfig> = {
  nimt: {
    id: "nimt",
    name: "NIMT University",
    tagline: "Application Portal",
    logo: nimtLogo,
    cssVars: {
      // Default teal theme — no overrides needed, uses index.css defaults
    },
    institutionTypes: [], // all
    gradeKeywords: [],
    programCategories: ["undergraduate", "postgraduate", "mba_pgdm", "bed", "deled", "professional"],
  },
  mirai: {
    id: "mirai",
    name: "Mirai School",
    tagline: "Future Ready IB School",
    logo: miraiLogoGreen,
    cssVars: {
      "--primary": "100 18% 53%",           // #77966D sage green
      "--primary-foreground": "0 0% 100%",
      "--ring": "100 18% 53%",
      "--sidebar-primary": "100 18% 53%",
      "--sidebar-accent": "100 18% 90%",
      "--sidebar-accent-foreground": "100 18% 35%",
      "--accent": "100 15% 93%",
      "--accent-foreground": "100 18% 30%",
    },
    institutionTypes: ["school"],
    gradeKeywords: ["nursery", "lkg", "ukg", "toddler", "montessori", "grade", "class", "playgroup", "pre-primary"],
    programCategories: ["school"],
  },
};

/**
 * Detect portal from URL: /apply?portal=mirai or /apply/mirai
 */
export function detectPortal(search: string, pathname: string): PortalId {
  const params = new URLSearchParams(search);
  const fromQuery = params.get("portal")?.toLowerCase();
  if (fromQuery && fromQuery in PORTAL_CONFIGS) return fromQuery as PortalId;

  // Check path segments: /apply/mirai
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1]?.toLowerCase();
  if (last && last in PORTAL_CONFIGS) return last as PortalId;

  return "nimt"; // default
}

/**
 * Apply portal CSS variables to document root
 */
export function applyPortalTheme(config: PortalConfig) {
  const root = document.documentElement;
  Object.entries(config.cssVars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

/**
 * Remove portal CSS variables (restore defaults)
 */
export function removePortalTheme(config: PortalConfig) {
  const root = document.documentElement;
  Object.keys(config.cssVars).forEach((key) => {
    root.style.removeProperty(key);
  });
}
