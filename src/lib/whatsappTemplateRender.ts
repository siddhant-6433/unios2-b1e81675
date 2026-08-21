export type WhatsAppTemplateStatus = "approved" | "pending" | "rejected";
export type WhatsAppTemplateCategory = "admissions" | "course_details" | "followup" | "knowledge" | "payment" | "visit" | "utility";

export interface WhatsAppTemplateDefinition {
  key: string;
  label: string;
  description: string;
  params: string[];
  preview: string;
  language?: string;
  category?: WhatsAppTemplateCategory;
  status?: WhatsAppTemplateStatus;
  buttons?: string[];
  footer?: string;
}

export interface WhatsAppTemplateLeadContext {
  student_name?: string | null;
  course_name?: string | null;
  campus_name?: string | null;
  lead_source?: string | null;
  application_id?: string | null;
  amount?: string | null;
  due_date?: string | null;
  followup_date?: string | null;
  visit_date?: string | null;
  duration?: string | null;
  eligibility?: string | null;
  approval?: string | null;
  video_url?: string | null;
  course_url?: string | null;
  campus_url?: string | null;
  apply_url?: string | null;
}

export interface RenderedWhatsAppTemplateParam {
  key: string;
  label: string;
  value: string;
  required: boolean;
  resolved: boolean;
}

export interface RenderedWhatsAppTemplate {
  key: string;
  label: string;
  language: string;
  category: WhatsAppTemplateCategory;
  status: WhatsAppTemplateStatus;
  body: string;
  params: RenderedWhatsAppTemplateParam[];
  unresolved: string[];
  buttons: string[];
  footer?: string;
}

const TEMPLATE_CATEGORIES = new Set<WhatsAppTemplateCategory>(["admissions", "course_details", "followup", "knowledge", "payment", "visit", "utility"]);
const TEMPLATE_STATUSES = new Set<WhatsAppTemplateStatus>(["approved", "pending", "rejected"]);

const HUMAN_PARAM_LABELS: Record<string, string> = {
  student_name: "Student name",
  course_name: "Course",
  course_label: "Course",
  campus_name: "Campus",
  lead_source: "Lead source",
  application_id: "Application ID",
  amount: "Amount",
  due_date: "Due date",
  followup_date: "Follow-up",
  visit_date: "Visit date",
  duration: "Duration",
  eligibility: "Eligibility",
  approval: "Approval",
  video_url: "Video URL",
  course_url: "Course URL",
  campus_url: "Campus URL",
  apply_url: "Apply URL",
};

const FALLBACK_VALUES: Record<string, string> = {
  student_name: "Student",
  course_name: "your selected course",
  course_label: "your selected course",
  campus_name: "NIMT campus",
  lead_source: "WhatsApp enquiry",
  application_id: "N/A",
  amount: "the pending amount",
  due_date: "the due date",
  followup_date: "soon",
  visit_date: "the scheduled date",
  duration: "course duration",
  eligibility: "eligibility criteria",
  approval: "NIMT Educational Institutions",
  video_url: "course video link",
  course_url: "https://nimt.ac.in/courses",
  campus_url: "https://nimt.ac.in/contact",
  apply_url: "https://uni.nimt.ac.in/apply/nimt",
};

const normalizeKey = (key: string) => key.trim().replace(/\s+/g, "_");

const humanizeParam = (key: string) =>
  HUMAN_PARAM_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

export const inferWhatsAppTemplateCategory = (key: string): WhatsAppTemplateCategory => {
  // Matches the settings.category value 'course_details' and the *_course_details
  // key pattern; must precede the generic `course → admissions` rule below.
  if (/course_details/i.test(key)) return "course_details";
  if (/visit/i.test(key)) return "visit";
  if (/fee|payment|receipt|offer|token/i.test(key)) return "payment";
  if (/followup|reminder|not_interested|deadline/i.test(key)) return "followup";
  if (/^kb_/i.test(key)) return "knowledge";
  if (/application|lead|course|welcome|cahet|cnet/i.test(key)) return "admissions";
  return "utility";
};

export function normalizeRenderedWhatsAppTemplate(value: unknown): RenderedWhatsAppTemplate | null {
  if (!value || typeof value !== "object") return null;
  const metadata = value as Partial<RenderedWhatsAppTemplate>;
  if (typeof metadata.body !== "string") return null;

  const key = typeof metadata.key === "string" && metadata.key.trim()
    ? metadata.key
    : "template";
  const category = metadata.category && TEMPLATE_CATEGORIES.has(metadata.category)
    ? metadata.category
    : inferWhatsAppTemplateCategory(key);
  const status = metadata.status && TEMPLATE_STATUSES.has(metadata.status)
    ? metadata.status
    : "approved";

  return {
    key,
    label: typeof metadata.label === "string" && metadata.label.trim()
      ? metadata.label
      : key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    language: typeof metadata.language === "string" && metadata.language.trim()
      ? metadata.language
      : "en",
    category,
    status,
    body: metadata.body,
    params: Array.isArray(metadata.params) ? metadata.params : [],
    unresolved: Array.isArray(metadata.unresolved) ? metadata.unresolved : [],
    buttons: Array.isArray(metadata.buttons) ? metadata.buttons : [],
    footer: typeof metadata.footer === "string" ? metadata.footer : undefined,
  };
}

export function renderWhatsAppTemplate(
  template: WhatsAppTemplateDefinition,
  context: WhatsAppTemplateLeadContext,
  overrides: Record<string, string> = {},
): RenderedWhatsAppTemplate {
  const contextValues = Object.fromEntries(
    Object.entries(context)
      .filter(([, value]) => value != null && String(value).trim() !== "")
      .map(([key, value]) => [key, String(value)]),
  );
  const overrideValues = Object.fromEntries(
    Object.entries(overrides)
      .filter(([, value]) => value != null && String(value).trim() !== "")
      .map(([key, value]) => [key, String(value)]),
  );
  const providedKeys = new Set([...Object.keys(contextValues), ...Object.keys(overrideValues)].map(normalizeKey));
  const values: Record<string, string> = {
    ...FALLBACK_VALUES,
    ...contextValues,
    ...overrideValues,
  };

  if (!values.course_label && values.course_name) values.course_label = values.course_name;
  if (providedKeys.has("course_name")) providedKeys.add("course_label");

  const requiredKeys = new Set(template.params.map(normalizeKey));
  const encounteredKeys = new Set<string>();
  let body = template.preview.replace(/\{\{(\w+)\}\}/g, (_, rawKey) => {
    const key = normalizeKey(rawKey);
    encounteredKeys.add(key);
    return values[key] || `{{${key}}}`;
  });

  for (const key of requiredKeys) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    body = body.replace(re, values[key] || `{{${key}}}`);
  }

  const allKeys = Array.from(new Set([...requiredKeys, ...encounteredKeys]));
  const params = allKeys.map(key => {
    const fallback = FALLBACK_VALUES[key];
    const value = values[key] || "";
    const required = requiredKeys.has(key);
    return {
      key,
      label: humanizeParam(key),
      value,
      required,
      resolved: !required || (providedKeys.has(key) && !!value) || (!!value && value !== fallback && !/^.+ (duration|criteria|link)$/.test(value)),
    };
  });

  return {
    key: template.key,
    label: template.label,
    language: template.language || "en",
    category: template.category || inferWhatsAppTemplateCategory(template.key),
    status: template.status || "approved",
    body,
    params,
    unresolved: params.filter(param => param.required && !param.resolved).map(param => param.key),
    buttons: template.buttons || [],
    footer: template.footer,
  };
}
