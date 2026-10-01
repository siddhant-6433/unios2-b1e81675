import type { WhatsAppTemplateComponent } from "@/lib/whatsappTemplateCatalog";

export type WhatsAppWebTemplateResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export interface WhatsAppWebOnlyTemplate {
  template_key: string;
  display_name: string;
  category: string;
  body: string;
  attachment_label: string | null;
  attachment_url: string | null;
}

export function renderWhatsAppWebOnlyTemplate(
  template: WhatsAppWebOnlyTemplate,
  context: { student_name?: string | null; course_name?: string | null; campus_name?: string | null; application_id?: string | null },
): WhatsAppWebTemplateResult {
  const values: Record<string, string> = {
    student_name: context.student_name || "",
    course_name: context.course_name || "",
    campus_name: context.campus_name || "",
    application_id: context.application_id || "",
  };
  let missing = false;
  let text = template.body.replace(/\{\{([a-z_]+)\}\}/gi, (token, name: string) => {
    const value = values[name.toLowerCase()];
    if (!value) {
      missing = true;
      return token;
    }
    return value;
  });
  if (missing || /\{\{[^}]+\}\}/.test(text)) {
    return { ok: false, reason: "This Web template has a field that is missing from the lead." };
  }
  if (template.attachment_url) {
    if (!/^https:\/\//i.test(template.attachment_url)) {
      return { ok: false, reason: "The attachment must be a public HTTPS link." };
    }
    text = `${text.trim()}\n\n${template.attachment_label?.trim() || "View file"}: ${template.attachment_url}`;
  }
  return { ok: true, text: text.trim() };
}

/** Render a body-only template for a manual WhatsApp Web handoff. */
export function renderWhatsAppWebTemplate(args: {
  components?: WhatsAppTemplateComponent[];
  fallbackText?: string;
  quickReplyText?: string;
  params?: string[];
  followUpText?: string | null;
  needsMediaHeader?: boolean;
}): WhatsAppWebTemplateResult {
  const { components = [], params = [] } = args;
  const buttonComponent = components.some((component) => component.type === "BUTTONS");
  const mediaHeader = components.some((component) =>
    component.type === "HEADER" && ["IMAGE", "VIDEO", "DOCUMENT"].includes(String(component.format || "").toUpperCase()),
  );
  if (args.needsMediaHeader || mediaHeader) {
    return { ok: false, reason: "This template has a media header. Send it through WhatsApp instead." };
  }
  if (buttonComponent) {
    return { ok: false, reason: "This template has interactive buttons. Send it through WhatsApp instead." };
  }

  const header = components.find((component) => component.type === "HEADER");
  if (header && String(header.format || "").toUpperCase() !== "TEXT") {
    return { ok: false, reason: "This template has a non-text header. Send it through WhatsApp instead." };
  }
  if (header?.text && /\{\{\d+\}\}/.test(header.text)) {
    return { ok: false, reason: "This template has a dynamic header that cannot be safely prefilled." };
  }

  let body = args.quickReplyText || components.find((component) => component.type === "BODY")?.text || args.fallbackText || "";
  if (!body.trim()) return { ok: false, reason: "This template has no text body to prefill." };

  let missingParam = false;
  body = body.replace(/\{\{(\d+)\}\}/g, (_match, position: string) => {
    const value = params[Number(position) - 1];
    if (value == null || !String(value).trim()) {
      missingParam = true;
      return _match;
    }
    return String(value);
  });
  if (missingParam) return { ok: false, reason: "Fill in all template details before opening WhatsApp Web." };

  // Hand-written picker previews sometimes contain explanatory placeholders,
  // which are not appropriate to send to a lead.
  if (/<[^>]+>/.test(body)) return { ok: false, reason: "This template needs details that cannot be prefilled safely." };
  if (header?.text?.trim()) body = `${header.text.trim()}\n\n${body}`;
  if (args.followUpText?.trim()) body = `${body.trim()}\n\n${args.followUpText.trim()}`;
  return { ok: true, text: body.trim() };
}

export function buildWhatsAppWebUrl(phone: string, message: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`;
}
