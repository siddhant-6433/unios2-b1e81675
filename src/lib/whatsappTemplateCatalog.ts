/**
 * The WhatsApp template catalog — one source of truth for every picker.
 *
 * Before this existed, five independent hardcoded arrays described templates
 * (the lead dialog, the inbox, waBulkTemplates, AutomationRules, and two copies
 * inside edge functions), each with hand-written preview text and invented
 * parameter values. Meanwhile `whatsapp_templates` held 101 genuinely approved
 * Meta templates that no picker ever read — which is why counsellors reported
 * the lists looked fake.
 *
 * Here the DB is authoritative:
 *   - `whatsapp_templates`         → real Meta name, body text, arity, header
 *   - `whatsapp_template_settings` → the curated subset counsellors see
 *
 * The only thing still declared in code is `TEMPLATE_PARAM_NAMES`: Meta gives
 * positional `{{1}}..{{n}}` with no names, so we map positions to lead fields we
 * can actually fill. Anything not listed falls back to numbered slots the user
 * types in — never to a fabricated value.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  inferWhatsAppTemplateCategory,
  type WhatsAppTemplateDefinition,
  type WhatsAppTemplateLeadContext,
} from "@/lib/whatsappTemplateRender";

export interface WhatsAppTemplateComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string }>;
  example?: { header_handle?: string[]; header_text?: string[]; body_text?: string[][] };
}

export interface CatalogTemplate extends WhatsAppTemplateDefinition {
  /** Internal key used by whatsapp-send. Equals `metaName` for DB-only templates. */
  key: string;
  /** The Meta-approved template name. Null when the template only exists locally. */
  metaName: string | null;
  /** Body placeholders Meta expects, in order. */
  paramSlots: TemplateParamSlot[];
  headerFormat: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  /** True when Meta requires a media header we must supply at send time. */
  needsMediaHeader: boolean;
  /** True when this template is not mirrored from Meta (free-text / kb_* helpers). */
  localOnly: boolean;
  curated: boolean;
}

export interface TemplateParamSlot {
  /** 1-based position in Meta's body. */
  index: number;
  /** Lead-context field name when we know it, else `param_<index>`. */
  name: string;
  label: string;
  /** Meta's own example value, shown as the input placeholder. */
  example: string | null;
}

/**
 * Position → lead-context field, per Meta template name.
 *
 * Mirrors the TEMPLATES map in supabase/functions/whatsapp-send/index.ts. Names
 * here must match keys on WhatsAppTemplateLeadContext or the slot simply becomes
 * a manual input, which is the safe outcome.
 */
const TEMPLATE_PARAM_NAMES: Record<string, string[]> = {
  admissions_lead_intro: ["student_name", "course_name", "lead_source"],
  lead_welcome: ["student_name", "course_name", "lead_source"],
  visit_confirmed: ["student_name", "visit_date", "campus_name"],
  visit_reminder: ["student_name", "visit_date", "campus_name"],
  application_submitted: ["student_name", "application_id"],
  application_submitted_v2: ["student_name", "application_id"],
  fee_reminder: ["student_name", "amount", "due_date"],
  inquiry_course_update: ["student_name", "course_name"],
  nimt_followup_v1: ["student_name", "followup_date", "counsellor_name", "counsellor_phone"],
  nimt_followup_v2: ["student_name", "followup_date", "counsellor_name", "counsellor_phone"],
  nimt_not_interested_ack: ["student_name", "course_name", "counsellor_name", "counsellor_phone"],
  course_info_v1: ["student_name", "course_name", "duration", "eligibility", "approval"],
  course_info_v4: ["student_name", "course_name", "duration", "eligibility", "approval", "course_url"],
  course_info_generic: ["student_name"],
  apply_portal_login: ["student_name", "apply_url"],
  cnet_not_qualified_bpt_bmrit: ["student_name", "course_name"],
  counsellor_visit_confirmation: ["student_name", "visit_date", "campus_name"],
  counsellor_followup_overdue: ["student_name", "followup_date"],
  consultant_payout_disbursed: ["consultant_name", "amount", "candidate_name", "reference", "payout_date"],
};

const HUMAN_LABELS: Record<string, string> = {
  student_name: "Student name",
  course_name: "Course",
  campus_name: "Campus",
  lead_source: "Lead source",
  application_id: "Application ID",
  amount: "Amount",
  due_date: "Due date",
  followup_date: "Follow-up date",
  visit_date: "Visit date",
  duration: "Duration",
  eligibility: "Eligibility",
  approval: "Approval body",
  course_url: "Course URL",
  apply_url: "Apply URL",
  counsellor_name: "Counsellor name",
  counsellor_phone: "Counsellor phone",
};

const HEADER_FORMATS = ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const;
type HeaderFormat = (typeof HEADER_FORMATS)[number];

const normalizeHeaderFormat = (value: unknown): HeaderFormat => {
  const upper = String(value || "NONE").toUpperCase();
  return (HEADER_FORMATS as readonly string[]).includes(upper) ? (upper as HeaderFormat) : "NONE";
};

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const bodyTextFromComponents = (components?: WhatsAppTemplateComponent[] | null): string =>
  components?.find((c) => String(c.type).toUpperCase() === "BODY")?.text || "";

export const footerTextFromComponents = (components?: WhatsAppTemplateComponent[] | null): string =>
  components?.find((c) => String(c.type).toUpperCase() === "FOOTER")?.text || "";

export const buttonLabelsFromComponents = (components?: WhatsAppTemplateComponent[] | null): string[] =>
  components
    ?.find((c) => String(c.type).toUpperCase() === "BUTTONS")
    ?.buttons?.map((b) => b.text || "")
    .filter(Boolean) || [];

export const hasDynamicUrlButton = (components?: WhatsAppTemplateComponent[] | null): boolean =>
  (components || []).some(
    (c) =>
      String(c.type).toUpperCase() === "BUTTONS" &&
      (c.buttons || []).some((b) => b.type === "URL" && typeof b.url === "string" && b.url.includes("{{")),
  );

/**
 * Derive the ordered parameter slots for a template from Meta's own body text.
 *
 * `placeholderCount` from the mirror is the authority for how many Meta expects;
 * the body scan only supplies ordering and example values. When they disagree we
 * trust `placeholderCount`, because that is what the send will be validated
 * against server-side.
 */
export function paramSlotsFromComponents(
  metaName: string | null,
  components: WhatsAppTemplateComponent[] | null | undefined,
  placeholderCount: number,
): TemplateParamSlot[] {
  const body = bodyTextFromComponents(components);
  const examples = components?.find((c) => String(c.type).toUpperCase() === "BODY")?.example?.body_text?.[0] || [];
  const names = (metaName && TEMPLATE_PARAM_NAMES[metaName]) || [];

  // placeholder_count wins whenever Meta gave us one, because that is exactly
  // what whatsapp-send validates the outgoing params against. Taking the larger
  // of the two would let the picker build an array the server then rejects.
  // The body scan is only a fallback for rows synced before the count existed.
  const seen = new Set<number>();
  for (const match of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const index = Number(match[1]);
    if (Number.isFinite(index) && index > 0) seen.add(index);
  }
  const total = placeholderCount > 0 ? placeholderCount : seen.size;

  // Most campaign templates open with "Hi {{1}}," / "Dear {{1}}" and are not
  // worth a hand-written mapping each. Naming that slot student_name lets it
  // fill from the lead automatically instead of asking the counsellor to retype
  // a name we already know. Deliberately narrow: greeting immediately before
  // the placeholder, slot 1 only.
  const greetsFirstSlot = /(?:^|\n)\s*(?:hi|hello|dear|namaste)[\s,]*\{\{\s*1\s*\}\}/i.test(body);

  return Array.from({ length: total }, (_, i) => {
    const index = i + 1;
    const name = names[i] || (index === 1 && greetsFirstSlot ? "student_name" : `param_${index}`);
    return {
      index,
      name,
      label: HUMAN_LABELS[name] || titleCase(name),
      example: typeof examples[i] === "string" && examples[i].trim() ? examples[i] : null,
    };
  });
}

/**
 * Rewrite Meta's positional body into the named-placeholder form
 * `renderWhatsAppTemplate` understands, so previews show real approved text
 * instead of a hand-written paraphrase.
 */
function namedPreview(body: string, slots: TemplateParamSlot[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, raw) => {
    const slot = slots.find((s) => s.index === Number(raw));
    return slot ? `{{${slot.name}}}` : whole;
  });
}

interface TemplateSettingsRow {
  template_key: string;
  display_name?: string | null;
  description?: string | null;
  category?: string | null;
  show_in_lead_picker?: boolean | null;
  allowed_user_ids?: string[] | null;
}

interface MetaTemplateRow {
  name: string;
  language?: string | null;
  category?: string | null;
  components?: WhatsAppTemplateComponent[] | null;
  placeholder_count?: number | null;
  has_media?: boolean | null;
  header_format?: string | null;
}

export interface LoadCatalogOptions {
  /** Templates only exist here when an admin curated them; admins can opt out. */
  curatedOnly?: boolean;
  /** Extra local-only entries (kb_* free-text helpers) to fold in. */
  localTemplates?: CatalogTemplate[];
}

export interface WhatsAppTemplateCatalog {
  templates: CatalogTemplate[];
  byKey: Map<string, CatalogTemplate>;
  /** True when the Meta mirror came back empty — usually an RLS or sync problem. */
  degraded: boolean;
}

const EMPTY_CATALOG: WhatsAppTemplateCatalog = { templates: [], byKey: new Map(), degraded: true };

export async function loadWhatsAppTemplateCatalog(
  options: LoadCatalogOptions = {},
): Promise<WhatsAppTemplateCatalog> {
  const { curatedOnly = true, localTemplates = [] } = options;

  const [{ data: userData }, settingsResult, metaResult] = await Promise.all([
    supabase.auth.getUser(),
    (supabase as any).from("whatsapp_template_settings").select(
      "template_key, display_name, description, category, show_in_lead_picker, allowed_user_ids",
    ),
    (supabase as any)
      .from("whatsapp_templates")
      .select("name, language, category, components, placeholder_count, has_media, header_format")
      .eq("status", "APPROVED"),
  ]);

  const settingsRows = (settingsResult?.data || []) as TemplateSettingsRow[];
  const metaRows = (metaResult?.data || []) as MetaTemplateRow[];
  if (!metaRows.length && !localTemplates.length) return EMPTY_CATALOG;

  const userId = userData?.user?.id || null;
  const settingsByKey = new Map(settingsRows.map((row) => [row.template_key, row]));

  const curatedKeys = new Set(
    settingsRows
      .filter((row) => {
        if (row.show_in_lead_picker !== true) return false;
        const userScoped = Array.isArray(row.allowed_user_ids) && row.allowed_user_ids.length > 0;
        return !userScoped || (!!userId && row.allowed_user_ids!.includes(userId));
      })
      .map((row) => row.template_key),
  );

  const templates: CatalogTemplate[] = [];

  for (const row of metaRows) {
    if (!row.name) continue;
    const curated = curatedKeys.has(row.name);
    if (curatedOnly && !curated) continue;

    const setting = settingsByKey.get(row.name);
    const components = row.components || null;
    const placeholderCount = typeof row.placeholder_count === "number" ? row.placeholder_count : 0;
    const slots = paramSlotsFromComponents(row.name, components, placeholderCount);
    const body = bodyTextFromComponents(components);
    const headerFormat = normalizeHeaderFormat(row.header_format);

    templates.push({
      key: row.name,
      metaName: row.name,
      label: setting?.display_name || titleCase(row.name),
      description: setting?.description || "Approved Meta template",
      params: slots.map((slot) => slot.name),
      paramSlots: slots,
      preview: namedPreview(body, slots) || setting?.description || row.name,
      language: row.language || "en",
      category: inferWhatsAppTemplateCategory(setting?.category || row.name),
      status: "approved",
      buttons: buttonLabelsFromComponents(components),
      footer: footerTextFromComponents(components) || undefined,
      headerFormat,
      needsMediaHeader: row.has_media === true || ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat),
      localOnly: false,
      curated,
    });
  }

  for (const local of localTemplates) {
    if (templates.some((t) => t.key === local.key)) continue;
    if (curatedOnly && !curatedKeys.has(local.key)) continue;
    templates.push({ ...local, curated: curatedKeys.has(local.key) });
  }

  templates.sort((a, b) => a.label.localeCompare(b.label));
  return {
    templates,
    byKey: new Map(templates.map((t) => [t.key, t])),
    degraded: !metaRows.length,
  };
}

export interface BuiltTemplateParams {
  /** Positional values in Meta's order — exactly what whatsapp-send expects. */
  params: string[];
  /** Slots we could not fill from context or overrides. */
  missing: TemplateParamSlot[];
}

/**
 * Fill a template's slots from lead context and manual overrides.
 *
 * Deliberately does not invent values. The old `buildParams` closures fell back
 * to strings like "the pending amount" and "your scheduled date", which shipped
 * to students as-is; here an unfilled slot is reported as missing so the picker
 * can ask for it and the send can be blocked.
 */
export function buildTemplateParams(
  template: Pick<CatalogTemplate, "paramSlots">,
  context: WhatsAppTemplateLeadContext & Record<string, unknown>,
  overrides: Record<string, string> = {},
): BuiltTemplateParams {
  const params: string[] = [];
  const missing: TemplateParamSlot[] = [];

  for (const slot of template.paramSlots) {
    const override = overrides[slot.name] ?? overrides[`param_${slot.index}`];
    const fromContext = (context as Record<string, unknown>)[slot.name];
    const value =
      (typeof override === "string" && override.trim()) ||
      (fromContext != null && String(fromContext).trim()) ||
      "";

    if (!value) missing.push(slot);
    // Meta rejects parameters containing newlines or tabs (131009).
    params.push(value.replace(/[\r\n\t]+/g, " ").trim());
  }

  return { params, missing };
}
