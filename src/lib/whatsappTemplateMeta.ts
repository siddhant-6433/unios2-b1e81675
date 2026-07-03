import { invokeEdge } from "@/integrations/supabase/edge";
import {
  templateTextPreviewFromComponents,
  type WhatsAppTemplateComponent,
} from "@/components/templates/WhatsAppTemplatePreviewBubble";

export type ApprovedWhatsAppTemplateMetadata = {
  name: string;
  components?: WhatsAppTemplateComponent[] | null;
  placeholder_count?: number | null;
  has_media?: boolean | null;
  header_format?: string | null;
};

type MetaTemplateRow = {
  name?: string | null;
  status?: string | null;
  components?: WhatsAppTemplateComponent[] | null;
};

const normalizeType = (value?: string | null) => String(value || "").toUpperCase();

const placeholderCountFromComponents = (components?: WhatsAppTemplateComponent[] | null) => {
  const body = components?.find((component) => normalizeType(component.type) === "BODY");
  return (String(body?.text || "").match(/\{\{\d+\}\}/g) || []).length;
};

const headerFormatFromComponents = (components?: WhatsAppTemplateComponent[] | null) => {
  const header = components?.find((component) => normalizeType(component.type) === "HEADER");
  return normalizeType(header?.format) || "NONE";
};

const hasMediaHeader = (headerFormat: string) => ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat);

export async function enrichApprovedWhatsAppTemplateMetadata(
  approvedRows: ApprovedWhatsAppTemplateMetadata[],
  templateKeys: string[],
): Promise<ApprovedWhatsAppTemplateMetadata[]> {
  const approvedByName = new Map(approvedRows.map((row) => [row.name, row] as const));
  const keysNeedingPreview = templateKeys.filter((key) => {
    const row = approvedByName.get(key);
    return !templateTextPreviewFromComponents(row?.components);
  });
  if (keysNeedingPreview.length === 0) return approvedRows;

  const needed = new Set(keysNeedingPreview);
  const { data, error } = await invokeEdge<{ templates?: MetaTemplateRow[] }>("whatsapp-templates", {
    body: { action: "list" },
  });
  if (error || !data?.templates) return approvedRows;

  data.templates
    .filter((template) =>
      template.name &&
      needed.has(template.name) &&
      normalizeType(template.status) === "APPROVED"
    )
    .forEach((template) => {
      const name = template.name as string;
      const existing = approvedByName.get(name);
      const components = template.components || existing?.components || null;
      const headerFormat = existing?.header_format || headerFormatFromComponents(components);
      approvedByName.set(name, {
        ...existing,
        name,
        components,
        placeholder_count: existing?.placeholder_count ?? placeholderCountFromComponents(components),
        has_media: existing?.has_media ?? hasMediaHeader(headerFormat),
        header_format: headerFormat,
      });
    });

  return Array.from(approvedByName.values());
}
