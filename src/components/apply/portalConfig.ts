import miraiLogoGreen from "@/assets/mirai-logo-green.svg";
import nimtBeaconLogo from "@/assets/nimt-beacon-logo.png";

export type PortalId = "nimt" | "beacon" | "mirai";

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
  /** Filter courses based on their associated campus names (empty = all) */
  campusKeywords: string[];
  /** Program categories visible in this portal */
  programCategories: string[];
  /** Hostnames that auto-resolve to this portal */
  hostnames: string[];
}

export const PORTAL_CONFIGS: Record<PortalId, PortalConfig> = {
  nimt: {
    id: "nimt",
    name: "NIMT University",
    tagline: "Application Portal",
    logo: nimtBeaconLogo, // fallback — replace with dedicated NIMT University logo when available
    cssVars: {
      // Default teal theme — uses index.css defaults
    },
    institutionTypes: ["university", "college"],
    gradeKeywords: [],
    campusKeywords: [],
    programCategories: ["undergraduate", "postgraduate", "mba_pgdm", "bed", "deled", "professional"],
    hostnames: [],
  },
  beacon: {
    id: "beacon",
    name: "NIMT Beacon School",
    tagline: "Future Ready CBSE School",
    logo: nimtBeaconLogo,
    cssVars: {
      "--primary": "227 100% 50%",            // #0044FF vivid blue
      "--primary-foreground": "0 0% 100%",
      "--ring": "227 100% 50%",
      "--sidebar-primary": "227 100% 50%",
      "--sidebar-accent": "227 100% 95%",
      "--sidebar-accent-foreground": "227 100% 35%",
      "--accent": "227 80% 95%",
      "--accent-foreground": "227 100% 30%",
    },
    institutionTypes: ["school"],
    gradeKeywords: [
      "nursery", "lkg", "ukg", "toddler", "montessori", "grade", "class", "std", "primary", "secondary", "senior",
      "playgroup", "pre-primary", "pre nur", "kg", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii",
      "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"
    ],
    campusKeywords: ["avantika", "arthala", "beacon", "ghaziabad"],
    programCategories: ["school"],
    hostnames: ["nimtbeaconschool.com", "www.nimtbeaconschool.com"],
  },
  mirai: {
    id: "mirai",
    name: "Mirai School",
    tagline: "Future Ready IB School",
    logo: miraiLogoGreen,
    cssVars: {
      "--primary": "100 18% 53%",             // #77966D sage green
      "--primary-foreground": "0 0% 100%",
      "--ring": "100 18% 53%",
      "--sidebar-primary": "100 18% 53%",
      "--sidebar-accent": "100 18% 90%",
      "--sidebar-accent-foreground": "100 18% 35%",
      "--accent": "100 15% 93%",
      "--accent-foreground": "100 18% 30%",
    },
    institutionTypes: ["school"],
    gradeKeywords: ["nursery", "lkg", "ukg", "toddler", "montessori", "grade", "class", "playgroup", "pre-primary", "eyp", "pyp"],
    campusKeywords: ["mirai"],
    programCategories: ["school"],
    hostnames: ["miraischool.in", "www.miraischool.in", "apply.miraischool.in"],
  },
};

/**
 * Detect portal from: 1) hostname, 2) query param, 3) path segment
 */
export function detectPortal(search: string, pathname: string): PortalId {
  // 1. Hostname detection (for custom domains)
  const hostname = window.location.hostname.toLowerCase();
  for (const config of Object.values(PORTAL_CONFIGS)) {
    if (config.hostnames.some(h => hostname === h || hostname.endsWith("." + h))) {
      return config.id;
    }
  }

  // 2. Query param: ?portal=mirai
  const params = new URLSearchParams(search);
  const fromQuery = params.get("portal")?.toLowerCase();
  if (fromQuery && fromQuery in PORTAL_CONFIGS) return fromQuery as PortalId;

  // 3. Path segment: /apply/beacon
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
