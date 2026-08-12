import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Shared management UI for reusable catalog entities (authors, publishers). Lists entities with
// book counts, surfaces trigram near-duplicates for one-click merge, and supports rename + bulk merge.
// The RPCs share identical param shapes across entities, so only their names are parameterized.

type EntityRow = { id: string; name: string; book_count: number };
type DupPair = { id_a: string; name_a: string; id_b: string; name_b: string; sim: number };

export function CatalogEntityManager({
  nounSingular,
  nounPlural,
  canManage,
  active,
  listRpc,
  dupPairsRpc,
  mergeRpc,
  renameRpc,
}: {
  nounSingular: string;
  nounPlural: string;
  canManage: boolean;
  active: boolean;
  listRpc: string;
  dupPairsRpc: string;
  mergeRpc: string;
  renameRpc: string;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [search, setSearch] = useState("");
  const [dupPairs, setDupPairs] = useState<DupPair[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [listRes, dupRes] = await Promise.all([
        (supabase as any).rpc(listRpc, { _search: search.trim() || null, _limit: 200 }),
        (supabase as any).rpc(dupPairsRpc, { _threshold: 0.5 }),
      ]);
      if (!listRes.error) setRows(listRes.data || []);
      if (!dupRes.error) setDupPairs(dupRes.data || []);
    } catch {
      // non-fatal; tab simply shows nothing
    }
  };

  useEffect(() => {
    if (!active || !canManage) return;
    const t = setTimeout(fetchData, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, search, canManage]);

  const handleMerge = async (keepId: string, mergeIds: string[]) => {
    if (!canManage || !mergeIds.length) return;
    setSaving(`merge-${keepId}`);
    try {
      const { error } = await (supabase as any).rpc(mergeRpc, { _keep: keepId, _merge: mergeIds });
      if (error) throw error;
      toast({ title: `${nounPlural} merged`, description: `${mergeIds.length} merged into one.` });
      setSelected(new Set());
      fetchData();
    } catch (err: any) {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleRename = async (id: string, currentName: string) => {
    if (!canManage) return;
    const next = window.prompt(`Rename ${nounSingular}`, currentName);
    if (next == null || next.trim() === "" || next.trim() === currentName) return;
    setSaving(`rename-${id}`);
    try {
      const { error } = await (supabase as any).rpc(renameRpc, { _id: id, _name: next.trim() });
      if (error) throw error;
      toast({ title: `${nounSingular} renamed` });
      fetchData();
    } catch (err: any) {
      toast({ title: "Rename failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      {dupPairs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Possible duplicate {nounPlural}</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Likely the same {nounSingular} spelled differently. Merge moves all books onto the name you keep.</p>
            <div className="space-y-2">
              {dupPairs.map((pair) => (
                <div key={`${pair.id_a}-${pair.id_b}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div className="text-sm">
                    <span className="font-medium text-foreground">{pair.name_a}</span>
                    <span className="mx-2 text-muted-foreground">↔</span>
                    <span className="font-medium text-foreground">{pair.name_b}</span>
                    <Badge variant="secondary" className="ml-2">{Math.round(pair.sim * 100)}% match</Badge>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={saving === `merge-${pair.id_a}`} onClick={() => handleMerge(pair.id_a, [pair.id_b])}>
                        Keep “{pair.name_a}”
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={saving === `merge-${pair.id_b}`} onClick={() => handleMerge(pair.id_b, [pair.id_a])}>
                        Keep “{pair.name_b}”
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base capitalize">{nounPlural}</CardTitle>
          {canManage && selected.size >= 2 && (
            <Button type="button" size="sm" disabled={saving?.startsWith("merge-")} onClick={() => {
              const ids = [...selected];
              handleMerge(ids[0], ids.slice(1));
            }}>
              Merge {selected.size} into “{rows.find((r) => r.id === [...selected][0])?.name}”
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${nounPlural}…`}
            className="mb-3 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="space-y-1">
            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">No {nounPlural} yet — approve digitization records or import books to build the {nounSingular} list</div>
            ) : rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <label className="flex min-w-0 items-center gap-2">
                  {canManage && (
                    <input type="checkbox" className="h-4 w-4 rounded border-border" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                  )}
                  <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                </label>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">{row.book_count} {row.book_count === 1 ? "book" : "books"}</Badge>
                  {canManage && (
                    <Button type="button" variant="ghost" size="sm" disabled={saving === `rename-${row.id}`} onClick={() => handleRename(row.id, row.name)}>
                      Rename
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {canManage && selected.size >= 2 && (
            <p className="mt-3 text-xs text-muted-foreground">Tip: the first {nounSingular} you selected is kept as the canonical name when merging.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
