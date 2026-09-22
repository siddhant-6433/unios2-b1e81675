// The §4.2 library capability matrix, operable by a super admin / branch manager.
// Each row is a person; each editable column is a capability flag on
// `library_staff_assignments`. Writes are handled by the parent via the
// `library_set_access` / `library_remove_access` RPCs.
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Trash2, Users } from "lucide-react";

export type AccessMatrixRow = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  app_role: string | null;
  assignment_id: string | null;
  assignment_role: "manager" | "librarian" | "assistant" | "auditor" | null;
  can_catalog: boolean;
  can_circulate: boolean;
  can_inventory: boolean;
  can_digitize: boolean;
  can_manage_settings: boolean;
  active: boolean;
  has_assignment: boolean;
};

export type AccessCapabilityKey = "can_catalog" | "can_circulate" | "can_inventory" | "can_digitize" | "can_manage_settings";

export const ACCESS_CAPABILITY_KEYS: readonly AccessCapabilityKey[] = [
  "can_catalog",
  "can_circulate",
  "can_inventory",
  "can_digitize",
  "can_manage_settings",
];

export const ACCESS_CAPABILITY_LABELS: Record<AccessCapabilityKey, string> = {
  can_catalog: "Catalog",
  can_circulate: "Circulate",
  can_inventory: "Inventory",
  can_digitize: "Digitize",
  can_manage_settings: "Settings",
};

export type AccessPatch = Partial<
  Pick<AccessMatrixRow, "assignment_role" | "can_catalog" | "can_circulate" | "can_inventory" | "can_digitize" | "can_manage_settings" | "active">
>;

type Props = {
  branchName: string | null;
  rows: AccessMatrixRow[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  saving: string | null;
  onGrant: (row: AccessMatrixRow) => void;
  onUpdate: (row: AccessMatrixRow, patch: AccessPatch) => void;
  onRemove: (row: AccessMatrixRow) => void;
};

export function LibraryAccessMatrix({
  branchName, rows, loading, search, onSearchChange, saving, onGrant, onUpdate, onRemove,
}: Props) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Library Access Matrix
            <span className="text-sm font-normal text-muted-foreground">— {branchName || "Selected Library"}</span>
          </CardTitle>
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search staff to add…"
            className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground sm:w-64"
          />
        </div>
        <p className="max-w-3xl text-xs text-muted-foreground">
          Tick a capability to grant or revoke it instantly. Anyone listed here holds an explicit assignment, which{" "}
          <span className="font-medium text-foreground">overrides the campus-wide librarian default</span> — they are
          limited to exactly the capabilities below.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="p-2 font-medium">Person</th>
                <th className="p-2 font-medium">Role</th>
                <th className="p-2 text-center font-medium">View</th>
                {ACCESS_CAPABILITY_KEYS.map((key) => (
                  <th key={key} className="p-2 text-center font-medium">{ACCESS_CAPABILITY_LABELS[key]}</th>
                ))}
                <th className="p-2 text-center font-medium">Approve</th>
                <th className="p-2 text-center font-medium">Export</th>
                <th className="p-2 text-center font-medium">Active</th>
                <th className="p-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={12} className="p-4 text-center text-sm text-muted-foreground"><ButtonOrb state="working" className="mx-auto" /> Loading access…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {search ? "No matching staff" : "No one has explicit access yet — search above to add staff."}
                </td></tr>
              ) : rows.map((row) => {
                const isManager = row.assignment_role === "manager";
                const eff = (key: AccessCapabilityKey) => row.has_assignment && (isManager || row[key]);
                const rowSaving = saving === `access-${row.user_id}`;
                return (
                  <tr key={row.user_id} className="align-middle">
                    <td className="p-2">
                      <p className="font-medium text-foreground">{row.display_name || row.email || row.user_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.email || row.phone || "no contact"}{row.app_role ? ` · ${row.app_role.replace(/_/g, " ")}` : ""}
                      </p>
                    </td>
                    <td className="p-2">
                      {row.has_assignment ? (
                        <select
                          value={row.assignment_role || "librarian"}
                          disabled={rowSaving}
                          onChange={(e) => onUpdate(row, { assignment_role: e.target.value as AccessMatrixRow["assignment_role"] })}
                          className="rounded-lg border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                        >
                          {["manager", "librarian", "assistant", "auditor"].map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">no access</span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {row.has_assignment
                        ? <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    {ACCESS_CAPABILITY_KEYS.map((key) => (
                      <td key={key} className="p-2 text-center">
                        {row.has_assignment ? (
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={eff(key)}
                            disabled={isManager || rowSaving}
                            onChange={(e) => onUpdate(row, { [key]: e.target.checked } as AccessPatch)}
                          />
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    ))}
                    <td className="p-2 text-center">
                      {eff("can_catalog")
                        ? <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-center">
                      {(eff("can_inventory") || eff("can_circulate") || eff("can_manage_settings"))
                        ? <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-center">
                      {row.has_assignment ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border"
                          checked={row.active}
                          disabled={rowSaving}
                          onChange={(e) => onUpdate(row, { active: e.target.checked })}
                        />
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-right">
                      {rowSaving ? (
                        <ButtonOrb state="working" />
                      ) : row.has_assignment ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onRemove(row)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Remove
                        </Button>
                      ) : (
                        <Button type="button" size="sm" onClick={() => onGrant(row)}>Grant access</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          View is implicit for anyone with access. Approve is derived from Catalog; Export from Inventory, Circulate or
          Settings. “manager” enables everything.
        </p>
      </CardContent>
    </Card>
  );
}
