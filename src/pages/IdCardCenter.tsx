import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useCampus } from "@/contexts/CampusContext";
import {
  CreditCard,
  Download,
  Loader2,
  Printer,
  Search,
  ShieldAlert,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/state-fields";

type CardMode = "students" | "employees";

interface CardPerson {
  id: string;
  type: CardMode;
  name: string;
  primaryNo: string;
  subtitle: string;
  group: string;
  campus: string;
  phone: string;
  email: string;
  bloodGroup: string;
  photoUrl: string | null;
  extraLabel: string;
  extraValue: string;
}

const CENTER_ROLES = new Set(["super_admin", "principal", "office_admin", "office_assistant", "campus_admin"]);
const STUDENT_CARD_ROLES = new Set(["super_admin", "principal", "office_admin", "office_assistant", "campus_admin"]);

function relationName(value: any): string {
  if (Array.isArray(value)) return value[0]?.name || "-";
  return value?.name || "-";
}

function initials(name: string): string {
  return (name || "U").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function displayNo(admissionNo: string | null, preAdmissionNo: string | null): string {
  return admissionNo || preAdmissionNo || "-";
}

const IdCardCenter = () => {
  const { role } = useAuth();
  const { can } = usePermissions();
  const { selectedCampusId } = useCampus();
  const [mode, setMode] = useState<CardMode>("students");
  const [students, setStudents] = useState<CardPerson[]>([]);
  const [employees, setEmployees] = useState<CardPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const hasHrAccess = can("hr", "view");
  const canOpenCenter = role === "super_admin" || (role ? CENTER_ROLES.has(role) : false) || hasHrAccess;
  const canStudentCards = role === "super_admin" || (role ? STUDENT_CARD_ROLES.has(role) : false) || hasHrAccess;
  const canEmployeeCards = role === "super_admin" || (hasHrAccess && !["principal", "office_admin", "office_assistant"].includes(role || ""));

  useEffect(() => {
    if (mode === "employees" && !canEmployeeCards) {
      setMode("students");
      setSelectedIds(new Set());
    }
  }, [mode, canEmployeeCards]);

  useEffect(() => {
    fetchData();
  }, [selectedCampusId, canOpenCenter, canStudentCards, canEmployeeCards]);

  const activeRows = mode === "students" ? students : employees;
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeRows.filter((row) => {
      if (groupFilter !== "all" && row.group !== groupFilter) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.primaryNo.toLowerCase().includes(q) ||
        row.subtitle.toLowerCase().includes(q) ||
        row.group.toLowerCase().includes(q)
      );
    });
  }, [activeRows, search, groupFilter]);

  const groups = useMemo(() => {
    return Array.from(new Set(activeRows.map((row) => row.group || "Unassigned")))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [activeRows]);

  const selectedRows = useMemo(() => {
    return activeRows.filter((row) => selectedIds.has(row.id));
  }, [activeRows, selectedIds]);

  async function fetchData() {
    if (!canOpenCenter) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const tasks: Promise<void>[] = [];
    if (canStudentCards) tasks.push(fetchStudents());
    if (canEmployeeCards) tasks.push(fetchEmployees());
    await Promise.all(tasks);
    setLoading(false);
  }

  async function fetchStudents() {
    let query = supabase
      .from("students")
      .select("id, name, admission_no, pre_admission_no, phone, father_phone, photo_url, blood_group, joining_class, section, campus_id, courses:course_id(name), batches:batch_id(name), campuses:campus_id(name)")
      .in("status", ["active", "pre_admitted"])
      .order("name", { ascending: true })
      .limit(1000);

    if (selectedCampusId !== "all") query = query.eq("campus_id", selectedCampusId);

    const { data, error } = await query;
    if (error) {
      console.error("[IdCardCenter] student fetch failed:", error);
      setStudents([]);
      return;
    }

    setStudents((data || []).map((student: any) => {
      const course = relationName(student.courses);
      const batch = relationName(student.batches);
      const grade = course !== "-" ? course : student.joining_class || "Student";
      const section = student.section && student.section !== grade ? ` / ${student.section}` : "";
      return {
        id: student.id,
        type: "students",
        name: student.name || "Unnamed student",
        primaryNo: displayNo(student.admission_no, student.pre_admission_no),
        subtitle: `${grade}${section}`,
        group: grade,
        campus: relationName(student.campuses),
        phone: student.phone || student.father_phone || "-",
        email: "-",
        bloodGroup: student.blood_group || "-",
        photoUrl: student.photo_url || null,
        extraLabel: "Batch",
        extraValue: batch,
      };
    }));
  }

  async function fetchEmployees() {
    const profilesRes = await (supabase as any)
      .from("profiles")
      .select("user_id, display_name, phone, email, role, department, institution, campus, avatar_url")
      .not("role", "in", "(student,parent,consultant,academic_partner,publisher)")
      .order("display_name");

    if (profilesRes.error) {
      console.error("[IdCardCenter] profile fetch failed:", profilesRes.error);
      setEmployees([]);
      return;
    }

    const profiles = profilesRes.data || [];
    const userIds = profiles.map((profile: any) => profile.user_id).filter(Boolean);
    const employeeProfilesRes = userIds.length
      ? await supabase
          .from("employee_profiles")
          .select("user_id, employee_number, display_name, mobile_number, work_email, job_title, photo_url, blood_group, date_of_birth, date_of_joining")
          .in("user_id", userIds)
      : { data: [], error: null };

    if (employeeProfilesRes.error) {
      console.error("[IdCardCenter] employee profile fetch failed:", employeeProfilesRes.error);
    }

    const profileByUser = new Map<string, any>();
    (employeeProfilesRes.data || []).forEach((employeeProfile: any) => {
      profileByUser.set(employeeProfile.user_id, employeeProfile);
    });

    setEmployees(profiles.map((profile: any) => {
      const employeeProfile = profileByUser.get(profile.user_id) || {};
      const roleLabel = String(profile.role || "Employee").replace(/_/g, " ");
      return {
        id: profile.user_id,
        type: "employees",
        name: employeeProfile.display_name || profile.display_name || "Unnamed employee",
        primaryNo: employeeProfile.employee_number || "-",
        subtitle: employeeProfile.job_title || roleLabel,
        group: profile.department || roleLabel,
        campus: profile.campus || profile.institution || "-",
        phone: employeeProfile.mobile_number || profile.phone || "-",
        email: employeeProfile.work_email || profile.email || "-",
        bloodGroup: employeeProfile.blood_group || "-",
        photoUrl: employeeProfile.photo_url || profile.avatar_url || null,
        extraLabel: "Department",
        extraValue: profile.department || "-",
      } satisfies CardPerson;
    }));
  }

  function switchMode(nextMode: CardMode) {
    setMode(nextMode);
    setGroupFilter("all");
    setSearch("");
    setSelectedIds(new Set());
  }

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisible() {
    setSelectedIds(new Set(filteredRows.map((row) => row.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function printCards(rows: CardPerson[]) {
    if (rows.length === 0) return;
    window.setTimeout(() => window.print(), 50);
  }

  if (!canOpenCenter) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold text-foreground">ID Card Center unavailable</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This module is available to Principal, Office Assistant, HR, and Super Admin logins.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #id-card-print, #id-card-print * { visibility: visible !important; }
          #id-card-print { position: absolute; inset: 0; padding: 12mm; background: white; }
          .id-card-sheet { display: grid !important; grid-template-columns: repeat(2, 86mm); gap: 8mm; align-items: start; }
          .id-card-pair { break-inside: avoid; page-break-inside: avoid; }
          .print-card { width: 86mm !important; height: 54mm !important; box-shadow: none !important; border: 1px solid #d1d5db !important; }
        }
      `}</style>

      <div className="print:hidden flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">ID Card Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate individual or bulk ID cards for students and eligible employees.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={selectVisible} disabled={filteredRows.length === 0}>
            <UserCheck className="h-4 w-4" /> Select Visible
          </Button>
          <Button variant="outline" onClick={clearSelection} disabled={selectedIds.size === 0}>
            Clear
          </Button>
          <Button className="gap-2" onClick={() => printCards(selectedRows)} disabled={selectedRows.length === 0}>
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        </div>
      </div>

      <div className="print:hidden rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {canStudentCards && (
            <button
              type="button"
              onClick={() => switchMode("students")}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                mode === "students" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="h-4 w-4" /> Student ID Cards
            </button>
          )}
          {canEmployeeCards && (
            <button
              type="button"
              onClick={() => switchMode("employees")}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                mode === "employees" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <CreditCard className="h-4 w-4" /> Employee ID Cards
            </button>
          )}
          {!canEmployeeCards && (
            <Badge variant="outline" className="ml-auto">
              Employee cards are HR / Super Admin only
            </Badge>
          )}
        </div>
      </div>

      <div className="print:hidden flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${mode === "students" ? "students" : "employees"}...`}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <SelectField
          value={groupFilter}
          onValueChange={setGroupFilter}
          options={[
            { value: "all", label: mode === "students" ? "All grades / programmes" : "All departments" },
            ...groups.map((group) => ({ value: group, label: group })),
          ]}
          allowEmpty={false}
          triggerClassName="rounded-xl border border-input bg-card px-3 py-2.5 text-sm focus:ring-2 focus:ring-ring/20"
          ariaLabel={mode === "students" ? "Filter by grade or programme" : "Filter by department"}
        />
        <span className="text-sm text-muted-foreground">
          {selectedRows.length} selected from {filteredRows.length} visible
        </span>
      </div>

      {loading ? (
        <div className="print:hidden flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="print:hidden rounded-xl bg-card card-shadow overflow-hidden">
          {filteredRows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">No records found</div>
          ) : (
            <div className="divide-y divide-border">
              {filteredRows.map((row) => (
                <div key={row.id} className="flex items-center gap-4 p-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-sm font-bold text-primary">
                    {row.photoUrl ? <img src={row.photoUrl} alt="" className="h-full w-full object-cover" /> : initials(row.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.primaryNo} - {row.subtitle} - {row.group}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => {
                    setSelectedIds(new Set([row.id]));
                    printCards([row]);
                  }}>
                    <Download className="h-3.5 w-3.5" /> Generate
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div id="id-card-print" className="hidden print:block">
        <div className="id-card-sheet">
          {selectedRows.map((row) => (
            <div key={row.id} className="id-card-pair space-y-3">
              <IdCardFront person={row} />
              <IdCardBack person={row} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function IdCardFront({ person }: { person: CardPerson }) {
  return (
    <div className="print-card overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <div className="h-[42%] bg-primary px-4 py-3 text-white">
        <div className="text-[11px] font-semibold uppercase tracking-wide opacity-90">NIMT Educational Institutions</div>
        <div className="mt-1 text-[9px] opacity-80">{person.type === "students" ? "Student Identity Card" : "Employee Identity Card"}</div>
      </div>
      <div className="-mt-9 flex flex-col items-center px-4 pb-3 text-center">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-muted text-lg font-bold text-primary shadow-sm">
          {person.photoUrl ? <img src={person.photoUrl} alt="" className="h-full w-full object-cover" /> : initials(person.name)}
        </div>
        <div className="mt-2 text-[15px] font-bold leading-tight text-foreground">{person.name}</div>
        <div className="text-[11px] font-medium text-muted-foreground">{person.subtitle}</div>
        <div className="mt-2 grid w-full grid-cols-2 gap-x-3 gap-y-1 text-left text-[9px]">
          <Info label={person.type === "students" ? "Admission No." : "Employee No."} value={person.primaryNo} />
          <Info label={person.extraLabel} value={person.extraValue} />
          <Info label="Phone" value={person.phone} />
          <Info label="Blood Group" value={person.bloodGroup} />
        </div>
      </div>
    </div>
  );
}

function IdCardBack({ person }: { person: CardPerson }) {
  return (
    <div className="print-card rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="text-[12px] font-bold text-primary">UniOS ID Verification</div>
      <div className="mt-3 space-y-2 text-[10px]">
        <Info label="Name" value={person.name} />
        <Info label="Campus" value={person.campus} />
        <Info label="Email" value={person.email} />
        <Info label={person.type === "students" ? "Guardian / Emergency" : "Contact"} value={person.phone} />
      </div>
      <div className="mt-4 rounded-lg bg-muted p-3 text-center text-[9px] leading-relaxed text-muted-foreground">
        If found, please return this card to NIMT Educational Institutions.
        This card remains property of the institution.
      </div>
      <div className="mt-4 h-8 rounded bg-foreground" />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-[10px] font-semibold text-foreground">{value || "-"}</div>
    </div>
  );
}

export default IdCardCenter;
