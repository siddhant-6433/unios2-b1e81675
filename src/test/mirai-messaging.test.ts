import { afterEach, describe, expect, it, vi } from "vitest";
import { applicationBase, resolveStoredPortal, MIRAI_INSTITUTION_ID } from "../../supabase/functions/_shared/mirai-brand";
import { MIRAI_TEMPLATES, uniqueMiraiTemplates, miraiButtonValues, validateMiraiTemplate } from "../../supabase/functions/_shared/mirai-templates";
import { resolveWhatsAppChannel, sendWhatsAppTemplate } from "../../supabase/functions/_shared/whatsapp-channel";

afterEach(() => vi.unstubAllGlobals());
const sender = { id: "mirai", label: "Mirai", provider: "meta", route: "reply", business_number: "919220522282",
  meta_phone_number_id: "1110238142172240", waba_id: "mirai-waba", secret_token_name: "MIRAI_TOKEN" };
const strictHint = { provider: "meta" as const, route: "admissions" as const, wabaId: "mirai-waba",
  businessPhoneNumberId: "1110238142172240", strictSender: true };
const channelDb = (rows: unknown[], error: unknown = null) => ({ from: () => ({ select: () => ({ eq: () => ({
  order: async () => ({ data: rows, error }),
}) }) }) }) as never;

describe("strict Mirai sender", () => {
  it("pins both WABA and phone number even if other channels share the account", async () => {
    const other = { ...sender, id: "other", route: "admissions", meta_phone_number_id: "other-number" };
    expect(await resolveWhatsAppChannel(channelDb([other, sender]), strictHint)).toMatchObject({ id: "mirai" });
  });
  it("fails closed on missing sender, wrong WABA, or a registry error", async () => {
    for (const db of [channelDb([]), channelDb([{ ...sender, waba_id: "nimt-waba" }]), channelDb([sender], { message: "database offline" })]) {
      await expect(resolveWhatsAppChannel(db, strictHint)).rejects.toThrow("no fallback sender");
    }
  });
  it("does not discover or retry another sender after Meta rejects the Mirai number", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "test-token" } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 133010, message: "Unregistered sender" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendWhatsAppTemplate(channelDb([sender]), strictHint, "919000000000", {
      name: "mirai_apply_portal_login_v1", language: "en", components: [],
    });
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v21.0/1110238142172240/messages");
  });
});

describe("Mirai template contracts", () => {
  const template = MIRAI_TEMPLATES.apply_portal_login;
  const approved = {
    name: template.name, status: "APPROVED", category: "UTILITY", language: "en", waba_id: "mirai-waba", placeholder_count: 2,
    components: [{ type: "BODY", text: template.body }, { type: "BUTTONS", buttons: [{ type: "URL", ...template.button }] }],
  };
  it("requires approval on the exact account and reviewed copy/button contract", () => {
    expect(validateMiraiTemplate(template, approved, "mirai-waba")).toBeNull();
    for (const change of [{ status: "PENDING" }, { category: "MARKETING" }, { waba_id: "nimt-waba" }, { language: "hi" }, { placeholder_count: 3 },
      { components: [{ type: "BODY", text: "Unexpected copy" }] }]) {
      expect(validateMiraiTemplate(template, { ...approved, ...change }, "mirai-waba")).not.toBeNull();
    }
  });
  it("preserves document requirements and parameter order for payments", () => {
    expect(MIRAI_TEMPLATES.payment_receipt.params).toEqual(["student_name", "payment_type", "amount", "receipt_no", "download_url"]);
    expect(MIRAI_TEMPLATES.payment_receipt_pdf.header).toBe("DOCUMENT");
    expect(MIRAI_TEMPLATES.app_fee_receipt_pdf).toBe(MIRAI_TEMPLATES.app_fee_receipt);
    expect(MIRAI_TEMPLATES.application_received).toBe(MIRAI_TEMPLATES.application_submitted);
  });
  it("uses unique Mirai names and new-domain buttons throughout the catalogue", () => {
    const templates = uniqueMiraiTemplates();
    expect(new Set(templates.map(t => t.name)).size).toBe(templates.length);
    for (const entry of templates) {
      expect(entry.name).toMatch(/^mirai_.+_v[12]$/);
      expect(entry.body).not.toMatch(/NIMT|college/i);
      if (entry.button) expect(entry.button.url).toMatch(/^https:\/\/uni\.miraischool\.in(?:\/|$)/);
    }
  });
  it.each(uniqueMiraiTemplates())("validates every $name body, media and button contract", entry => {
    const row = { name: entry.name, status: "APPROVED", category: "UTILITY", language: "en", waba_id: "mirai-waba",
      placeholder_count: entry.params.length,
      components: [
        ...(entry.header ? [{ type: "HEADER", format: entry.header }] : []),
        { type: "BODY", text: entry.body },
        ...(entry.button ? [{ type: "BUTTONS", buttons: [{ type: "URL", ...entry.button }] }] : []),
      ],
    };
    expect(validateMiraiTemplate(entry, row, "mirai-waba")).toBeNull();
    expect(validateMiraiTemplate(entry, { ...row, placeholder_count: entry.params.length + 1 }, "mirai-waba")).not.toBeNull();
    expect(validateMiraiTemplate(entry, { ...row, status: "PENDING" }, "mirai-waba")).not.toBeNull();
    expect(validateMiraiTemplate(entry, { ...row, waba_id: "nimt-waba" }, "mirai-waba")).not.toBeNull();
    if (entry.header) expect(validateMiraiTemplate(entry, { ...row, components: row.components.slice(1) }, "mirai-waba")).not.toBeNull();
    if (entry.button) expect(validateMiraiTemplate(entry, { ...row, components: row.components.slice(0, -1) }, "mirai-waba")).not.toBeNull();
  });
  it("accepts Meta's canonical root slash without accepting another portal URL", () => {
    const entry = MIRAI_TEMPLATES.student_admitted_welcome;
    const row = {status:"APPROVED",category:"UTILITY",language:"en",waba_id:"mirai-waba",placeholder_count:3,
      components:[{type:"BODY",text:entry.body},{type:"BUTTONS",buttons:[{type:"URL",...entry.button,url:entry.button!.url+"/"}]}]};
    expect(validateMiraiTemplate(entry,row,"mirai-waba")).toBeNull();
    row.components[1].buttons[0].url = "https://uni.nimt.ac.in/";
    expect(validateMiraiTemplate(entry,row,"mirai-waba")).not.toBeNull();
  });
  it("converts old complete URLs to token suffixes and rejects unrelated hosts", () => {
    expect(miraiButtonValues(MIRAI_TEMPLATES.student_portal_invite, ["https://uni.nimt.ac.in/student?token=claim-token"])).toEqual(["claim-token"]);
    expect(miraiButtonValues(template, ["apply-token"])).toEqual(["apply-token"]);
    expect(miraiButtonValues(MIRAI_TEMPLATES.doc_rejected, [])).toEqual([]);
    expect(() => miraiButtonValues(template, ["https://evil.example/apply?token=x"])).toThrow();
  });
  it("does not change generated domains before rollout or for other institutions", () => {
    expect(applicationBase("mirai", "https://uni.nimt.ac.in/apply", false)).toBe("https://uni.nimt.ac.in/apply");
    expect(applicationBase("mirai", "https://uni.nimt.ac.in/apply", true)).toBe("https://uni.miraischool.in/apply");
    expect(applicationBase("beacon", "https://custom.example/apply", true)).toBe("https://custom.example/apply");
  });
});

function ownerDb({ lead = {}, apps = [], courses = [], student = null, fail = "" }: {
  lead?: unknown; apps?: unknown[]; courses?: unknown[]; student?: unknown; fail?: string;
}) {
  return { from: (table: string) => {
    const result = { data: ({ leads: lead, applications: apps, courses, students: student } as Record<string, unknown>)[table], error: table === fail ? { message: "offline" } : null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "in"]) query[method] = () => query;
    query.in = (_column: string, ids: string[]) => {
      if (table === "courses") result.data = courses.filter((course: any) => !course.id || ids.includes(course.id));
      return query;
    };
    query.maybeSingle = async () => result;
    query.limit = async () => result;
    query.then = (resolve: (value: unknown) => void) => resolve(result);
    return query;
  } };
}
describe("stored institution ownership", () => {
  it("recognizes a Mirai course on an unbranded lead", async () => {
    expect(await resolveStoredPortal(ownerDb({ lead: { course_id: "course-1" }, courses: [{ departments: { institution_id: MIRAI_INSTITUTION_ID } }] }), { leadId: "lead-1" })).toBe("mirai");
  });
  it("scopes selected-course ownership to the requested application instead of a sibling lead course", async () => {
    const miraiCourse = "11111111-1111-1111-1111-111111111111";
    const nimtCourse = "22222222-2222-2222-2222-222222222222";
    const courses = [{id:miraiCourse,departments:{institution_id:MIRAI_INSTITUTION_ID}},
      {id:nimtCourse,departments:{institution_id:"nimt-institution"}}];
    expect(await resolveStoredPortal(ownerDb({lead:{course_id:miraiCourse},
      apps:[{course_selections:[{course_id:nimtCourse}],program_category:"undergraduate"}],courses}),
      {leadId:"lead-1",applicationId:"APP-nimt"})).toBe("nimt");
    expect(await resolveStoredPortal(ownerDb({lead:{course_id:nimtCourse},
      apps:[{course_selections:[{course_id:miraiCourse}]}],courses}),
      {leadId:"lead-1",applicationId:"APP-mirai"})).toBe("mirai");
  });
  it("does not classify B.Ed at the shared campus as Mirai", async () => {
    const db = ownerDb({ lead: { campus_id: "c0000002-0000-0000-0000-000000000001", lead_institution_type: "college" }, apps: [{ program_category: "undergraduate" }] });
    expect(await resolveStoredPortal(db, { leadId: "lead-1" })).toBe("nimt");
  });
  it("resolves imported students from their own course without relying on phone", async () => {
    const db = ownerDb({ student: { course_id: "course-1", lead_id: null }, courses: [{ departments: { institution_id: MIRAI_INSTITUTION_ID } }] });
    expect(await resolveStoredPortal(db, { studentId: "student-1" })).toBe("mirai");
  });
  it("fails rather than guessing if ownership is missing, inconsistent, or unavailable", async () => {
    await expect(resolveStoredPortal(ownerDb({}), {})).rejects.toThrow("saved lead or student");
    await expect(resolveStoredPortal(ownerDb({ student: { lead_id: "other" } }), { leadId: "lead-1", studentId: "student-1" })).rejects.toThrow("do not match");
    await expect(resolveStoredPortal(ownerDb({ fail: "applications" }), { leadId: "lead-1" })).rejects.toThrow("application's institution");
    await expect(resolveStoredPortal(ownerDb({ apps: [] }), { leadId: "lead-1", applicationId: "APP-other" })).rejects.toThrow("does not belong");
  });
});
