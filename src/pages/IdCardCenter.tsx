import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useCampus } from "@/contexts/CampusContext";
import {
  CreditCard,
  Download,
  FileSpreadsheet,
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
import { avatarThumbUrl, idCardPhotoUrl } from "@/lib/storageImage";
import { whiteBgCutout } from "@/lib/whiteBgCutout";
import { QRCodeSVG } from "qrcode.react";
import { brandForStudentOwner, MIRAI_BRAND, NIMT_EDU_BRAND, type StudentBrand } from "@/lib/studentBranding";
import miraiLogoRed from "@/assets/mirai-logo-red.svg";
import { PhotoDayAssigneesPanel } from "@/components/admin/PhotoDayAssigneesPanel";

type CardMode = "students" | "employees";

type PhotoFilter = "all" | "missing" | "has" | "ai_pending";

/** Card theme = student_type (drives full-card colour). "employee" always renders NIMT Blue. */
type StudentType = "day_scholar" | "day_boarder" | "boarder" | "employee";

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
  photoOriginalUrl: string | null;
  photoProcessedUrl: string | null;
  extraLabel: string;
  extraValue: string;
  // School ID-card fields (students only; empty for employees)
  fatherName: string;
  fatherPhone: string;
  motherName: string;
  motherPhone: string;
  dob: string;
  studentType: StudentType;
  brand: StudentBrand;
}

interface CardThemeColors {
  /** 5-tint "signal wave" ramp, light → dark. Last entry is the accent/band colour. */
  ramp: [string, string, string, string, string];
  accent: string;
  category: string;
  /** Effective brand (logo + name) for this theme — Mirai swaps its logo variant to match the colour. */
  brand: StudentBrand;
}

// Round-3 "beacon colour-shade waves": five tints of the brand hue per student type
// (light → accent). Green/orange accents are the school-specified #00bf63 / #ff751f.
const RAMP_BLUE: CardThemeColors["ramp"] = ["#E3EAFF", "#B3C6FF", "#7B9BFF", "#3D6FFF", "#0041F5"];
const RAMP_GREEN: CardThemeColors["ramp"] = ["#DBF6E9", "#B2ECD0", "#73DCA9", "#38CD85", "#00BF63"];
const RAMP_ORANGE: CardThemeColors["ramp"] = ["#FFECE0", "#FFD6BC", "#FFB384", "#FF9350", "#FF751F"];
// Mirai brand tones: sage green #77966D (boarders) / brick red #AA4A44 (day schools).
const RAMP_MIRAI_GREEN: CardThemeColors["ramp"] = ["#EEF2EC", "#D3DECD", "#AEC0A5", "#93AA88", "#77966D"];
const RAMP_MIRAI_RED: CardThemeColors["ramp"] = ["#F6E9E8", "#E9C9C6", "#D59A95", "#BF6B65", "#AA4A44"];
// Staff/faculty purple — deliberately not a school colour, so employee cards read as distinct.
const RAMP_PURPLE: CardThemeColors["ramp"] = ["#F1EBFB", "#DBC9F4", "#BBA0EA", "#9366DC", "#6D28D9"];

/** Category label from student_type (shared across all schools). */
function typeCategory(t: StudentType): string {
  return t === "boarder" ? "Boarding" : t === "day_boarder" ? "Day Boarding" : t === "day_scholar" ? "Day Scholar" : "";
}

function cardTheme(person: CardPerson): CardThemeColors {
  const category = typeCategory(person.studentType);
  // Staff cards render in purple regardless of institution, to stand apart from students.
  if (person.studentType === "employee") {
    return { ramp: RAMP_PURPLE, accent: RAMP_PURPLE[4], category, brand: person.brand };
  }
  switch (person.brand.key) {
    case "mirai": {
      // Mirai: green for boarders, red for day scholars/day boarders — logo variant matches.
      const green = person.studentType === "boarder";
      const ramp = green ? RAMP_MIRAI_GREEN : RAMP_MIRAI_RED;
      return { ramp, accent: ramp[4], category, brand: { ...MIRAI_BRAND, logo: green ? MIRAI_BRAND.logo : miraiLogoRed } };
    }
    case "nimt":
      // NIMT Educational Institutions: always blue, regardless of student type.
      return { ramp: RAMP_BLUE, accent: RAMP_BLUE[4], category, brand: person.brand };
    case "beacon":
    default:
      // Beacon: blue day scholar, orange day boarder, green boarder.
      switch (person.studentType) {
        case "boarder":
          return { ramp: RAMP_GREEN, accent: RAMP_GREEN[4], category, brand: person.brand };
        case "day_boarder":
          return { ramp: RAMP_ORANGE, accent: RAMP_ORANGE[4], category, brand: person.brand };
        default:
          return { ramp: RAMP_BLUE, accent: RAMP_BLUE[4], category, brand: person.brand };
      }
  }
}

/** Academic session (Apr–Mar) label + validity, e.g. "2026 – 27" / "MAR 2027". */
function sessionInfo(): { label: string; validTill: string } {
  const d = new Date();
  const start = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return { label: `${start} – ${String(start + 1).slice(2)}`, validTill: `MAR ${start + 1}` };
}

/** Batch label ("2026-28" / "2026-2028" / "2026 – 28") → end year 2028, or null. */
export function batchEndYear(batch: string): number | null {
  const nums = batch.match(/\d{2,4}/g);
  if (!nums || nums.length < 2) return null;
  let end = nums[nums.length - 1];
  if (end.length === 2) end = nums[0].slice(0, 2) + end; // "28" → "2028" using the start century
  const year = parseInt(end, 10);
  return Number.isFinite(year) ? year : null;
}

/** dob (ISO date) → "dd MMM yyyy"; guards null / invalid → "-". */
function formatDob(dob: string): string {
  if (!dob) return "-";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const CENTER_ROLES = new Set(["super_admin", "principal", "office_admin", "office_assistant", "school_coordinator", "campus_admin"]);
const STUDENT_CARD_ROLES = new Set(["super_admin", "principal", "office_admin", "office_assistant", "school_coordinator", "campus_admin"]);

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

function photoStatus(row: CardPerson): string {
  if (!row.photoUrl) return "Missing photo";
  const aiPending =
    !!row.photoOriginalUrl && !row.photoProcessedUrl && row.photoUrl === row.photoOriginalUrl;
  return aiPending ? "AI pending" : "Has photo";
}

/** Download the given rows as a CSV (opens in Excel). Filename reflects the active photo filter. */
function exportCsv(rows: CardPerson[], mode: CardMode, filterLabel: string) {
  const headers = ["Name", mode === "students" ? "Admission No." : "Employee No.", "Group", "Detail", "Campus", "Phone", "Email", "Blood Group", "Photo Status"];
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.map(esc).join(","),
    ...rows.map((r) => [r.name, r.primaryNo, r.group, r.subtitle, r.campus, r.phone, r.email, r.bloodGroup, photoStatus(r)].map(esc).join(",")),
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `id-card-${mode}-${filterLabel}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Tiny list avatar: lazy-load a storage thumb; fall back to initials on error. */
function PersonAvatar({ name, photoUrl, className }: { name: string; photoUrl: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = avatarThumbUrl(photoUrl);
  const showImage = !!src && !failed;

  return (
    <div className={className ?? "flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-sm font-bold text-primary"}>
      {showImage ? (
        <img
          src={src}
          alt=""
          width={44}
          height={44}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </div>
  );
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
  const [photoFilter, setPhotoFilter] = useState<PhotoFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Transparent-background cutouts (Beacon front), keyed by student id. Generated on print.
  const [cutouts, setCutouts] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);

  const hasHrAccess = can("hr", "view");
  const canOpenCenter = role === "super_admin" || (role ? CENTER_ROLES.has(role) : false) || hasHrAccess;
  const canStudentCards = role === "super_admin" || (role ? STUDENT_CARD_ROLES.has(role) : false) || hasHrAccess;
  const canEmployeeCards = role === "super_admin" || (hasHrAccess && !["principal", "office_admin", "office_assistant", "school_coordinator"].includes(role || ""));

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
      if (photoFilter === "missing" && row.photoUrl) return false;
      if (photoFilter === "has" && !row.photoUrl) return false;
      if (photoFilter === "ai_pending") {
        // Original captured, processed not yet applied
        const pending =
          !!row.photoOriginalUrl &&
          !row.photoProcessedUrl &&
          row.photoUrl === row.photoOriginalUrl;
        if (!pending) return false;
      }
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.primaryNo.toLowerCase().includes(q) ||
        row.subtitle.toLowerCase().includes(q) ||
        row.group.toLowerCase().includes(q)
      );
    });
  }, [activeRows, search, groupFilter, photoFilter]);

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
      .select("id, name, admission_no, pre_admission_no, phone, father_name, father_phone, mother_name, mother_phone, dob, student_type, photo_url, photo_original_url, photo_processed_url, blood_group, joining_class, section, campus_id, courses:course_id(name), batches:batch_id(name), campuses:campus_id(name)")
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
      const campusName = relationName(student.campuses);
      // Legacy/imported rows use "hostel"; newer forms write "boarder"/"day_boarder". Normalise.
      const rawType = String(student.student_type || "").toLowerCase().trim();
      const studentType: StudentType =
        rawType === "boarder" || rawType === "hostel"
          ? "boarder"
          : rawType === "day_boarder"
            ? "day_boarder"
            : "day_scholar";
      return {
        id: student.id,
        type: "students",
        name: student.name || "Unnamed student",
        primaryNo: displayNo(student.admission_no, student.pre_admission_no),
        subtitle: `${grade}${section}`,
        group: grade,
        campus: campusName,
        phone: student.phone || student.father_phone || "-",
        email: "-",
        bloodGroup: student.blood_group || "-",
        photoUrl: student.photo_url || null,
        photoOriginalUrl: student.photo_original_url || null,
        photoProcessedUrl: student.photo_processed_url || null,
        extraLabel: "Batch",
        extraValue: batch,
        fatherName: student.father_name || "-",
        fatherPhone: student.father_phone || "-",
        motherName: student.mother_name || "-",
        motherPhone: student.mother_phone || "-",
        dob: student.dob || "",
        studentType,
        brand: brandForStudentOwner({ campusName, courseName: course !== "-" ? course : null }),
      } satisfies CardPerson;
    }));
  }

  async function fetchEmployees() {
    // Roles live in user_roles (a user may hold several), NOT on profiles. Staff = anyone with a
    // role outside the applicant/partner set. RLS lets admin roles (super_admin/campus_admin/
    // principal/admission_head) read all rows.
    const NON_EMPLOYEE_ROLES = ["student", "parent", "consultant", "academic_partner", "academic_partner_offer_letter", "publisher"];
    const rolesRes = await (supabase as any).from("user_roles").select("user_id, role");
    if (rolesRes.error) {
      console.error("[IdCardCenter] user_roles fetch failed:", rolesRes.error);
      setEmployees([]);
      return;
    }

    const staffRoleByUser = new Map<string, string>();
    for (const row of rolesRes.data || []) {
      if (!row.user_id || NON_EMPLOYEE_ROLES.includes(row.role)) continue;
      if (!staffRoleByUser.has(row.user_id)) staffRoleByUser.set(row.user_id, row.role);
    }
    const userIds = [...staffRoleByUser.keys()];
    if (!userIds.length) {
      setEmployees([]);
      return;
    }

    // employee_profiles carries the richer HR fields when present (mostly empty today); profiles
    // supplies name / contact / department / campus for everyone else.
    const [profilesRes, employeeProfilesRes] = await Promise.all([
      (supabase as any)
        .from("profiles")
        .select("user_id, display_name, phone, email, department, institution, campus, avatar_url, employee_id")
        .in("user_id", userIds)
        .is("deleted_at", null)
        .order("display_name"),
      supabase
        .from("employee_profiles")
        .select("user_id, employee_number, display_name, mobile_number, work_email, job_title, photo_url, blood_group, date_of_birth")
        .in("user_id", userIds),
    ]);

    if (profilesRes.error) {
      console.error("[IdCardCenter] profile fetch failed:", profilesRes.error);
      setEmployees([]);
      return;
    }
    if (employeeProfilesRes.error) {
      console.error("[IdCardCenter] employee profile fetch failed:", employeeProfilesRes.error);
    }

    const empByUser = new Map<string, any>();
    (employeeProfilesRes.data || []).forEach((ep: any) => empByUser.set(ep.user_id, ep));

    setEmployees((profilesRes.data || []).map((profile: any) => {
      const ep = empByUser.get(profile.user_id) || {};
      const roleLabel = String(staffRoleByUser.get(profile.user_id) || "Employee").replace(/_/g, " ");
      return {
        id: profile.user_id,
        type: "employees",
        name: ep.display_name || profile.display_name || "Unnamed employee",
        primaryNo: ep.employee_number || profile.employee_id || "-",
        subtitle: ep.job_title || roleLabel,
        group: profile.department || roleLabel,
        campus: profile.campus || profile.institution || "-",
        phone: ep.mobile_number || profile.phone || "-",
        email: ep.work_email || profile.email || "-",
        bloodGroup: ep.blood_group || "-",
        photoUrl: ep.photo_url || profile.avatar_url || null,
        photoOriginalUrl: null,
        photoProcessedUrl: null,
        extraLabel: "Department",
        extraValue: profile.department || "-",
        fatherName: "-",
        fatherPhone: "-",
        motherName: "-",
        motherPhone: "-",
        dob: ep.date_of_birth || "",
        studentType: "employee",
        brand: NIMT_EDU_BRAND,
      } satisfies CardPerson;
    }));
  }

  function switchMode(nextMode: CardMode) {
    setMode(nextMode);
    setGroupFilter("all");
    setPhotoFilter("all");
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

  async function printCards(rows: CardPerson[]) {
    if (rows.length === 0) return;
    // Student wave fronts show the pupil cut out over the signal-wave rings — build transparent
    // cutouts (from the pure-white studio bg) first. Employee photos aren't white-bg studio
    // shots, so they keep the boxed photo instead.
    const pending = rows.filter((row) => row.type === "students" && row.photoUrl && !cutouts[row.id]);
    if (pending.length) {
      setPreparing(true);
      const done = await Promise.all(
        pending.map(async (row) => {
          try {
            return [row.id, await whiteBgCutout(row.photoUrl as string)] as const;
          } catch (err) {
            console.warn("[IdCardCenter] cutout failed for", row.name, err);
            return null;
          }
        }),
      );
      setCutouts((prev) => ({ ...prev, ...Object.fromEntries(done.filter(Boolean) as [string, string][]) }));
      setPreparing(false);
      // let React paint the cutouts into the hidden print DOM before opening the dialog
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    window.setTimeout(() => window.print(), 60);
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
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Poppins:wght@400;500;600;700&display=swap');
        /* Round-3 card is authored at 400x634px; on screen shown natural, in print scaled to CR80 portrait. */
        .dc-scale { width: 400px; height: 634px; }
        .dc-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          body * { visibility: hidden !important; }
          #id-card-print, #id-card-print * { visibility: visible !important; }
          #id-card-print { position: absolute; inset: 0; padding: 8mm; background: white; }
          .id-card-sheet { display: grid !important; grid-template-columns: repeat(3, 54mm); gap: 6mm; align-items: start; }
          .id-card-pair { break-inside: avoid; page-break-inside: avoid; }
          .dc-scale { width: 54mm !important; height: 85.6mm !important; overflow: hidden; }
          .dc-scale > .dc-card { transform: scale(0.5102); transform-origin: top left; box-shadow: none !important; }
          .dc-card, .dc-card * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      <div className="print:hidden flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            ID Card Center
            {!loading && (
              <span className="ml-3 text-base font-semibold text-muted-foreground">
                {filteredRows.length} {mode === "students" ? "students" : "employees"}
                {photoFilter !== "all" && (
                  <span className="ml-1 text-primary">
                    ({photoFilter === "missing" ? "missing photo" : photoFilter === "has" ? "has photo" : "AI pending"})
                  </span>
                )}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate individual or bulk ID cards for students and eligible employees.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportCsv(filteredRows, mode, photoFilter)}
            disabled={filteredRows.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" className="gap-2" onClick={selectVisible} disabled={filteredRows.length === 0}>
            <UserCheck className="h-4 w-4" /> Select Visible
          </Button>
          <Button variant="outline" onClick={clearSelection} disabled={selectedIds.size === 0}>
            Clear
          </Button>
          <Button className="gap-2" onClick={() => printCards(selectedRows)} disabled={selectedRows.length === 0 || preparing}>
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {preparing ? "Preparing photos…" : "Print / Save PDF"}
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

      <PhotoDayAssigneesPanel />

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
        {mode === "students" && (
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { value: "all", label: "All photos" },
                { value: "missing", label: "Missing photo" },
                { value: "has", label: "Has photo" },
                { value: "ai_pending", label: "AI pending" },
              ] as const
            ).map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => setPhotoFilter(chip.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  photoFilter === chip.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
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
                  <PersonAvatar name={row.name} photoUrl={row.photoUrl} />
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
              <div className="dc-scale"><IdCardFront person={row} cutoutUrl={cutouts[row.id]} /></div>
              <div className="dc-scale"><IdCardBack person={row} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Round-3 "beacon colour-shade waves" card faces (authored at 400×634px) ──

const DC_CARD: CSSProperties = {
  width: 400,
  height: 634,
  background: "#fff",
  borderRadius: 22,
  overflow: "hidden",
  position: "relative",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 18px 44px rgba(0,65,245,.16)",
  fontFamily: "'Poppins','Archivo',Helvetica,Arial,sans-serif",
};

/**
 * Branded QR encoding the admission/employee number — the same key the app already uses
 * for student lookup (library issue, etc.). Standard QR so any scanner reads it; the brand
 * colour + centre logo make it distinctive. Level H tolerates the logo occlusion.
 */
/** QR-centre logo dimensions that preserve the brand logo's aspect ratio within a `s`×`s` budget. */
function qrLogoSize(brand: StudentBrand, s: number): { width: number; height: number } {
  const aspect = brand.logoAspect ?? 1;
  return aspect >= 1
    ? { width: s, height: Math.round(s / aspect) }
    : { width: Math.round(s * aspect), height: s };
}

/** QR payload: the admission/employee number, or the user id when no number exists (e.g. staff). */
function qrValueFor(person: CardPerson): string {
  return person.primaryNo && person.primaryNo !== "-" ? person.primaryNo : person.id;
}

function StudentQr({ value, display, color, brand }: { value: string; display?: string; color: string; brand: StudentBrand }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ background: "#fff", padding: 6, borderRadius: 10, border: "1px solid #EEF2F8", lineHeight: 0 }}>
        <QRCodeSVG
          value={value}
          size={110}
          level="H"
          // Near-black modules: a coloured QR + centre logo drops below the scan margin (verified).
          fgColor="#111111"
          bgColor="#FFFFFF"
          imageSettings={{ src: brand.logo, ...qrLogoSize(brand, 26), excavate: true }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 10.5, letterSpacing: ".14em", color, fontWeight: 700 }}>SCAN TO IDENTIFY</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#1A1A1A", letterSpacing: ".06em" }}>{display ?? value}</span>
        <span style={{ fontSize: 10, color: "#98A2B3", lineHeight: 1.4 }}>Library · Attendance · Transport · Access</span>
      </div>
    </div>
  );
}

function IdCardFront({ person, cutoutUrl }: { person: CardPerson; cutoutUrl?: string }) {
  const { ramp, accent, category, brand } = cardTheme(person);
  const { validTill } = sessionInfo();
  const subline =
    person.type === "students"
      ? `${person.group} · ADM. NO. ${person.primaryNo}`.toUpperCase()
      : `${person.subtitle} · EMP. NO. ${person.primaryNo}`.toUpperCase();
  // NIMT Educational Institutions students show the course batch (e.g. "BATCH 2026-28") in place
  // of the day-scholar/boarding category, and validity runs to June of the batch's end year.
  // (Employees carry a department in extraValue, so the batch treatment is student-only.)
  const nimtBatch = person.type === "students" && person.brand.key === "nimt" && person.extraValue !== "-"
    ? person.extraValue
    : "";
  const badge = (
    nimtBatch
      ? `Batch ${nimtBatch}`
      : category || (person.type === "students" ? "Student" : "Staff")
  ).toUpperCase();
  const endYear = nimtBatch ? batchEndYear(nimtBatch) : null;
  const validLabel = endYear ? `JUNE ${endYear}` : validTill;
  // Concentric "signal wave" rings behind the photo (light → dark, innermost is accent).
  const rings: { d: number; b: number; w: number; c: string }[] = [
    { d: 392, b: -186, w: 20, c: ramp[0] },
    { d: 320, b: -150, w: 18, c: ramp[1] },
    { d: 252, b: -116, w: 16, c: ramp[2] },
    { d: 190, b: -84, w: 14, c: ramp[3] },
    { d: 136, b: -56, w: 12, c: ramp[4] },
  ];
  return (
    <div className="dc-card" style={DC_CARD}>
      {/* lanyard slot */}
      <div style={{ height: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div style={{ width: 62, height: 9, borderRadius: 5, background: "#E3E7F0" }} />
      </div>
      {/* wordmark logo */}
      <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 0" }}>
        <img src={brand.logo} alt={brand.logoAlt} decoding="async" style={{ width: 234, height: 138, objectFit: "contain", display: "block" }} />
      </div>
      {/* photo + radiating rings */}
      <div style={{ position: "relative", height: 296, display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden" }}>
        {rings.map((r, i) => (
          <div key={i} style={{ position: "absolute", bottom: r.b, width: r.d, height: r.d, borderRadius: "50%", border: `${r.w}px solid ${r.c}` }} />
        ))}
        {cutoutUrl ? (
          // Transparent cutout: student stands in front of the waves, no box.
          <img src={cutoutUrl} alt="" decoding="async" style={{ position: "relative", zIndex: 1, width: 252, height: 288, objectFit: "contain", objectPosition: "center bottom" }} />
        ) : person.photoUrl ? (
          <div style={{ position: "relative", width: 214, height: 248, zIndex: 1, background: "#fff", borderRadius: 20, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={idCardPhotoUrl(person.photoUrl) || person.photoUrl} alt="" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        ) : (
          <div style={{ position: "relative", width: 214, height: 248, zIndex: 1, background: "#fff", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", color: accent, fontSize: 56, fontWeight: 700 }}>
            {initials(person.name)}
          </div>
        )}
      </div>
      {/* name band — name/subline on the left, scannable QR on the right */}
      <div style={{ position: "relative", zIndex: 1, background: "#fff", padding: "14px 26px 10px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ color: "#1A1A1A", fontSize: 26, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-.01em" }}>{person.name}</div>
          <div style={{ color: accent, fontSize: 11.5, fontWeight: 600, letterSpacing: ".12em", fontFamily: "'Archivo',sans-serif" }}>{subline}</div>
        </div>
        {qrValueFor(person) && (
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ lineHeight: 0 }}>
              <QRCodeSVG
                value={qrValueFor(person)}
                size={80}
                level="H"
                fgColor="#111111"
                bgColor="#FFFFFF"
                imageSettings={{ src: brand.logo, ...qrLogoSize(brand, 18), excavate: true }}
              />
            </div>
            <span style={{ fontSize: 7, letterSpacing: ".18em", color: "#98A2B3", fontWeight: 700, fontFamily: "'Archivo',sans-serif" }}>SCAN</span>
          </div>
        )}
      </div>
      {/* 5-tint gradient bar */}
      <div style={{ marginTop: "auto", display: "flex", height: 12 }}>
        {ramp.map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
      </div>
      {/* footer band */}
      <div style={{ background: accent, padding: "15px 30px", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "'Archivo',sans-serif" }}>
        <span style={{ color: "#fff", fontSize: 12.5, fontWeight: 800, letterSpacing: ".14em" }}>{badge}</span>
        <span style={{ color: "rgba(255,255,255,.85)", fontSize: 12.5, fontWeight: 600, letterSpacing: ".08em" }}>VALID TILL {validLabel}</span>
      </div>
    </div>
  );
}

function IdCardBack({ person }: { person: CardPerson }) {
  const { ramp, accent, brand } = cardTheme(person);
  const { label: session } = sessionInfo();
  // NIMT student cards carry the course batch instead of the academic session.
  const sessionLabel =
    person.type === "students" && person.brand.key === "nimt" && person.extraValue !== "-"
      ? `Batch ${person.extraValue}`
      : `Session ${session}`;
  const cells: { label: string; value: string; wide?: boolean }[] =
    person.type === "students"
      ? [
          { label: "Date of Birth", value: formatDob(person.dob) },
          { label: "Blood Group", value: person.bloodGroup },
          { label: "Father's Name", value: person.fatherName },
          { label: "Mobile", value: person.fatherPhone },
          { label: "Mother's Name", value: person.motherName },
          { label: "Mobile", value: person.motherPhone },
          { label: "Campus", value: person.campus, wide: true },
        ]
      : [
          { label: "Date of Birth", value: formatDob(person.dob) },
          { label: "Blood Group", value: person.bloodGroup },
          { label: "Department", value: person.extraValue },
          { label: "Mobile", value: person.phone },
        ];
  return (
    <div className="dc-card" style={{ ...DC_CARD, fontFamily: "'Archivo',Helvetica,Arial,sans-serif" }}>
      {/* header band with concentric ring flourish + reverse (white knockout) logo */}
      <div style={{ position: "relative", background: accent, padding: "26px 30px 22px", display: "flex", flexDirection: "column", gap: 3, overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -70, top: -70, width: 190, height: 190, borderRadius: "50%", border: "16px solid rgba(255,255,255,.16)" }} />
        <div style={{ position: "absolute", right: -46, top: -46, width: 126, height: 126, borderRadius: "50%", border: "14px solid rgba(255,255,255,.26)" }} />
        <img
          src={brand.logo}
          alt={brand.logoAlt}
          decoding="async"
          // reverse logo: knock the wordmark out to solid white so it reads on any band colour
          style={{ position: "absolute", right: 18, top: 14, width: 62, height: 62, objectFit: "contain", filter: "brightness(0) invert(1)" }}
        />
        <div style={{ position: "relative", color: "#fff", fontSize: 12, fontWeight: 800, letterSpacing: ".2em" }}>
          {person.type === "students" ? "STUDENT IDENTITY CARD" : "EMPLOYEE IDENTITY CARD"}
        </div>
        <div style={{ position: "relative", color: "rgba(255,255,255,.7)", fontSize: 12, fontWeight: 600 }}>{sessionLabel}</div>
      </div>
      {/* gradient bar (dark → light) */}
      <div style={{ display: "flex", height: 8 }}>
        {[...ramp].reverse().map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
      </div>
      {/* info grid */}
      <div style={{ flex: 1, alignContent: "space-evenly", padding: "20px 30px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {cells.map((cell, i) => (
          <div key={i} style={{ gridColumn: cell.wide ? "1 / -1" : undefined, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10.5, letterSpacing: ".14em", color: "#98A2B3", fontWeight: 700 }}>{cell.label.toUpperCase()}</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#1A1A1A", lineHeight: 1.35 }}>{cell.value || "—"}</span>
          </div>
        ))}
      </div>
      {/* QR (also on the front name band) + return notice */}
      <div style={{ padding: "0 30px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
        <StudentQr
          value={qrValueFor(person)}
          display={person.primaryNo && person.primaryNo !== "-" ? person.primaryNo : person.name}
          color={accent}
          brand={brand}
        />
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#667085" }}>
          If found, please return this card to {brand.name}. This card remains the property of the institution.
        </div>
      </div>
    </div>
  );
}

export default IdCardCenter;
