import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Search, X, Building2 } from "lucide-react";
import type { VendorCandidate } from "@/components/video/VendorMatchDialog";

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

// Proactively link a video editor to an existing Zoho vendor (by phone or name).
// Setting this means "Send to Zoho" never prompts for this editor. Leave blank to keep
// the reactive sync-time picker behavior.
export function ZohoVendorLinkField({
  phone,
  value,
  onChange,
}: {
  phone: string | null | undefined;
  value: string | null | undefined;
  onChange: (contactId: string | null, name?: string) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState(phone || "");
  const [results, setResults] = useState<VendorCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const search = async () => {
    setSearching(true);
    const digits = (query || "").replace(/\D/g, "");
    const body = digits.length >= 10 ? { action: "find_vendors", phone: query } : { action: "find_vendors", query };
    const { data, error } = await supabase.functions.invoke("zoho-video-bill-sync", { body });
    setSearching(false);
    const res = data as { error?: string; candidates?: VendorCandidate[] } | null;
    const errMsg = error?.message || res?.error;
    if (errMsg) { toast({ title: "Zoho search failed", description: errMsg, variant: "destructive" }); return; }
    setResults(res?.candidates || []);
  };

  const pick = (c: VendorCandidate) => {
    setPickedName(c.contact_name);
    setResults(null);
    onChange(c.contact_id, c.contact_name);
  };

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <label className="block text-[11px] font-semibold uppercase text-muted-foreground">Zoho vendor (optional)</label>
      {value ? (
        <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="flex items-center gap-2 text-sm min-w-0">
            <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">{pickedName || "Linked vendor"} <span className="text-muted-foreground text-xs">({value.slice(0, 8)}…)</span></span>
          </span>
          <button type="button" onClick={() => { onChange(null); setPickedName(null); }} className="text-muted-foreground hover:text-destructive" title="Unlink">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Zoho by phone or name"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); search(); } }} className={inputCls} />
            <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" disabled={searching || !query.trim()} onClick={search}>
              {searching ? <ButtonOrb state="composing" /> : <Search className="h-3.5 w-3.5" />} Search
            </Button>
          </div>
          {results && (
            results.length === 0
              ? <p className="text-xs text-muted-foreground">No matching Zoho vendors. Leave blank — a vendor can be picked or created when you send the bill.</p>
              : <div className="space-y-1 max-h-40 overflow-y-auto">
                  {results.map(c => (
                    <button type="button" key={c.contact_id} onClick={() => pick(c)}
                      className="w-full text-left rounded-lg border border-border/60 px-3 py-2 hover:bg-muted/40">
                      <div className="text-sm font-medium">{c.contact_name}{c.company_name ? ` · ${c.company_name}` : ""}</div>
                      <div className="text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ") || "No phone/email"}</div>
                    </button>
                  ))}
                </div>
          )}
        </>
      )}
    </div>
  );
}
