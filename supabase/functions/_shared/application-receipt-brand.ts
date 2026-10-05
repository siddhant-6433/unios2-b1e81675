import { MIRAI_INSTITUTION_ID } from "./mirai-brand.ts";

/** Documents follow the saved course's institution, independently of website branding. */
export async function applicationReceiptBrand<T extends Record<string, unknown>>(
  db: any, application: any, fallback: T,
): Promise<T> {
  const selectedCourse = application.course_selections?.[0]?.course_id;
  // Legacy selections sometimes store a course code; the lead stores its UUID.
  let courseId = typeof selectedCourse === "string" && /^[0-9a-f-]{36}$/i.test(selectedCourse)
    ? selectedCourse : null;
  if (!courseId && application.lead_id) {
    const { data, error } = await db.from("leads").select("course_id")
      .eq("id", application.lead_id).maybeSingle();
    if (error) throw new Error("Could not resolve receipt course ownership");
    courseId = data?.course_id;
  }
  if (!courseId) return fallback;
  const { data, error } = await db.from("courses")
    .select("departments:department_id(institution_id)").eq("id", courseId).maybeSingle();
  if (error || !data) throw new Error("Could not resolve receipt institution ownership");
  if (data.departments?.institution_id !== MIRAI_INSTITUTION_ID) return fallback;
  return {
    ...fallback,
    slug: "mirai",
    name: "Mirai Experiential School",
    address: "D00/BLK, Ansal Avantika, Ghaziabad, 201002, Uttar Pradesh",
    contact_email: null,
    website: "https://miraischool.in",
  };
}
