import miraiLogoGreen from "@/assets/mirai-logo-green.svg";
import miraiMan from "@/assets/mirai-man.png";
import nimtBeaconLogo from "@/assets/nimt-beacon-logo.png";
import nimtEduInstLogo from "@/assets/nimt-edu-inst-logo.svg";
import nimtEduInstLogoWhite from "@/assets/nimt-edu-inst-logo-white.svg";
import loginBgNimt from "@/assets/login-bg-nimt.jpg";
import loginBgBeacon from "@/assets/login-bg-beacon.jpg";
import loginBgMirai from "@/assets/login-bg-mirai.png";
import nirfLogo from "@/assets/nirf-logo.png";
import greatPlaceToStudy from "@/assets/great-place-to-study.svg";

export type PortalId = "nimt" | "beacon" | "mirai";

export interface LoginBadge {
  src: string;
  alt: string;
}

export interface LoginCourseGroup {
  label: string;
  courses: string[];
}

export interface PortalConfig {
  id: PortalId;
  name: string;
  tagline: string;
  logo: string;         // for light backgrounds
  logoWhite?: string;   // for dark/coloured backgrounds
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
  /** Primary hex color for receipts and branded documents */
  primaryColor: string;
  /** CSS background value for the login page left panel */
  loginGradient: string;
  /** Background photo for login left panel */
  loginBgImage?: string;
  /** Bold headline shown on the login left panel */
  loginHeadline: string;
  /** Smaller sub-text below the headline */
  loginSubheadline?: string;
  /** Award/accreditation badge logos shown at the bottom of login left panel */
  loginBadges?: LoginBadge[];
  /** Course groups listed at the bottom of login left panel */
  loginCourses?: LoginCourseGroup[];
  /** Decorative watermark image overlaid on the left panel */
  loginWatermark?: string;
  /** When true, logo on login left panel is shown inside a white pill (for logos with light/coloured backgrounds) */
  loginLogoBg?: boolean;
}

export const PORTAL_CONFIGS: Record<PortalId, PortalConfig> = {
  nimt: {
    id: "nimt",
    name: "NIMT Educational Institutions",
    tagline: "Application Portal",
    logo: nimtEduInstLogo,
    logoWhite: nimtEduInstLogoWhite,
    cssVars: {
      // Default teal theme — uses index.css defaults
    },
    institutionTypes: ["university", "college"],
    gradeKeywords: [],
    campusKeywords: [],
    programCategories: ["undergraduate", "postgraduate", "mba_pgdm", "bed", "deled", "professional"],
    hostnames: [],
    primaryColor: "#0035C5",
    loginGradient: "linear-gradient(160deg, #000D4D 0%, #0022A0 50%, #0035C5 100%)",
    loginBgImage: loginBgNimt,
    loginHeadline: "UG / PG Admissions\n2026–27",
    loginSubheadline: "Computer Science · Allied Health · Nursing · Management · Law · Teacher Education",
    loginBadges: [
      { src: nirfLogo, alt: "NIRF Ranked" },
      { src: greatPlaceToStudy, alt: "Great Place to Study" },
    ],
    loginCourses: [
      {
        label: "Undergraduate",
        courses: ["BCA · BBA", "B.Sc Nursing · GNM", "B.Sc BMRIT · BPT · DPT · OTT · D.Pharma", "B.Ed · D.El.Ed", "BA LLB · LLB"],
      },
      {
        label: "Postgraduate",
        courses: ["MBA · PGDM", "M.Sc MMRIT · MPT"],
      },
    ],
  },
  beacon: {
    id: "beacon",
    name: "NIMT Beacon School",
    tagline: "Future Ready CBSE School",
    logo: nimtBeaconLogo,
    loginLogoBg: true,
    cssVars: {
      "--primary": "227 100% 50%",
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
    campusKeywords: ["avantika", "arthala", "beacon"],
    programCategories: ["school"],
    hostnames: ["nimtbeaconschool.com", "www.nimtbeaconschool.com"],
    primaryColor: "#0044FF",
    loginGradient: "linear-gradient(160deg, #00116B 0%, #0028CC 50%, #0044FF 100%)",
    loginBgImage: loginBgBeacon,
    loginHeadline: "CBSE School\nAdmissions 2026–27",
    loginSubheadline: "Classes Nursery to XII · Avantika & Arthala Campus",
  },
  mirai: {
    id: "mirai",
    name: "Mirai School",
    tagline: "Future Ready IB School",
    logo: miraiLogoGreen,
    loginLogoBg: true,
    cssVars: {
      "--primary": "100 18% 53%",
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
    primaryColor: "#77966D",
    loginGradient: "linear-gradient(160deg, #111E0F 0%, #2E4A28 50%, #4A7042 100%)",
    loginBgImage: loginBgMirai,
    loginHeadline: "IB World School\nAdmissions 2026–27",
    loginSubheadline: "EYP · PYP · Nursery to Grade VIII",
    loginWatermark: miraiMan,
  },
};

/**
 * Detect portal from: 1) hostname, 2) query param, 3) path segment
 */
export function detectPortal(search: string, pathname: string): PortalId {
  const hostname = window.location.hostname.toLowerCase();
  for (const config of Object.values(PORTAL_CONFIGS)) {
    if (config.hostnames.some(h => hostname === h || hostname.endsWith("." + h))) {
      return config.id;
    }
  }

  const params = new URLSearchParams(search);
  const fromQuery = params.get("portal")?.toLowerCase();
  if (fromQuery && fromQuery in PORTAL_CONFIGS) return fromQuery as PortalId;

  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1]?.toLowerCase();
  if (last && last in PORTAL_CONFIGS) return last as PortalId;

  return "nimt";
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
