import miraiLogoGreen from "@/assets/mirai-logo-green.svg";
import nimtBeaconLogo from "@/assets/nimt-beacon-logo.png";
import nimtEduInstLogo from "@/assets/nimt-edu-inst-logo.svg";

export interface StudentBrand {
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
  name: "NIMT Educational Institutions",
  logo: nimtEduInstLogo,
  logoAlt: "NIMT Educational Institutions",
};

export const NIMT_BEACON_BRAND: StudentBrand = {
  name: "NIMT Beacon School",
  logo: nimtBeaconLogo,
  logoAlt: "NIMT Beacon School",
};

export const MIRAI_BRAND: StudentBrand = {
  name: "Mirai School",
  logo: miraiLogoGreen,
  logoAlt: "Mirai School",
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
