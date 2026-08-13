// HR employee directory — the entry point for viewing and editing employees.
//
// Two sources, merged: `employee_profiles` (the HR master, including people
// imported in bulk who have no login at all) and `profiles` (every staff auth
// account). Neither alone is complete — most existing staff have a login but no
// employee_profiles row yet, and imported staff are the reverse — so a row keyed
// only on one of them would hide half the organisation.

import { PageLoader } from "@/components/ui/page-loader";
import { useCallback, useState, useEffect, useMemo, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SelectField } from "@/components/ui/state-fields";
import { usePermissions } from "@/contexts/PermissionContext";
import { useOrgUnits } from "@/hooks/useOrgUnits";
import { Search, Phone, Building2, Upload, ClipboardCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const EmployeeProfileDialog = lazy(() => import("@/components/admin/EmployeeProfileDialog"));
const BulkEmployeeImportDialog = lazy(() =>
  import("@/components/hr/BulkEmployeeImportDialog").then((m) => ({ default: m.BulkEmployeeImportDialog })));
const EmployeeVerificationTable = lazy(() =>
  import("@/components/hr/EmployeeVerificationTable").then((m) => ({ default: m.EmployeeVerificationTable })));

interface Employee {
  /** employee_profiles.id when one exists. */
  employeeProfileId?: string;
  userId?: string;
  name: string;
  phone: string | null;
  role: string | null;
  jobTitle: string | null;
  department: string | null;
  campusId: string | null;
  photoUrl: string | null;
}

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", counsellor: "Counsellor",
  accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_admin: "Office Admin",
  office_assistant: "Office Assistant", school_coordinator: "School Coordinator", hostel_warden: "Hostel Warden",
  ib_coordinator: "IB Coordinator", librarian: "Librarian",
};

// PostgREST caps every response at 1000 rows; raising the client limit does
// nothing. Page through instead of silently losing staff past the first 1000.
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await build(from, from + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const HrEmployeeDirectory = () => {
  const { can } = usePermissions();
  const org = useOrgUnits();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [campusFilter, setCampusFilter] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const canEdit = can("hr", "employees_edit");

  const departmentName = useCallback(
    (id: string | null) => (id ? org.departments.find((d) => d.id === id)?.name ?? null : null),
    [org.departments],
  );

  const fetchEmployees = useCallback(async () => {
    setLoading(true);

    const [staff, emps, pending] = await Promise.all([
      fetchAll<{ user_id: string; display_name: string; phone: string; role: string; department: string | null; avatar_url: string | null }>(
        (from, to) => supabase
          .from("profiles")
          .select("user_id, display_name, phone, role, department, avatar_url")
          .not("role", "in", "(student,parent)")
          .order("display_name")
          .range(from, to),
      ),
      fetchAll<{ id: string; user_id: string | null; display_name: string | null; mobile_number: string | null; job_title: string | null; department_id: string | null; campus_id: string | null; photo_url: string | null }>(
        (from, to) => supabase
          .from("employee_profiles")
          .select("id, user_id, display_name, mobile_number, job_title, department_id, campus_id, photo_url")
          .eq("verification_status", "verified")
          .order("display_name")
          .range(from, to),
      ),
      supabase
        .from("employee_profiles")
        .select("id", { count: "exact", head: true })
        .eq("verification_status", "pending"),
    ]);

    // employee_profiles wins where both exist — it's the record HR maintains.
    const byUser = new Map(emps.filter((e) => e.user_id).map((e) => [e.user_id!, e]));
    const merged: Employee[] = emps.map((e) => ({
      employeeProfileId: e.id,
      userId: e.user_id ?? undefined,
      name: e.display_name || (e.user_id ? staff.find((s) => s.user_id === e.user_id)?.display_name : "") || "Unnamed",
      phone: e.mobile_number || (e.user_id ? staff.find((s) => s.user_id === e.user_id)?.phone ?? null : null),
      role: e.user_id ? staff.find((s) => s.user_id === e.user_id)?.role ?? null : null,
      jobTitle: e.job_title,
      department: departmentName(e.department_id),
      campusId: e.campus_id,
      photoUrl: e.photo_url,
    }));

    for (const s of staff) {
      if (byUser.has(s.user_id)) continue;
      merged.push({
        userId: s.user_id,
        name: s.display_name || "Unnamed",
        phone: s.phone,
        role: s.role,
        jobTitle: null,
        department: s.department,
        campusId: null,
        photoUrl: s.avatar_url,
      });
    }

    merged.sort((a, b) => a.name.localeCompare(b.name));
    setEmployees(merged);
    setPendingCount(pending.count ?? 0);
    setLoading(false);
  }, [departmentName]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const filtered = useMemo(() => {
    let result = employees;
    if (roleFilter !== "all") result = result.filter((e) => e.role === roleFilter);
    if (campusFilter !== "all") result = result.filter((e) => e.campusId === campusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        e.phone?.includes(q) ||
        e.jobTitle?.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q));
    }
    return result;
  }, [employees, search, roleFilter, campusFilter]);

  const roles = [...new Set(employees.map((e) => e.role).filter(Boolean))].sort() as string[];
  const deptGroups = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of employees) {
      const dept = e.department || "Unassigned";
      map[dept] = (map[dept] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [employees]);

  const getInitials = (name: string) =>
    (name || "U").split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const avatarColors = ["bg-primary/15 text-primary", "bg-chart-2/15 text-chart-2", "bg-chart-3/15 text-chart-3", "bg-destructive/15 text-destructive", "bg-chart-5/15 text-chart-5"];
  const getAvatarColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return avatarColors[Math.abs(hash) % avatarColors.length];
  };

  const directory = (
    <>
      {/* Department summary */}
      <div className="flex flex-wrap gap-2">
        {deptGroups.slice(0, 8).map(([dept, count]) => (
          <Badge key={dept} variant="outline" className="text-xs gap-1 cursor-default">
            <Building2 className="h-3 w-3" />
            {dept} ({count})
          </Badge>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search by name, phone, designation, or department..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <SelectField
          value={roleFilter}
          onValueChange={setRoleFilter}
          options={[{ value: "all", label: "All Roles" }, ...roles.map((r) => ({ value: r, label: roleLabels[r] || r }))]}
          hideLabel
          placeholder="All Roles"
        />
        <SelectField
          value={campusFilter}
          onValueChange={setCampusFilter}
          options={[{ value: "all", label: "All Campuses" }, ...org.campuses.map((c) => ({ value: c.id, label: c.name }))]}
          hideLabel
          placeholder="All Campuses"
        />
      </div>

      {loading ? (
        <PageLoader />
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.length === 0 ? (
              <div className="px-4 py-12 text-center text-muted-foreground text-sm">No employees found</div>
            ) : filtered.map((emp) => (
              <div
                key={emp.employeeProfileId || emp.userId}
                role="button"
                tabIndex={0}
                onClick={() => setEditing(emp)}
                onKeyDown={(e) => { if (e.key === "Enter") setEditing(emp); }}
                className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors cursor-pointer text-left w-full"
              >
                {emp.photoUrl ? (
                  <img src={emp.photoUrl} alt={emp.name} className="h-10 w-10 rounded-xl object-cover border border-border" />
                ) : (
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold ${getAvatarColor(emp.name)}`}>
                    {getInitials(emp.name)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{emp.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground capitalize">
                      {emp.jobTitle || (emp.role || "").replace(/_/g, " ") || "—"}
                    </span>
                    {emp.department && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">{emp.department}</span>
                      </>
                    )}
                  </div>
                </div>
                {emp.phone && (
                  <a
                    href={`tel:${emp.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground hover:text-primary p-1"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employee Directory</h1>
          <p className="text-sm text-muted-foreground mt-1">{employees.length} employees</p>
        </div>
        {canEdit && (
          <Button onClick={() => setImportOpen(true)} variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-1.5" /> Import employees
          </Button>
        )}
      </div>

      {canEdit ? (
        <Tabs defaultValue="directory" className="space-y-6">
          <TabsList className="bg-muted/50 border border-border rounded-xl p-1 h-auto">
            <TabsTrigger value="directory" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Users className="h-3.5 w-3.5 mr-1" /> Directory
            </TabsTrigger>
            <TabsTrigger value="verify" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Needs verification
              {pendingCount > 0 && <span className="ml-1.5 rounded-full bg-destructive/15 text-destructive px-1.5">{pendingCount}</span>}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="directory" className="space-y-6">{directory}</TabsContent>
          <TabsContent value="verify">
            <Suspense fallback={<PageLoader />}>
              <EmployeeVerificationTable onChange={fetchEmployees} />
            </Suspense>
          </TabsContent>
        </Tabs>
      ) : (
        <div className="space-y-6">{directory}</div>
      )}

      {editing && (
        <Suspense fallback={null}>
          <EmployeeProfileDialog
            open
            onClose={() => setEditing(null)}
            onSuccess={fetchEmployees}
            userId={editing.userId}
            employeeProfileId={editing.employeeProfileId}
            userName={editing.name}
            readOnly={!canEdit}
          />
        </Suspense>
      )}

      {importOpen && (
        <Suspense fallback={null}>
          <BulkEmployeeImportDialog open={importOpen} onOpenChange={setImportOpen} onSuccess={fetchEmployees} />
        </Suspense>
      )}
    </div>
  );
};

export default HrEmployeeDirectory;
