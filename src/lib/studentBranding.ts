import miraiLogoGreen from "@/assets/mirai-logo-green.svg";
import nimtBeaconLogo from "@/assets/nimt-beacon-logo.png";
import nimtEduInstLogo from "@/assets/nimt-edu-inst-logo.svg";

export interface StudentBrand {
  /** Stable school key — drives ID-card theming (colour ramp / logo variant). */
  key: "nimt" | "beacon" | "mirai";
  name: string;
  logo: string;
  logoAlt: string;
}

export interface StudentBrandInput {
  campusName?: string | null;
  courseName?: string | null;
  courseCode?: string | null;
  institutionName?: string | null;
  institutionType?: string | null;
}

export const NIMT_EDU_BRAND: StudentBrand = {
  key: "nimt",
  name: "NIMT Educational Institutions",
  logo: nimtEduInstLogo,
  logoAlt: "NIMT Educational Institutions",
};

export const NIMT_BEACON_BRAND: StudentBrand = {
  key: "beacon",
  name: "NIMT Beacon School",
  logo: nimtBeaconLogo,
  logoAlt: "NIMT Beacon School",
};

export const MIRAI_BRAND: StudentBrand = {
  key: "mirai",
  name: "Mirai Experiential School",
  logo: miraiLogoGreen,
  logoAlt: "Mirai Experiential School",
};

export function brandForStudentOwner(input: StudentBrandInput): StudentBrand {
  const text = [
    input.campusName,
    input.courseName,
    input.courseCode,
    input.institutionName,
    input.institutionType,
  ].filter(Boolean).join(" ").toLowerCase();

  if (text.includes("mirai") || text.includes("mes-")) {
    return MIRAI_BRAND;
  }

  if (
    text.includes("beacon") ||
    text.includes("avantika") ||
    text.includes("bsav-") ||
    text.includes("bsa-")
  ) {
    return NIMT_BEACON_BRAND;
  }

  return NIMT_EDU_BRAND;
}
