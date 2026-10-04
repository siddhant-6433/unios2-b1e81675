import { resolveApplyPortal, type ApplyPortalId } from "../generate-apply-link/portal.ts";

export const MIRAI_INSTITUTION_ID = "d8c95a30-ecc6-4b41-8bed-987c960dc44a";
export const MIRAI_APP_BASE = "https://uni.miraischool.in";
export const MIRAI_PHONE_NUMBER_ID = "1110238142172240";

export function miraiRolloutEnabled(): boolean {
  const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
  return runtime.Deno?.env.get("MIRAI_ROLLOUT_ENABLED") === "true";
}

export function applicationBase(portal: ApplyPortalId, standardBase: string, enabled: boolean,
  miraiBase = `${MIRAI_APP_BASE}/apply`): string {
  return portal === "mirai" && enabled ? miraiBase : standardBase;
}

/** A stored application/course owns the brand; neither Origin nor phone does. */
export async function resolveStoredPortal(db: any, owner: {
  leadId?: string | null; studentId?: string | null; applicationId?: string | null;
}): Promise<ApplyPortalId> {
  let leadId = owner.leadId;
  let studentCourseId: string | null = null;
  if (owner.studentId) {
    const { data: student, error } = await db.from("students")
      .select("lead_id, course_id").eq("id", owner.studentId).maybeSingle();
    if (error || !student) throw new Error("Could not resolve the student's institution");
    if (leadId && student.lead_id && leadId !== student.lead_id) throw new Error("Student and lead do not match");
    leadId = student.lead_id || leadId;
    studentCourseId = student.course_id;
  }
  if (!leadId && !studentCourseId) throw new Error("A saved lead or student is required to resolve the institution");
  let lead: any = null;
  let applications: any[] = [];
  if (leadId) {
    const result = await db.from("leads")
      .select("portal_brand, lead_institution_type, source, origin_domain, landing_page, campus_id, course_id")
      .eq("id", leadId).maybeSingle();
    if (result.error || !result.data) throw new Error("Could not resolve the lead's institution");
    lead = result.data;
    let query = db.from("applications").select("flags, program_category, course_selections")
      .eq("lead_id", leadId);
    if (owner.applicationId) query = query.eq("application_id", owner.applicationId);
    const resultApps = await query.order("created_at", { ascending: false }).limit(5);
    if (resultApps.error) throw new Error("Could not resolve the application's institution");
    applications = resultApps.data || [];
    if (owner.applicationId && !applications.length) throw new Error("Application does not belong to this lead");
  }
  const courseIds = new Set<string>();
  for (const app of applications) {
    for (const selection of Array.isArray(app.course_selections) ? app.course_selections : []) {
      if (typeof selection?.course_id === "string" && /^[0-9a-f-]{36}$/i.test(selection.course_id)) courseIds.add(selection.course_id);
    }
  }
  // A requested application owns its selections independently of the lead's
  // current course, which may belong to a sibling application.
  if (!owner.applicationId || !courseIds.size) {
    if (studentCourseId) courseIds.add(studentCourseId);
    else if (lead?.course_id) courseIds.add(lead.course_id);
  }
  let isMiraiInstitution = false;
  if (courseIds.size) {
    const { data, error } = await db.from("courses")
      .select("id, departments:department_id(institution_id)").in("id", [...courseIds]);
    if (error) throw new Error("Could not resolve course ownership");
    isMiraiInstitution = (data || []).some((course: any) => course.departments?.institution_id === MIRAI_INSTITUTION_ID);
  }
  return resolveApplyPortal(lead, applications, { isMiraiInstitution });
}
