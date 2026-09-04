import { sendableHeaderMediaUrl } from "@/components/templates/WhatsAppTemplatePreviewBubble";
import { classifyHeaderMediaUrl } from "@/lib/publicMediaUrl";

/**
 * Fill `template_header_media_url` from Template Manager when the field is
 * empty, without wiping a counsellor's typed override. A late-arriving default
 * (settings load after the template pick) still fills a blank field. An empty
 * default must never clear a URL that is already showing.
 */
export function nextHeaderMediaParams(
  current: Record<string, string>,
  defaultUrl: string,
  templateKey: string,
  lastAutoKey: string,
  lastAutoUrl: string,
): { params: Record<string, string>; lastAutoKey: string; lastAutoUrl: string } {
  const existing = (current.template_header_media_url || "").trim();
  const def = (defaultUrl || "").trim();
  const templateChanged = lastAutoKey !== templateKey;

  if (templateChanged) {
    if (existing === def) {
      return { params: current, lastAutoKey: templateKey, lastAutoUrl: def };
    }
    return {
      params: { ...current, template_header_media_url: def },
      lastAutoKey: templateKey,
      lastAutoUrl: def,
    };
  }

  // Typed override — keep it even if the saved default later appears or changes.
  if (existing && existing !== lastAutoUrl) {
    return { params: current, lastAutoKey: templateKey, lastAutoUrl };
  }

  // Don't blank a filled field if the default lookup briefly returns empty.
  if (!def && existing) {
    return { params: current, lastAutoKey: templateKey, lastAutoUrl };
  }

  if (existing === def) {
    return { params: current, lastAutoKey: templateKey, lastAutoUrl: def };
  }

  return {
    params: { ...current, template_header_media_url: def },
    lastAutoKey: templateKey,
    lastAutoUrl: def,
  };
}

export function resolvedHeaderMediaUrl(fieldValue: string, defaultUrl?: string | null): string | null {
  return sendableHeaderMediaUrl(fieldValue || defaultUrl || "");
}

export function headerMediaIsSendable(fieldValue: string, defaultUrl?: string | null): boolean {
  const url = resolvedHeaderMediaUrl(fieldValue, defaultUrl);
  return Boolean(url && classifyHeaderMediaUrl(url).ok);
}

/** Meta needs the header on the matching component type, not always `header_image_url`. */
export function headerMediaSendFields(
  headerFormat: string | null | undefined,
  url: string | null | undefined,
): { header_image_url?: string; header_video_url?: string; header_document_url?: string } {
  const sendable = sendableHeaderMediaUrl(url);
  if (!sendable) return {};
  const format = String(headerFormat || "IMAGE").toUpperCase();
  if (format === "DOCUMENT") return { header_document_url: sendable };
  if (format === "VIDEO") return { header_video_url: sendable };
  return { header_image_url: sendable };
}
