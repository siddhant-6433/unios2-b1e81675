// Deno-side mirror of src/lib/examRegistration.ts course→exam mapping.
// Kept self-contained (no cross-imports) so edge functions can resolve the
// entrance exam a course+campus requires. Keep in sync with the frontend lib.

export type ExamCode = "cahet" | "cnet" | "updeled" | "jeecup" | "ptet" | "jee_bed" | "upget";

export const EXAM_DISPLAY_NAMES: Record<ExamCode, string> = {
  cahet: "CAHET (Conducted by ABVMU Lucknow)",
  cnet: "CNET (BSc Nursing - Conducted by ABVMU Lucknow)",
  updeled: "UPDELED Counselling",
  jeecup: "JEECUP",
  ptet: "PTET",
  jee_bed: "JEE B.Ed",
  upget: "UPGET",
};

function lc(s: string | null | undefined): string {
  return String(s || "").toLowerCase();
}

function isDeled(name: string): boolean {
  const c = lc(name);
  return (
    c.includes("d.el.ed") || c.includes("d el ed") || c.includes("deled") ||
    (c.includes("diploma") && c.includes("elementary") && c.includes("education")) ||
    c.includes("btc")
  );
}

function isGnm(name: string): boolean {
  const c = lc(name);
  return c.includes("gnm") || c.includes("general nursing");
}

function isBscNursing(name: string): boolean {
  const c = lc(name);
  if (isGnm(c)) return false;
  if (!c.includes("nursing")) return false;
  return c.includes("b.sc") || c.includes("bsc") || c.includes("bachelor of science");
}

function isDPharma(name: string): boolean {
  const c = lc(name);
  return c.includes("d.pharma") || c.includes("d pharma") || (c.includes("diploma") && c.includes("pharmac"));
}

function isBed(name: string): boolean {
  const c = lc(name);
  if (isDeled(c)) return false;
  return c.includes("b.ed") || (c.includes("bachelor") && c.includes("education"));
}

function isBptOrBmrit(name: string): boolean {
  const c = lc(name);
  return (
    c.includes("bpt") || c.includes("physiotherapy") || c.includes("bmrit") ||
    (c.includes("radiology") && c.includes("b.sc")) ||
    (c.includes("radiology") && c.includes("imaging"))
  );
}

export function bedExamForCampus(campus: string | null | undefined): ExamCode {
  return /kotputli/i.test(String(campus || "")) ? "ptet" : "jee_bed";
}

export function examCodeForCourse(courseName: string | null | undefined, campusName?: string | null): ExamCode | null {
  const name = String(courseName || "");
  if (!name.trim()) return null;
  if (isDeled(name)) return "updeled";
  if (isGnm(name)) return "upget";
  if (isBscNursing(name)) return "cnet";
  if (isDPharma(name)) return "jeecup";
  if (isBed(name)) return bedExamForCampus(campusName);
  if (isBptOrBmrit(name)) return "cahet";
  return null;
}

interface CourseSelection {
  course_name?: string | null;
  name?: string | null;
  campus_name?: string | null;
}

export function examCodeForSelections(selections: CourseSelection[] | null | undefined): { code: ExamCode; course: string; campus: string } | null {
  if (!Array.isArray(selections)) return null;
  for (const sel of selections) {
    const course = sel?.course_name || sel?.name || "";
    const code = examCodeForCourse(course, sel?.campus_name);
    if (code) return { code, course: String(course), campus: String(sel?.campus_name || "") };
  }
  return null;
}
