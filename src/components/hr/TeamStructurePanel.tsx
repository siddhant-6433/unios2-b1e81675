// HR team structure — who reports to whom.
//
// Reads hr_team_structure() (verified, active employees plus their reporting
// manager) and lets HR set/clear each employee's manager through
// set_reporting_manager(), which rejects self-reporting and cycles.
//
// The RPC does not return the employee's own auth user id, so the panel
// enriches each row from the verified-employee lookup. That extra field lets
// wouldCreateCycle() warn before the round trip; the server stays
// authoritative either way.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Network, Search, X } from "lucide-react";
import {
  formatEmployeeName,
  formatManagerName,
  sortByManager,
  wouldCreateCycle,
  type TeamRow,
} from "@/lib/teamStructure";

interface EmployeeOption {
  id: string;
  display_name: string | null;
  employee_number: string | null;
  user_id: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  Probation: "bg-amber-500/15 text-amber-700",
  "On Notice": "bg-orange-500/15 text-orange-700",
  Resigned: "bg-muted text-muted-foreground",
  Terminated: "bg-destructive/15 text-destructive",
};

export function TeamStructurePanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("hr", "employees_edit");

  const [rows, setRows] = useState<TeamRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const [teamRes, empRes] = await Promise.all([
      (supabase as any).rpc("hr_team_structure"),
      supabase
        .from("employee_profiles")
        .select("id, display_name, employee_number, user_id")
        .eq("verification_status", "verified")
        .is("date_of_exit", null)
        .order("display_name"),
    ]);

    if (teamRes.error) {
      toast({
        title: "Could not load the team structure",
        description: teamRes.error.message,
        variant: "destructive",
      });
    }

    const empRows = (empRes.data as EmployeeOption[] | null) ?? [];
    const userByProfile = new Map(empRows.map((e) => [e.id, e.user_id]));
    const teamRows = ((teamRes.data as TeamRow[]) ?? []).map((row) => ({
      ...row,
      // The employee's own login, needed by the client cycle check.
      user_id: row.user_id ?? userByProfile.get(row.employee_profile_id) ?? null,
    }));
    setRows(sortByManager(teamRows));
    setEmployees(empRows);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.employee_name, row.employee_number, row.designation, row.department, row.campus].some(
        (value) => (value ?? "").toLowerCase().includes(q),
      ),
    );
  }, [rows, query]);

  const noManagerCount = useMemo(() => rows.filter((row) => !row.manager_user_id).length, [rows]);

  const setManager = async (row: TeamRow, managerUserId: string | null) => {
    if (managerUserId && wouldCreateCycle(rows, row.employee_profile_id, managerUserId)) {
      const target = employees.find((e) => e.user_id === managerUserId);
      toast({
        title: "That reporting line would create a cycle",
        description: `${formatEmployeeName(row)} can't report to ${
          target?.display_name?.trim() || "that employee"
        } — one of them already sits above the other.`,
        variant: "destructive",
      });
      return;
    }

    setSavingId(row.employee_profile_id);
    const { error } = await (supabase as any).rpc("set_reporting_manager", {
      _employee_profile_id: row.employee_profile_id,
      _manager_user_id: managerUserId,
    });
    setSavingId(null);

    if (error) {
      toast({
        title: "Could not update the reporting manager",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: managerUserId ? "Reporting manager set" : "Reporting manager cleared" });
    await fetchAll({ silent: true });
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Network className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Reporting lines</h2>
          <Badge variant="outline" className="text-[11px]">{rows.length}</Badge>
          {noManagerCount > 0 && (
            <Badge variant="outline" className="border-amber-300 bg-amber-500/10 text-[11px] text-amber-700">
              {noManagerCount} without a manager
            </Badge>
          )}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, department or campus"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="rounded-xl bg-card card-shadow overflow-x-auto">
        <table className="w-full text-xs min-w-[860px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 font-medium">Designation</th>
              <th className="px-3 py-2 font-medium">Department</th>
              <th className="px-3 py-2 font-medium">Campus</th>
              <th className="px-3 py-2 font-medium">Reporting manager</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  {rows.length === 0 ? "No employees in the team structure yet." : "No employees match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.employee_profile_id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{formatEmployeeName(row)}</span>
                      {row.employment_status && row.employment_status !== "Working" && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px]",
                            STATUS_STYLE[row.employment_status] ?? "bg-muted text-muted-foreground",
                          )}
                        >
                          {row.employment_status}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{row.employee_number || "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.designation || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.department || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.campus || "—"}</td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <ManagerPicker
                        row={row}
                        employees={employees}
                        disabled={savingId === row.employee_profile_id}
                        onPick={(managerUserId) => setManager(row, managerUserId)}
                      />
                    ) : (
                      <span className={cn(!row.manager_user_id && "text-muted-foreground")}>
                        {formatManagerName(row)}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManagerPicker({
  row,
  employees,
  disabled,
  onPick,
}: {
  row: TeamRow;
  employees: EmployeeOption[];
  disabled: boolean;
  onPick: (managerUserId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = employees.filter((e) => e.user_id && e.id !== row.employee_profile_id);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-8 w-full max-w-[240px] justify-between gap-2 px-2.5 text-xs font-normal"
        >
          <span className={cn("truncate", !row.manager_user_id && "text-muted-foreground")}>
            {formatManagerName(row)}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search employees…" />
          <CommandList>
            <CommandEmpty>No matching employee.</CommandEmpty>
            <CommandGroup>
              {row.manager_user_id && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onPick(null);
                    setOpen(false);
                  }}
                  className="gap-2 text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" /> Clear reporting manager
                </CommandItem>
              )}
              {options.map((e) => {
                const label = e.display_name?.trim() || e.employee_number || "Unnamed employee";
                const isCurrent = !!e.user_id && row.manager_user_id === e.user_id;
                return (
                  <CommandItem
                    key={e.id}
                    value={`${label} ${e.employee_number ?? ""} ${e.id}`}
                    onSelect={() => {
                      if (!e.user_id) return;
                      onPick(e.user_id);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <span className="flex-1 truncate">{label}</span>
                    {e.employee_number && (
                      <span className="text-[10px] text-muted-foreground">{e.employee_number}</span>
                    )}
                    {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default TeamStructurePanel;
