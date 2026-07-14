import { ExternalLink, FileText, ImageIcon, Phone, Reply, Video } from "lucide-react";

export interface WhatsAppTemplateButtonComponent {
  type?: string;
  text?: string;
  url?: string;
  phone_number?: string;
}

export interface WhatsAppTemplateComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: WhatsAppTemplateButtonComponent[];
  example?: {
    header_handle?: string[];
    header_text?: string[];
    body_text?: string[][];
  };
}

const CUET_2026_COUNSELLING_IMAGE_URL =
  "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/whatsapp-media/template-assets/cuet_2026_counselling_open.jpeg";

const KNOWN_TEMPLATE_MEDIA: Record<string, string> = {
  cuet_2026_counselling_open: CUET_2026_COUNSELLING_IMAGE_URL,
  cuet_counselling_booking: CUET_2026_COUNSELLING_IMAGE_URL,
};

const normalizeType = (value?: string | null) => String(value || "").toUpperCase();

export const templateBodyFromComponents = (components?: WhatsAppTemplateComponent[] | null) =>
  components?.find((component) => normalizeType(component.type) === "BODY")?.text || "";

export const templateFooterFromComponents = (components?: WhatsAppTemplateComponent[] | null) =>
  components?.find((component) => normalizeType(component.type) === "FOOTER")?.text || "";

export const templateHeaderFromComponents = (components?: WhatsAppTemplateComponent[] | null) =>
  components?.find((component) => normalizeType(component.type) === "HEADER");

export const templateButtonsFromComponents = (components?: WhatsAppTemplateComponent[] | null) =>
  components?.find((component) => normalizeType(component.type) === "BUTTONS")?.buttons || [];

export const templateTextPreviewFromComponents = (components?: WhatsAppTemplateComponent[] | null) =>
  templateBodyFromComponents(components);

export const resolveTemplateMediaUrl = (templateKey?: string | null, header?: WhatsAppTemplateComponent) => {
  if (templateKey && KNOWN_TEMPLATE_MEDIA[templateKey]) return KNOWN_TEMPLATE_MEDIA[templateKey];
  const handle = header?.example?.header_handle?.[0];
  if (handle && /^https?:\/\//i.test(handle)) return handle;
  return null;
};

export const templateMediaUrlFromComponents = (
  templateKey?: string | null,
  components?: WhatsAppTemplateComponent[] | null,
) => resolveTemplateMediaUrl(templateKey, templateHeaderFromComponents(components));

const buttonIcon = (type?: string) => {
  const normalized = normalizeType(type);
  if (normalized === "URL") return ExternalLink;
  if (normalized === "PHONE_NUMBER") return Phone;
  return Reply;
};

const mediaIcon = (format: string) => {
  if (format === "VIDEO") return Video;
  if (format === "DOCUMENT") return FileText;
  return ImageIcon;
};

export function WhatsAppTemplatePreviewBubble({
  templateKey,
  components,
  bodyText,
  fallbackText,
  className = "",
}: {
  templateKey?: string | null;
  components?: WhatsAppTemplateComponent[] | null;
  bodyText?: string | null;
  fallbackText?: string | null;
  className?: string;
}) {
  const header = templateHeaderFromComponents(components);
  const headerFormat = normalizeType(header?.format);
  const footer = templateFooterFromComponents(components);
  const buttons = templateButtonsFromComponents(components);
  const mediaUrl = resolveTemplateMediaUrl(templateKey, header);
  const messageBody = bodyText || templateBodyFromComponents(components) || fallbackText || "No body text synced for this template.";
  const MediaIcon = mediaIcon(headerFormat);
  const showMediaPlaceholder = headerFormat && ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && !mediaUrl;

  return (
    <div className={`rounded-xl border border-success/20/70 bg-[#dbe9df] p-3 ${className}`}>
      <div className="mx-auto max-w-sm">
        <div className="overflow-hidden rounded-lg bg-white shadow-sm">
          {mediaUrl && (
            <img
              src={mediaUrl}
              alt={`${templateKey || "WhatsApp template"} media preview`}
              className="aspect-[1.91/1] w-full bg-muted object-cover"
            />
          )}

          {showMediaPlaceholder && (
            <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-muted text-muted-foreground">
              <div className="text-center">
                <MediaIcon className="mx-auto h-8 w-8" />
                <p className="mt-2 text-[11px] font-medium uppercase">{headerFormat} header</p>
              </div>
            </div>
          )}

          {headerFormat === "TEXT" && header?.text && (
            <div className="border-b border-border/60 px-3 py-2">
              <p className="whitespace-pre-wrap text-sm font-semibold leading-5 text-foreground">{header.text}</p>
            </div>
          )}

          <div className="px-3 py-2.5">
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-slate-900">{messageBody}</p>
            {footer && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-slate-500">{footer}</p>}
            <p className="mt-2 text-right text-[10px] text-slate-400">14:13</p>
          </div>

          {buttons.length > 0 && (
            <div className="border-t border-slate-100">
              {buttons.map((button, index) => {
                const Icon = buttonIcon(button.type);
                return (
                  <div
                    key={`${button.text || "button"}-${index}`}
                    className="flex items-center justify-center gap-2 border-b border-slate-100 px-3 py-2 text-[13px] font-medium text-[#128C7E] last:border-b-0"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="truncate">{button.text || `Button ${index + 1}`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
