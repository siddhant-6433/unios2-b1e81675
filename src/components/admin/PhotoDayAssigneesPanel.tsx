import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, ChevronDown, ChevronRight, Search, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";

type StaffRow = {
  user_id: string;
  display_name: string;
  role: string;
  campus_id: string | null;
  campus_name: string | null;
  has_capture: boolean;
};

/**
 * Principal / super_admin panel to grant Photo Day capture to any campus staff.
 * Uses assign_photo_day RPC (campus-scoped for principals).
 */
export function PhotoDayAssigneesPanel() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const checkAccess = useCallback(async () => {
    if (!user?.id) {
      setAllowed(false);
      setChecking(false);
      return;
    }
    if (role === "super_admin" || role === "principal") {
      setAllowed(true);
      setChecking(false);
      return;
    }
    const { data, error } = await supabase.rpc("can_assign_photo_day" as never, {
      _user_id: user.id,
    } as never);
    if (error) {
      console.warn("[PhotoDayAssignees] can_assign check failed:", error.message);
      setAllowed(false);
    } else {
      setAllowed(Boolean(data));
    }
    setChecking(false);
  }, [user?.id, role]);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_photo_day_staff" as never);
    if (error) {
      toast({ title: "Could not load staff", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows(((data || []) as StaffRow[]).map((row) => ({
        ...row,
        display_name: row.display_name || "Unnamed",
        role: row.role || "",
      })));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  useEffect(() => {
    if (allowed && open && rows.length === 0) loadStaff();
  }, [allowed, open, rows.length, loadStaff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      row.display_name.toLowerCase().includes(q) ||
      row.role.toLowerCase().includes(q) ||
      (row.campus_name || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const toggle = async (row: StaffRow) => {
    setSavingId(row.user_id);
    try {
      const next = !row.has_capture;
      const { data, error } = await supabase.rpc("assign_photo_day" as never, {
        _target_user_id: row.user_id,
        _granted: next,
      } as never);
      if (error) throw error;
      if ((data as { ok?: boolean } | null)?.ok === false) {
        throw new Error("Assign failed");
      }
      setRows((current) =>
        current.map((r) => (r.user_id === row.user_id ? { ...r, has_capture: next } : r))
      );
      toast({
        title: next ? "Photo Day enabled" : "Photo Day revoked",
        description: `${row.display_name} ${next ? "can" : "can no longer"} capture student photos.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to update Photo Day access";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  if (checking) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-border bg-card">
        <OrbLoader state="searching" />
      </div>
    );
  }

  if (!allowed) return null;

  return (
    <div className="print:hidden rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-start gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="mt-0.5 h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Camera className="h-4 w-4 text-primary" />
              Photo Day assignees
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Grant capture access to any staff member on your campus. They use the mobile app class-by-class.
            </p>
          </div>
        </button>
        {open && (
          <button
            type="button"
            onClick={loadStaff}
            disabled={loading}
            className="rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {open && (
      <>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, role, campus…"
          className="pl-9 h-9 text-sm"
        />
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex h-20 items-center justify-center">
          <OrbLoader state="searching" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          No staff found for your campus.
        </div>
      ) : (
        <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {filtered.map((row) => (
            <div key={row.user_id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{row.display_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.role.replace(/_/g, " ")}
                  {row.campus_name ? ` · ${row.campus_name}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(row)}
                disabled={savingId === row.user_id}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  row.has_capture
                    ? "bg-primary/15 text-primary hover:bg-primary/25"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {savingId === row.user_id ? (
                  <ButtonOrb state="working" onFilled />
                ) : row.has_capture ? (
                  "Capture on"
                ) : (
                  "Capture off"
                )}
              </button>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
