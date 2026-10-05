import miraiLogo from "@/assets/mirai-logo-transparent.svg";
import uniLogo from "@/assets/unios-logo.png";
import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";

export const MIRAI_HOST = "uni.miraischool.in";
export const MIRAI_THEME: Record<string, string> = {
  "--primary": "100 22% 33%",
  "--primary-foreground": "0 0% 100%",
  "--ring": "100 22% 33%",
  "--sidebar-primary": "100 22% 33%",
  "--sidebar-accent": "100 18% 90%",
  "--sidebar-accent-foreground": "100 22% 28%",
  "--accent": "100 15% 93%",
  "--accent-foreground": "100 22% 28%",
};

export function getSiteBrand(hostname = window.location.hostname) {
  const isMirai = hostname.toLowerCase() === MIRAI_HOST;
  return {
    isMirai,
    title: isMirai ? "Mirai Uni" : "NIMT UniOs",
    institutionName: isMirai ? "Mirai School" : "NIMT University",
    logo: isMirai ? miraiLogo : uniLogo,
    logoAlt: isMirai ? "Mirai School" : "UniOs",
    institutionLogo: isMirai ? miraiLogo : nimtLogo,
    description: isMirai
      ? "Your school, connected. Access learning, attendance, fees, and school updates in one place."
      : "Multi-campus education management platform. Manage admissions, students, finance, and more — all in one place.",
    cssVars: (isMirai ? MIRAI_THEME : {}) as Record<string, string>,
  };
}

/** Restore the hostname theme after a nested application portal releases it. */
export function restoreSiteTheme(keys: string[] = Object.keys(MIRAI_THEME)) {
  const brand = getSiteBrand();
  for (const key of keys) {
    const value = brand.cssVars[key];
    if (value) document.documentElement.style.setProperty(key, value);
    else document.documentElement.style.removeProperty(key);
  }
}

export function initializeSiteBranding() {
  const brand = getSiteBrand();
  restoreSiteTheme();
  if (!brand.isMirai) return;
  document.title = brand.title;
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    document.querySelector(selector)?.setAttribute("content", brand.title);
  }
  document.querySelector('meta[name="author"]')?.setAttribute("content", "Mirai School");
  for (const icon of document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) {
    icon.setAttribute("href", brand.logo);
    icon.removeAttribute("sizes");
    icon.setAttribute("type", "image/svg+xml");
  }
}

/** Only production domains redirect. Local development and previews stay local. */
export function canonicalApplicationUrl(href: string, portal: "nimt" | "beacon" | "mirai", enabled: boolean): string | null {
  if (!enabled) return null;
  const url = new URL(href);
  if (![MIRAI_HOST, "uni.nimt.ac.in", "apply.nimt.ac.in"].includes(url.hostname)) return null;
  const targetHost = portal === "mirai" ? MIRAI_HOST : "uni.nimt.ac.in";
  if (url.hostname === targetHost) return null;
  url.protocol = "https:";
  url.host = targetHost;
  url.pathname = portal === "mirai" ? "/apply" : `/apply/${portal}`;
  return url.toString();
}
