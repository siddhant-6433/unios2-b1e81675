import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

export interface EmailTemplate {
  id: string;
  name: string;
  slug: string;
  subject: string;
  body_html: string;
  variables: string[];
  category: string;
}

/** Active email templates, loaded once `enabled` flips true. */
export function useEmailTemplates(enabled: boolean): EmailTemplate[] {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    supabase
      .from("email_templates" as any)
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (!cancelled && data) setTemplates(data as any);
      });
    return () => { cancelled = true; };
  }, [enabled]);
  return templates;
}

/** Substitutes {{var}} placeholders. */
export function fillEmailVars(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
  }
  return out;
}

export async function sendEmailTemplate(args: {
  templateSlug: string;
  toEmail: string;
  variables: Record<string, string>;
  leadId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("send-email", {
    body: {
      template_slug: args.templateSlug,
      to_email: args.toEmail,
      variables: args.variables,
      lead_id: args.leadId,
    },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

interface Props {
  templates: EmailTemplate[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

export function EmailTemplatePicker({ templates, selectedSlug, onSelect }: Props) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-muted-foreground mb-2">Select Template</label>
      <div className="space-y-1.5">
        {templates.map((t) => (
          <button
            key={t.slug}
            onClick={() => onSelect(t.slug)}
            className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
              selectedSlug === t.slug
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40 hover:bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{t.name}</span>
              <Badge variant="outline" className="text-[9px]">{t.category}</Badge>
            </div>
          </button>
        ))}
        {templates.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No email templates configured</p>
        )}
      </div>
    </div>
  );
}
