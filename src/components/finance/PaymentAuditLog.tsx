/**
 * Payment audit log viewer.
 *
 * Reads `payment_audit_log` (populated by AFTER triggers on
 * lead_payments / payments / fee_ledger / fee_ledger_payments /
 * concessions / offer_waivers / applications.payment_status).
 *
 * Filters by table, op, actor, date range, and natural-key search.
 * Click any row to expand into the full diff (delta JSONB) so the
 * before/after of every changed field is visible.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, FileSearch, ChevronDown, ChevronRight, Filter,
  PlusCircle, Pencil, Trash2,
} from "lucide-react";

interface AuditRow {
  id: string;
  event_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  op: "INSERT" | "UPDATE" | "DELETE";
  table_name: string;
  row_id: string;
  natural_key: string | null;
  changed_fields: string[] | null;
  old_value: Record<string, any> | null;
  new_value: Record<string, any> | null;
  delta: Record<string, { from: any; to: any }> | null;
}

const OP_BADGE: Record<string, string> = {
  INSERT: "bg-success/10 text-success",
  UPDATE: "bg-warning/10 text-warning-foreground",
  DELETE: "bg-destructive/10 text-destructive",
};
const OP_ICON: Record<string, typeof PlusCircle> = {
  INSERT: PlusCircle,
  UPDATE: Pencil,
  DELETE: Trash2,
};
const TABLE_LABEL: Record<string, string> = {
  lead_payments: "Lead Payment",
  payments: "Student Payment",
  fee_ledger: "Fee Ledger",
  fee_ledger_payments: "Ledger ↔ Payment Link",
  concessions: "Concession",
  offer_waivers: "Offer Waiver",
  applications: "Application",
};

type DateFilter = "today" | "yesterday" | "this_week" | "last_30" | "all";

function dateRange(f: DateFilter): { from: string | null } {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (f === "today") return { from: new Date(now - day).toISOString() };
  if (f === "yesterday") return { from: new Date(now - 2 * day).toISOString() };
  if (f === "this_week") return { from: new Date(now - 7 * day).toISOString() };
  if (f === "last_30") return { from: new Date(now - 30 * day).toISOString() };
  return { from: null };
}

function formatVal(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function PaymentAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [profMap, setProfMap] = useState<Record<string, string>>({});

  const [tableFilter, setTableFilter] = useState<string>("all");
  const [opFilter, setOpFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("this_week");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { from } = dateRange(dateFilter);
      let q = supabase
        .from("payment_audit_log" as any)
        .select("*")
        .order("event_at", { ascending: false })
        .limit(500);
      if (from) q = q.gte("event_at", from);
      if (tableFilter !== "all") q = q.eq("table_name", tableFilter);
      if (opFilter !== "all") q = q.eq("op", opFilter);
      const { data } = await q;
      if (cancelled) return;
      const auditRows = (data as AuditRow[]) || [];
      setRows(auditRows);

      // Batch-fetch actor display names
      const actorIds = [...new Set(auditRows.map((r) => r.actor_user_id).filter(Boolean) as string[])];
      if (actorIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", actorIds);
        const m: Record<string, string> = {};
        (profs || []).forEach((p: any) => { m[p.user_id] = p.display_name || "—"; });
        if (!cancelled) setProfMap(m);
      } else {
        setProfMap({});
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tableFilter, opFilter, dateFilter]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      (r.natural_key || "").toLowerCase().includes(q) ||
      r.row_id.toLowerCase().includes(q) ||
      (r.changed_fields || []).some((f) => f.toLowerCase().includes(q)) ||
      Object.keys(r.delta || {}).some((k) => k.toLowerCase().includes(q))
    );
  }, [rows, search]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-0">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border bg-muted/20">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground/70 mr-1">Filters:</span>

          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="rounded-lg border border-input bg-background px-2 py-1 text-xs">
            <option value="today">Today</option>
            <option value="yesterday">Last 48h</option>
            <option value="this_week">Last 7 days</option>
            <option value="last_30">Last 30 days</option>
            <option value="all">All time</option>
          </select>

          <select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}
            className="rounded-lg border border-input bg-background px-2 py-1 text-xs">
            <option value="all">All tables</option>
            {Object.entries(TABLE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>

          <select value={opFilter} onChange={(e) => setOpFilter(e.target.value)}
            className="rounded-lg border border-input bg-background px-2 py-1 text-xs">
            <option value="all">All ops</option>
            <option value="INSERT">Inserts</option>
            <option value="UPDATE">Updates</option>
            <option value="DELETE">Deletes</option>
          </select>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by application_id / receipt_no / field name…"
            className="flex-1 min-w-[260px] rounded-lg border border-input bg-background px-3 py-1 text-xs"
          />

          <span className="ml-auto text-[11px] text-muted-foreground">
            {loading ? "…" : `${filteredRows.length} of ${rows.length} entries`}
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center">
            <FileSearch className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No audit entries match these filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="px-4 py-2 w-6"></th>
                  <th className="px-4 py-2 text-left font-medium">When</th>
                  <th className="px-4 py-2 text-left font-medium">Op</th>
                  <th className="px-4 py-2 text-left font-medium">Table</th>
                  <th className="px-4 py-2 text-left font-medium">Identifier</th>
                  <th className="px-4 py-2 text-left font-medium">Changed</th>
                  <th className="px-4 py-2 text-left font-medium">Actor</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const isOpen = expanded.has(r.id);
                  const Icon = OP_ICON[r.op];
                  const actor = r.actor_user_id ? (profMap[r.actor_user_id] || r.actor_user_id.slice(0, 8)) : "system";
                  return (
                    <>
                      <tr
                        key={r.id}
                        onClick={() => toggle(r.id)}
                        className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                      >
                        <td className="px-4 py-2 align-top">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                          {new Date(r.event_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                        </td>
                        <td className="px-4 py-2">
                          <Badge className={`text-[10px] border-0 ${OP_BADGE[r.op]}`}>
                            <Icon className="h-2.5 w-2.5 mr-1" />{r.op}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-foreground/80">
                          {TABLE_LABEL[r.table_name] || r.table_name}
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-foreground">
                          {r.natural_key || <span className="text-muted-foreground">{r.row_id.slice(0, 8)}</span>}
                        </td>
                        <td className="px-4 py-2">
                          {r.op === "UPDATE" && r.changed_fields?.length ? (
                            <div className="flex flex-wrap gap-1 max-w-[420px]">
                              {r.changed_fields.slice(0, 4).map((f) => (
                                <span key={f} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{f}</span>
                              ))}
                              {r.changed_fields.length > 4 && (
                                <span className="text-[10px] text-muted-foreground">+{r.changed_fields.length - 4}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-foreground/80">
                          {actor}
                          {r.actor_role && <span className="ml-1 text-[10px] text-muted-foreground">({r.actor_role})</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${r.id}-detail`} className="bg-muted/10">
                          <td></td>
                          <td colSpan={6} className="px-4 py-3">
                            {r.op === "UPDATE" && r.delta ? (
                              <div className="space-y-1">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Diff</p>
                                <div className="font-mono text-[11px] space-y-0.5">
                                  {Object.entries(r.delta).map(([field, { from, to }]) => (
                                    <div key={field} className="flex items-start gap-2">
                                      <span className="font-semibold text-foreground/80 min-w-[160px]">{field}</span>
                                      <span className="text-destructive line-through">{formatVal(from)}</span>
                                      <span className="text-muted-foreground">→</span>
                                      <span className="text-success">{formatVal(to)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : r.op === "INSERT" && r.new_value ? (
                              <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Inserted row</p>
                                <pre className="font-mono text-[11px] bg-background border border-border rounded p-2 overflow-x-auto">{JSON.stringify(r.new_value, null, 2)}</pre>
                              </div>
                            ) : r.op === "DELETE" && r.old_value ? (
                              <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Deleted row</p>
                                <pre className="font-mono text-[11px] bg-background border border-border rounded p-2 overflow-x-auto">{JSON.stringify(r.old_value, null, 2)}</pre>
                              </div>
                            ) : (
                              <p className="text-muted-foreground italic">No detail available.</p>
                            )}
                            <div className="mt-2 text-[10px] text-muted-foreground">
                              Row ID: <span className="font-mono">{r.row_id}</span>
                              {r.natural_key && <> · Natural key: <span className="font-mono">{r.natural_key}</span></>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
