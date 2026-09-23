// Publisher canonicalisation review surface.
//
// Imported registers carry hundreds of shorthands/typos for the same houses. A
// seeded alias dictionary resolves most of them automatically; this component lets
// staff consolidate the rest: inspect the actual books behind a name, map an
// unresolved string to a canonical name (which adds an alias and rewrites the
// staging/catalog rows), review the resulting groups, and prune aliases.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ChevronDown, ChevronRight, Layers, Printer, Trash2, Wand2 } from "lucide-react";

type UsageRow = {
  publisher: string;
  row_count: number;
  canonical_name: string | null;
  alias_norm: string | null;
  is_resolved: boolean;
};
type AliasRow = { alias_norm: string; canonical_name: string; canonical_norm: string };
type PublisherRecord = {
  source: string;
  accession_no: string | null;
  title: string | null;
  branch_name: string | null;
  status: string | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char] || char));
}

export function PublisherNormalizer({ canManage, active }: { canManage: boolean; active: boolean }) {
  const { toast } = useToast();
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [search, setSearch] = useState("");
  const [mapInputs, setMapInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [recordsByKey, setRecordsByKey] = useState<Record<string, PublisherRecord[]>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usageRes, aliasRes] = await Promise.all([
        (supabase as any).rpc("library_publisher_usage", { _search: null, _limit: 500 }),
        (supabase as any).rpc("library_list_publisher_aliases", { _search: null, _limit: 500 }),
      ]);
      if (!usageRes.error) setUsage(usageRes.data || []);
      if (!aliasRes.error) setAliases(aliasRes.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active || !canManage) return;
    const t = setTimeout(fetchData, 200);
    return () => clearTimeout(t);
  }, [active, canManage]);

  const loadRecords = async (key: string) => {
    setLoadingKey(key);
    try {
      const { data, error } = await (supabase as any).rpc("library_publisher_records", { _publisher: key, _limit: 400 });
      if (error) throw error;
      setRecordsByKey((cur) => ({ ...cur, [key]: (data || []) as PublisherRecord[] }));
    } catch (err: any) {
      toast({ title: "Could not load books", description: err.message, variant: "destructive" });
    } finally {
      setLoadingKey(null);
    }
  };

  const toggleRecords = (key: string) => {
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (!recordsByKey[key]) loadRecords(key);
  };

  const handlePrintRecords = (key: string, label: string) => {
    const rows = recordsByKey[key] || [];
    if (!rows.length) return;
    const html = `<!doctype html><html><head><title>${escapeHtml(label)} — accession list</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 16px; color:#111; }
        h1 { font-size: 15px; margin: 0 0 2px; }
        p.sub { font-size: 11px; color:#555; margin: 0 0 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; }
        th { background: #eee; }
      </style></head><body>
      <h1>${escapeHtml(label)}</h1>
      <p class="sub">NIMT Library — ${rows.length} record(s) to verify on shelf</p>
      <table><thead><tr><th>Accession</th><th>Title</th><th>Library</th><th>Where</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${escapeHtml(r.accession_no || "—")}</td>
        <td>${escapeHtml(r.title || "—")}</td>
        <td>${escapeHtml(r.branch_name || "—")}</td>
        <td>${escapeHtml(r.source === "catalog" ? "Catalog" : "Review queue")}</td>
        <td>${escapeHtml(r.status || "—")}</td>
      </tr>`).join("")}</tbody></table>
      <script>window.onload = () => window.print();</script></body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      toast({ title: "Popup blocked", description: "Allow popups to print the accession list.", variant: "destructive" });
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  const consolidated = async (label: string) => {
    const { data, error } = await (supabase as any).rpc("library_apply_publisher_canonicalization");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    toast({
      title: label,
      description: `${row?.staging_updated ?? 0} staged rows + ${row?.books_updated ?? 0} book rows rewritten · ${row?.publishers_merged ?? 0} publisher entities merged.`,
    });
    setRecordsByKey({});
    setExpandedKey(null);
    await fetchData();
  };

  const handleConsolidate = async () => {
    if (!canManage) return;
    setSaving("consolidate");
    try {
      await consolidated("Publishers consolidated");
    } catch (err: any) {
      toast({ title: "Consolidation failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleMap = async (publisher: string) => {
    if (!canManage) return;
    const canonical = (mapInputs[publisher] || "").trim();
    if (!canonical) return;
    setSaving(`map-${publisher}`);
    try {
      const { error } = await (supabase as any).rpc("library_set_publisher_alias", { _alias: publisher, _canonical: canonical });
      if (error) throw error;
      setMapInputs((cur) => { const n = { ...cur }; delete n[publisher]; return n; });
      await consolidated("Publisher mapped");
    } catch (err: any) {
      toast({ title: "Mapping failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleRemoveAlias = async (alias_norm: string) => {
    if (!canManage) return;
    setSaving(`alias-${alias_norm}`);
    try {
      const { error } = await (supabase as any).rpc("library_delete_publisher_alias", { _alias_norm: alias_norm });
      if (error) throw error;
      toast({ title: "Alias removed" });
      fetchData();
    } catch (err: any) {
      toast({ title: "Could not remove alias", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return usage;
    return usage.filter((r) =>
      [r.publisher, r.canonical_name].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [usage, search]);

  const resolved = filtered.filter((r) => r.is_resolved);
  const unresolved = filtered.filter((r) => !r.is_resolved);
  const totalRows = usage.reduce((sum, r) => sum + r.row_count, 0);
  const resolvedRows = usage.filter((r) => r.is_resolved).reduce((sum, r) => sum + r.row_count, 0);

  const recordsPanel = (key: string, label: string) => {
    if (expandedKey !== key) return null;
    const rows = recordsByKey[key] || [];
    return (
      <div className="mt-2 rounded-xl border border-border bg-muted/20 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {loadingKey === key ? "Loading books…" : `${rows.length} book${rows.length === 1 ? "" : "s"} on record`}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={!rows.length} onClick={() => handlePrintRecords(key, label)}>
            <Printer className="mr-2 h-4 w-4" /> Print accession list
          </Button>
        </div>
        {rows.length === 0 && loadingKey !== key ? (
          <p className="px-1 py-3 text-xs text-muted-foreground">No records currently carry this name.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr><th className="p-2 font-medium">Accession</th><th className="p-2 font-medium">Title</th><th className="p-2 font-medium">Library</th><th className="p-2 font-medium">Where</th><th className="p-2 font-medium">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={`${r.accession_no}-${i}`}>
                    <td className="p-2 font-mono text-foreground">{r.accession_no || "—"}</td>
                    <td className="p-2 text-foreground">{r.title || "—"}</td>
                    <td className="p-2 text-muted-foreground">{r.branch_name || "—"}</td>
                    <td className="p-2 text-muted-foreground">{r.source === "catalog" ? "Catalog" : "Review queue"}</td>
                    <td className="p-2 text-muted-foreground">{(r.status || "—").replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  if (!canManage) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Publisher consolidation needs catalog access.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4" />
            Publisher consolidation
          </CardTitle>
          <Button type="button" size="sm" disabled={saving === "consolidate"} onClick={handleConsolidate}>
            {saving === "consolidate" ? <ButtonOrb state="working" onFilled /> : <Wand2 className="mr-2 h-4 w-4" />}
            Consolidate now
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 text-xs">
            <Badge variant="outline">{usage.length} distinct names</Badge>
            <Badge variant="outline">{resolvedRows} / {totalRows} rows resolved</Badge>
            <Badge variant={unresolved.length ? "secondary" : "outline"}>{unresolved.length} need mapping</Badge>
            <Badge variant="outline">{aliases.length} aliases</Badge>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search publisher or canonical name…"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          />
          {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        </CardContent>
      </Card>

      {unresolved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs mapping ({unresolved.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Open <span className="font-medium text-foreground">View books</span> to see the accession numbers behind a
              name, check the physical book, then type the correct publisher and press Map.
            </p>
            <div className="space-y-2">
              {unresolved.map((row) => (
                <div key={row.publisher} className="rounded-xl border border-border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{row.publisher}</p>
                      <p className="text-xs text-muted-foreground">{row.row_count} row{row.row_count === 1 ? "" : "s"}{row.alias_norm ? ` · key “${row.alias_norm}”` : ""}</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => toggleRecords(row.publisher)}>
                      {expandedKey === row.publisher ? <ChevronDown className="mr-1 h-4 w-4" /> : <ChevronRight className="mr-1 h-4 w-4" />}
                      View books
                    </Button>
                    <input
                      value={mapInputs[row.publisher] || ""}
                      onChange={(e) => setMapInputs((cur) => ({ ...cur, [row.publisher]: e.target.value }))}
                      placeholder="Canonical publisher name"
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm sm:w-64"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!mapInputs[row.publisher]?.trim() || saving === `map-${row.publisher}`}
                      onClick={() => handleMap(row.publisher)}
                    >
                      {saving === `map-${row.publisher}` ? <ButtonOrb state="working" /> : null}
                      Map
                    </Button>
                  </div>
                  {recordsPanel(row.publisher, row.publisher)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            Canonical groups
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {resolved.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing resolved yet — run Consolidate now.</p>
          ) : (
            Object.entries(
              resolved.reduce<Record<string, { rows: number; variants: string[] }>>((acc, r) => {
                const key = r.canonical_name || "—";
                acc[key] = acc[key] || { rows: 0, variants: [] };
                acc[key].rows += r.row_count;
                acc[key].variants.push(r.publisher);
                return acc;
              }, {}),
            )
              .sort((a, b) => b[1].rows - a[1].rows)
              .map(([canonical, info]) => (
                <div key={canonical} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {canonical}
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{info.variants.length} variant{info.variants.length === 1 ? "" : "s"}</Badge>
                      <Badge variant="outline">{info.rows} rows</Badge>
                      <Button type="button" variant="ghost" size="sm" onClick={() => toggleRecords(canonical)}>
                        {expandedKey === canonical ? <ChevronDown className="mr-1 h-4 w-4" /> : <ChevronRight className="mr-1 h-4 w-4" />}
                        View books
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{info.variants.sort().join(" · ")}</p>
                  {recordsPanel(canonical, canonical)}
                </div>
              ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alias dictionary ({aliases.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {aliases.map((alias) => (
              <div key={alias.alias_norm} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5">
                <div className="min-w-0 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{alias.alias_norm}</span>
                  <span className="mx-2 text-muted-foreground">→</span>
                  <span className="font-medium text-foreground">{alias.canonical_name}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving === `alias-${alias.alias_norm}`}
                  onClick={() => handleRemoveAlias(alias.alias_norm)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
