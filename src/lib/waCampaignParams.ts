import type { WaBulkTemplate } from "@/config/waBulkTemplates";

export const WA_PARAM_MAPPING_PREFIX = "__lead_field__:";
export const WA_COMMON_VALUE = "__common_value__";

export const WA_PARAM_FIELD_OPTIONS = [
  { token: "student_name", label: "Student name" },
  { token: "phone", label: "Phone number" },
  { token: "email", label: "Email" },
  { token: "course_name", label: "Course" },
  { token: "campus_name", label: "Campus" },
  { token: "lead_stage", label: "Lead stage" },
  { token: "lead_source", label: "Lead source" },
  { token: "guardian_name", label: "Guardian name" },
  { token: "guardian_phone", label: "Guardian phone" },
] as const;

export type WaParamFieldToken = typeof WA_PARAM_FIELD_OPTIONS[number]["token"];

const WA_PARAM_FIELD_LABELS = new Map(WA_PARAM_FIELD_OPTIONS.map((option) => [option.token, option.label]));

export const encodeWaParamFieldMapping = (token: WaParamFieldToken) => `${WA_PARAM_MAPPING_PREFIX}${token}`;

export const decodeWaParamFieldMapping = (value?: string | null): WaParamFieldToken | null => {
  if (!value?.startsWith(WA_PARAM_MAPPING_PREFIX)) return null;
  const token = value.slice(WA_PARAM_MAPPING_PREFIX.length);
  return WA_PARAM_FIELD_LABELS.has(token as WaParamFieldToken) ? token as WaParamFieldToken : null;
};

export const waParamFieldLabel = (token: WaParamFieldToken) => WA_PARAM_FIELD_LABELS.get(token) || token;

export const isWaBodyTemplateParam = (name: string) => /^template_value_\d+$/.test(name);

export const isWaButtonUrlTemplateParam = (name: string) => /^template_button_\d+_url_value_\d+$/.test(name);

// Dynamic-URL-button param names encode which button and which {{n}} they fill.
export const parseWaButtonUrlParam = (name: string) => {
  const m = name.match(/^template_button_(\d+)_url_value_(\d+)$/);
  return m ? { button: Number(m[1]), position: Number(m[2]) } : null;
};

export const isWaMappableTemplateParam = (name: string) =>
  isWaBodyTemplateParam(name) ||
  /^template_header_value_\d+$/.test(name) ||
  /^template_button_\d+_url_value_\d+$/.test(name);

export const isWaMediaTemplateParam = (name: string) => name === "template_header_media_url";

export const defaultWaParamValue = (name: string) =>
  name === "template_value_1" ? encodeWaParamFieldMapping("student_name") : "";

export const effectiveWaParamValue = (params: Record<string, string>, name: string) =>
  Object.prototype.hasOwnProperty.call(params, name) ? params[name] : defaultWaParamValue(name);

export const waBodyPreviewParams = (params: WaBulkTemplate["params"]) =>
  params.filter((param) => isWaBodyTemplateParam(param.name));

export const sampleValueForWaMappedField = (token: WaParamFieldToken) => {
  if (token === "student_name") return "Rahul Sharma";
  if (token === "phone") return "+91 98765 43210";
  if (token === "email") return "rahul@example.com";
  if (token === "course_name") return "GNM";
  if (token === "campus_name") return "NIMT Greater Noida";
  if (token === "lead_stage") return "new";
  if (token === "lead_source") return "website";
  if (token === "guardian_name") return "Sunita Sharma";
  if (token === "guardian_phone") return "+91 98765 43211";
  return waParamFieldLabel(token);
};

export const isWaParamValueComplete = (name: string, value: string) => {
  if (decodeWaParamFieldMapping(value)) return true;
  return !isWaMappableTemplateParam(name) ? value.trim().length > 0 : value.trim().length > 0;
};
