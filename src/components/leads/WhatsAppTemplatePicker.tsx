import { Loader2, Check } from "lucide-react";
import {
  WhatsAppTemplatePreviewBubble,
  type WhatsAppTemplateComponent,
} from "@/components/templates/WhatsAppTemplatePreviewBubble";
import type { WhatsAppPickerTemplate } from "@/components/leads/whatsappTemplates";

interface Props {
  /** null = still loading the visibility set. */
  allowedKeys: Set<string> | null;
  templates: WhatsAppPickerTemplate[];
  componentsByKey: Record<string, WhatsAppTemplateComponent[]>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  previewText: string;
  listClassName?: string;
  previewClassName?: string;
}

/**
 * Template list + live preview bubble. Shared by SendWhatsAppDialog and the
 * Cloud Dialer's WhatsApp rail so both show the same set and the same preview.
 */
export function WhatsAppTemplatePicker({
  allowedKeys, templates, componentsByKey, selectedKey, onSelect, previewText,
  listClassName = "max-h-[220px]", previewClassName = "max-h-[280px]",
}: Props) {
  return (
    <>
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Choose Template</p>
        <div className={`border border-border rounded-xl overflow-hidden divide-y divide-border overflow-y-auto ${listClassName}`}>
          {allowedKeys === null && (
            <div className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading templates…
            </div>
          )}
          {allowedKeys !== null && templates.length === 0 && (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">
              No templates available. Ask an admin to enable templates in Template Manager → Template Visibility.
            </div>
          )}
          {templates.map((t) => (
            <button
              key={t.key}
              onClick={() => onSelect(t.key)}
              className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-3 ${
                selectedKey === t.key
                  ? "bg-success/5 dark:bg-success/90/20 border-l-2 border-l-green-500"
                  : "text-foreground hover:bg-muted/50 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className={`text-sm font-medium ${selectedKey === t.key ? "text-success dark:text-success" : ""}`}>{t.label}</p>
                  {t.badge === "Video" && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">VIDEO</span>}
                  {t.badge === "Location" && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-info/10 text-info-foreground">LOCATION</span>}
                  {t.isQuickReply && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">KB</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
              </div>
              {selectedKey === t.key && <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />}
            </button>
          ))}
        </div>
      </div>

      {selectedKey && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Preview</p>
          <WhatsAppTemplatePreviewBubble
            templateKey={selectedKey}
            components={componentsByKey[selectedKey]}
            bodyText={previewText}
            fallbackText={previewText}
            className={`overflow-y-auto ${previewClassName}`}
          />
        </div>
      )}
    </>
  );
}
