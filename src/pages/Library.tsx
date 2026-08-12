import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Barcode, BookOpen, Building2, CheckCircle2, Clock, Download, FileSpreadsheet, FileSearch, Library as LibraryIcon, Plus, Printer, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { format, isBefore, startOfToday } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useCampus } from "@/contexts/CampusContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { normalizeIsbn, findDuplicateReason as findDuplicateReasonPure, rememberSeen, emptySeen } from "@/lib/libraryDuplicate";
import { detectHeaderRow, forwardFill, resolveColumns, parseAmount, parseIntLoose, splitPlacePublisher, cleanAuthorName, normalizePublisher } from "@/lib/libraryImport";
import { CatalogEntityManager } from "@/components/library/CatalogEntityManager";

type LibraryBook = {
  id: string;
  title: string;
  authors: string[] | null;
  isbn_10: string | null;
  isbn_13: string | null;
  publisher: string | null;
  category: string | null;
  subject: string | null;
  cover_url: string | null;
  created_at: string;
};

type Institution = {
  id: string;
  name: string;
  code: string | null;
  campus_id: string;
  type: string | null;
};

type Course = {
  id: string;
  name: string;
  code: string;
  department_id: string;
  departments?: { institution_id: string } | null;
};

type LibraryBranch = {
  id: string;
  campus_id: string;
  institution_id: string;
  name: string;
  code: string | null;
  active: boolean;
};

type StaffProfile = {
  id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

type LibraryStaffAssignment = {
  id: string;
  branch_id: string;
  user_id: string;
  profile_id: string | null;
  assignment_role: "manager" | "librarian" | "assistant" | "auditor";
  can_catalog: boolean;
  can_circulate: boolean;
  can_inventory: boolean;
  can_digitize: boolean;
  can_manage_settings: boolean;
  active: boolean;
  profiles?: Pick<StaffProfile, "display_name" | "email" | "phone"> | null;
};

type LibraryBranchCourse = {
  id: string;
  branch_id: string;
  course_id: string;
  active: boolean;
};

type LibrarySetting = {
  id: string;
  branch_id: string;
  borrowing_days: number;
  borrowing_limit: number;
  fine_per_day: number;
  renewals_allowed: number;
  reference_books_circulate: boolean;
};

type LibraryItem = {
  id: string;
  book_id: string;
  accession_no: string;
  barcode: string | null;
  status: string;
  shelf_location: string | null;
  rack: string | null;
  condition: string | null;
  campus_id: string;
  institution_id: string;
  branch_id: string;
  library_books?: Pick<LibraryBook, "title" | "authors" | "isbn_13" | "cover_url"> | null;
  library_branches?: Pick<LibraryBranch, "name" | "code"> | null;
};

type LibraryLoan = {
  id: string;
  item_id: string;
  member_id: string;
  due_on: string;
  issued_at: string;
  returned_at: string | null;
  status: string;
  library_items?: (Pick<LibraryItem, "accession_no" | "barcode" | "campus_id" | "institution_id" | "branch_id"> & {
    library_books?: Pick<LibraryBook, "title" | "authors"> | null;
  }) | null;
  library_members?: { display_name: string; member_type: string; admission_no: string | null; phone: string | null; email: string | null } | null;
};

type LibraryMember = {
  id: string;
  display_name: string;
  member_type: string;
  admission_no: string | null;
  institution_id: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  borrowing_limit: number;
};

type DigitizationRecord = {
  id: string;
  branch_id: string | null;
  source: string;
  scanned_barcode: string | null;
  isbn: string | null;
  accession_no: string | null;
  title: string | null;
  authors_text: string | null;
  cover_image_url: string | null;
  publisher: string | null;
  place: string | null;
  edition: string | null;
  pages: number | null;
  volume: string | null;
  published_year: number | null;
  category: string | null;
  subject: string | null;
  language: string | null;
  shelf_location: string | null;
  rack: string | null;
  condition: string | null;
  purchase_price: number | null;
  import_row: Record<string, unknown> | null;
  approved_item_id: string | null;
  enrichment_status: string | null;
  status: string;
  confidence: number | null;
  suggested_metadata: any;
  created_at: string;
};

type DigitizationReviewEdit = {
  accession_no: string;
  title: string;
  authors_text: string;
  isbn: string;
  publisher: string;
  place: string;
  edition: string;
  pages: string;
  volume: string;
  published_year: string;
  category: string;
  subject: string;
  language: string;
  shelf_location: string;
  rack: string;
  condition: string;
  purchase_price: string;
};

const tabKeys = ["dashboard", "catalog", "circulation", "inventory", "digitization", "authors", "publishers", "members", "reports", "settings"];
const today = startOfToday();

function authorsLabel(authors?: string[] | null) {
  return authors?.length ? authors.join(", ") : "Unknown author";
}

function numberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] || char));
}

const code39Patterns: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
  Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "$": "nwnwnwnnn",
  "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn",
};

function code39Svg(value: string) {
  const normalized = `*${value.toUpperCase().replace(/[^0-9A-Z ./$+%-]/g, "-")}*`;
  const narrow = 2;
  const wide = 5;
  const height = 52;
  let x = 0;
  const rects: string[] = [];
  for (const char of normalized) {
    const pattern = code39Patterns[char] || code39Patterns["-"];
    [...pattern].forEach((mark, index) => {
      const width = mark === "w" ? wide : narrow;
      if (index % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}" />`);
      x += width;
    });
    x += narrow;
  }
  return `<svg viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" aria-label="${escapeHtml(value)}">${rects.join("")}</svg>`;
}

function assignmentDefaults(role: LibraryStaffAssignment["assignment_role"]) {
  if (role === "manager") {
    return { can_catalog: true, can_circulate: true, can_inventory: true, can_digitize: true, can_manage_settings: true };
  }
  if (role === "assistant") {
    return { can_catalog: false, can_circulate: true, can_inventory: true, can_digitize: true, can_manage_settings: false };
  }
  if (role === "auditor") {
    return { can_catalog: false, can_circulate: false, can_inventory: true, can_digitize: false, can_manage_settings: false };
  }
  return { can_catalog: true, can_circulate: true, can_inventory: true, can_digitize: true, can_manage_settings: false };
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const headers = Object.keys(rows[0] || { empty: "" });
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const Library = () => {
  const { user, role } = useAuth();
  const { can } = usePermissions();
  const { campuses, selectedCampusId: globalCampusId, selectedCampusName: globalCampusName } = useCampus();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabKeys.includes(searchParams.get("tab") || "") ? searchParams.get("tab")! : "dashboard";

  const canCatalog = can("library", "catalog");
  const canCirculate = can("library", "circulate");
  const canInventory = can("library", "inventory");
  const canDigitize = can("library", "digitize");
  const canManageSettings = can("library", "manage_settings");
  const canCreateLibrary = role === "super_admin" || role === "campus_admin" || role === "principal";
  const canExport = can("library", "export");
  const isPatronOnly = !canCatalog && !canCirculate && !canInventory && !canDigitize;

  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loans, setLoans] = useState<LibraryLoan[]>([]);
  const [members, setMembers] = useState<LibraryMember[]>([]);
  const [digitization, setDigitization] = useState<DigitizationRecord[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [branches, setBranches] = useState<LibraryBranch[]>([]);
  const [branchCourses, setBranchCourses] = useState<LibraryBranchCourse[]>([]);
  const [branchInstitutions, setBranchInstitutions] = useState<{ branch_id: string; institution_id: string }[]>([]);
  const [librarySettings, setLibrarySettings] = useState<LibrarySetting[]>([]);
  const [staffAssignments, setStaffAssignments] = useState<LibraryStaffAssignment[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([]);
  const [libraryCampusId, setLibraryCampusId] = useState(globalCampusId);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [newLibraryInstitutionId, setNewLibraryInstitutionId] = useState("");
  const [newLibrary, setNewLibrary] = useState({ name: "Central Library", code: "" });
  const [staffForm, setStaffForm] = useState({
    user_id: "",
    assignment_role: "librarian" as LibraryStaffAssignment["assignment_role"],
    ...assignmentDefaults("librarian"),
  });
  const [query, setQuery] = useState("");

  const [bookForm, setBookForm] = useState({
    title: "",
    authors: "",
    isbn: "",
    publisher: "",
    category: "",
    subject: "",
    accession_no: "",
    barcode: "",
    shelf_location: "",
    rack: "",
  });
  const [circulationForm, setCirculationForm] = useState({
    accession_no: "",
    admission_no: "",
  });
  const [returnAccession, setReturnAccession] = useState("");
  const [inventoryForm, setInventoryForm] = useState({ accession_no: "", status: "available", shelf_location: "", rack: "" });
  const [digitizeForm, setDigitizeForm] = useState({ isbn: "", scanned_barcode: "", source: "barcode", raw_ocr_text: "" });
  const [reviewEdits, setReviewEdits] = useState<Record<string, DigitizationReviewEdit>>({});
  const [selectedDigitization, setSelectedDigitization] = useState<Set<string>>(new Set());
  const [enrichFilter, setEnrichFilter] = useState<"all" | "enriched" | "no_match" | "not_tried" | "missing_cover">("all");
  const [publisherEntities, setPublisherEntities] = useState<{ id: string; name: string; normalized_name: string }[]>([]);
  const [enrichCron, setEnrichCron] = useState<{ enabled: boolean; minutes: number }>({ enabled: false, minutes: 30 });
  const [bulkEnrich, setBulkEnrich] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchLibrary = async () => {
    // Only show the full-page loader on first load; refetches after an action stay silent so the
    // page doesn't unmount/remount (which would reset the scroll position to the top).
    if (!initializedRef.current) setLoading(true);
    const [institutionRes, courseRes, branchRes, branchCourseRes, settingsRes, assignmentRes, bookRes, itemRes, loanRes, memberRes, digitizationRes, roleRes, pubEntityRes, branchInstRes] = await Promise.all([
      (supabase as any).from("institutions").select("id, name, code, campus_id, type").order("name"),
      (supabase as any).from("courses").select("id, name, code, department_id, departments(institution_id)").eq("is_active", true).order("name"),
      (supabase as any).from("library_branches").select("*").order("name"),
      (supabase as any).from("library_branch_courses").select("*").order("created_at", { ascending: true }),
      (supabase as any).from("library_settings").select("*"),
      (supabase as any).from("library_staff_assignments").select("*, profiles(display_name, email, phone)").order("created_at", { ascending: false }),
      (supabase as any).from("library_books").select("*").order("created_at", { ascending: false }).limit(200),
      (supabase as any)
        .from("library_items")
        .select("*, library_books(title, authors, isbn_13, cover_url), library_branches(name, code)")
        .order("created_at", { ascending: false })
        .limit(300),
      (supabase as any)
        .from("library_loans")
        .select("*, library_items(accession_no, barcode, campus_id, institution_id, branch_id, library_books(title, authors)), library_members(display_name, member_type, admission_no, phone, email)")
        .order("issued_at", { ascending: false })
        .limit(200),
      (supabase as any).from("library_members").select("*").order("display_name").limit(200),
      (supabase as any).from("library_digitization_records").select("*").order("created_at", { ascending: false }).limit(200),
      (supabase as any).from("user_roles").select("user_id, role").eq("role", "librarian"),
      (supabase as any).from("library_publishers").select("id, name, normalized_name").order("name").limit(2000),
      (supabase as any).from("library_branch_institutions").select("branch_id, institution_id"),
    ]);

    if (institutionRes.data) setInstitutions(institutionRes.data);
    if (courseRes.data) setCourses(courseRes.data);
    if (branchRes.data) setBranches(branchRes.data);
    if (branchCourseRes.data) setBranchCourses(branchCourseRes.data);
    if (settingsRes.data) setLibrarySettings(settingsRes.data);
    if (assignmentRes.data) setStaffAssignments(assignmentRes.data);
    if (bookRes.data) setBooks(bookRes.data);
    if (itemRes.data) setItems(itemRes.data);
    if (loanRes.data) setLoans(loanRes.data);
    if (memberRes.data) setMembers(memberRes.data);
    if (digitizationRes.data) setDigitization(digitizationRes.data);
    if (pubEntityRes.data) setPublisherEntities(pubEntityRes.data);
    if (branchInstRes.data) setBranchInstitutions(branchInstRes.data);
    const librarianUserIds = (roleRes.data || []).map((row: any) => row.user_id).filter(Boolean);
    if (librarianUserIds.length) {
      const { data: profileRows } = await (supabase as any)
        .from("profiles")
        .select("id, user_id, display_name, email, phone")
        .in("user_id", librarianUserIds)
        .is("archived_at", null)
        .eq("login_disabled", false)
        .order("display_name");
      setStaffProfiles(profileRows || []);
    } else {
      setStaffProfiles([]);
    }
    initializedRef.current = true;
    setLoading(false);
  };

  useEffect(() => {
    fetchLibrary();
  }, []);

  useEffect(() => {
    setLibraryCampusId(globalCampusId);
    setSelectedInstitutionId("");
    setSelectedBranchId("");
  }, [globalCampusId]);

  useEffect(() => {
    if (libraryCampusId !== "all" && !campuses.some((campus) => campus.id === libraryCampusId)) {
      setLibraryCampusId("all");
      setSelectedInstitutionId("");
      setSelectedBranchId("");
    }
  }, [campuses, libraryCampusId]);

  const visibleInstitutions = useMemo(() => {
    return institutions.filter((institution) => libraryCampusId === "all" || institution.campus_id === libraryCampusId);
  }, [institutions, libraryCampusId]);

  const isLibraryAdministrator = role === "super_admin" || role === "campus_admin" || role === "principal";
  const assignmentScopedUser = role === "librarian" && !isLibraryAdministrator;
  const myAssignedBranchIds = useMemo(() => {
    return new Set(staffAssignments.filter((assignment) => assignment.user_id === user?.id && assignment.active).map((assignment) => assignment.branch_id));
  }, [staffAssignments, user?.id]);

  const visibleBranches = useMemo(() => {
    return branches.filter((branch) => {
      if (!branch.active) return false;
      if (libraryCampusId !== "all" && branch.campus_id !== libraryCampusId) return false;
      if (selectedInstitutionId && branch.institution_id !== selectedInstitutionId) return false;
      if (assignmentScopedUser && !myAssignedBranchIds.has(branch.id)) return false;
      return true;
    });
  }, [assignmentScopedUser, branches, libraryCampusId, myAssignedBranchIds, selectedInstitutionId]);

  const selectableBranches = useMemo(() => {
    return branches.filter((branch) => {
      if (!branch.active) return false;
      if (libraryCampusId !== "all" && branch.campus_id !== libraryCampusId) return false;
      if (assignmentScopedUser && !myAssignedBranchIds.has(branch.id)) return false;
      return true;
    });
  }, [assignmentScopedUser, branches, libraryCampusId, myAssignedBranchIds]);

  useEffect(() => {
    if (selectedInstitutionId && !visibleInstitutions.some((institution) => institution.id === selectedInstitutionId)) {
      setSelectedInstitutionId("");
    }
  }, [selectedInstitutionId, visibleInstitutions]);

  useEffect(() => {
    if (selectedBranchId && !selectableBranches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId("");
    }
  }, [selectableBranches, selectedBranchId]);

  // Load the enrichment cron status when a super admin opens Settings.
  useEffect(() => {
    if (activeTab === "settings" && role === "super_admin") fetchEnrichCron();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, role]);


  useEffect(() => {
    if (!canCreateLibrary) return;
    if (!visibleInstitutions.length) {
      setNewLibraryInstitutionId("");
      return;
    }
    if (!newLibraryInstitutionId || !visibleInstitutions.some((institution) => institution.id === newLibraryInstitutionId)) {
      setNewLibraryInstitutionId(visibleInstitutions[0].id);
    }
  }, [canCreateLibrary, newLibraryInstitutionId, visibleInstitutions]);

  const selectedInstitution = institutions.find((institution) => institution.id === selectedInstitutionId) || null;
  const newLibraryInstitution = institutions.find((institution) => institution.id === newLibraryInstitutionId) || null;
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) || null;
  const selectedBranchInstitution = selectedBranch ? institutions.find((institution) => institution.id === selectedBranch.institution_id) || null : null;
  const selectedLibrarySetting = librarySettings.find((setting) => setting.branch_id === selectedBranchId) || null;
  const selectedBranchAssignments = staffAssignments.filter((assignment) => assignment.branch_id === selectedBranchId && assignment.active);
  const selectedUserAssignment = selectedBranchAssignments.find((assignment) => assignment.user_id === user?.id) || null;
  const canManageSelectedLibrary = isLibraryAdministrator
    || selectedUserAssignment?.assignment_role === "manager"
    || selectedUserAssignment?.can_manage_settings === true;
  const selectedScopeCampusId = selectedBranch?.campus_id || selectedInstitution?.campus_id || (libraryCampusId !== "all" ? libraryCampusId : "");
  const selectedScopeInstitutionId = selectedBranch?.institution_id || selectedInstitutionId;
  // A branch serves its own institution plus any explicitly mapped extras (shared libraries).
  const selectedServedInstitutionIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedBranch?.institution_id) ids.add(selectedBranch.institution_id);
    else if (selectedScopeInstitutionId) ids.add(selectedScopeInstitutionId);
    for (const row of branchInstitutions) if (row.branch_id === selectedBranchId) ids.add(row.institution_id);
    return ids;
  }, [selectedBranch, selectedScopeInstitutionId, branchInstitutions, selectedBranchId]);
  const selectedInstitutionCourses = courses.filter((course) => course.departments?.institution_id && selectedServedInstitutionIds.has(course.departments.institution_id));
  const selectedBranchCourseRows = branchCourses.filter((row) => row.branch_id === selectedBranchId && row.active);
  const selectedBranchCourseIds = new Set(selectedBranchCourseRows.map((row) => row.course_id));
  const selectedBranchCourseCount = selectedBranchId ? selectedBranchCourseIds.size : 0;
  const scopeReady = Boolean(selectedScopeCampusId && selectedScopeInstitutionId && selectedBranchId);
  const selectedCampusLabel = libraryCampusId === "all" ? "All campuses" : campuses.find((campus) => campus.id === libraryCampusId)?.name || globalCampusName;
  const selectedInstitutionLabel = selectedBranchInstitution?.name || selectedInstitution?.name || "All institutions";
  const selectedBranchLabel = selectedBranch?.name || "All libraries combined";
  const activeScopeDescription = selectedBranch
    ? `${selectedBranch.name}${selectedBranch.code ? ` (${selectedBranch.code})` : ""} · ${selectedInstitutionLabel} · ${campuses.find((campus) => campus.id === selectedBranch.campus_id)?.name || selectedCampusLabel}`
    : `${selectedCampusLabel} · ${selectedInstitutionLabel} · combined data from ${visibleBranches.length} ${visibleBranches.length === 1 ? "library" : "libraries"}`;

  const handleLibraryFilterChange = (branchId: string) => {
    setSelectedBranchId(branchId);
    if (!branchId) return;
    const branch = branches.find((row) => row.id === branchId);
    if (branch) {
      setLibraryCampusId(branch.campus_id);
      setSelectedInstitutionId(branch.institution_id);
    }
  };

  const libraryOptionLabel = (branch: LibraryBranch) => {
    const institution = institutions.find((row) => row.id === branch.institution_id);
    const branchName = `${branch.name}${branch.code ? ` (${branch.code})` : ""}`;
    return `${branchName} - ${institution?.name || "Institution not found"}`;
  };

  const digitizationValues = (record: DigitizationRecord): DigitizationReviewEdit => {
    const metadata = record.suggested_metadata || {};
    const metadataAuthors = Array.isArray(metadata.authors) ? metadata.authors.join(", ") : "";
    return {
      accession_no: record.accession_no || "",
      title: record.title || metadata.title || "",
      authors_text: record.authors_text || metadataAuthors,
      isbn: record.isbn || metadata.isbn_13 || metadata.isbn_10 || "",
      publisher: record.publisher || metadata.publisher || "",
      place: record.place || "",
      edition: record.edition || metadata.edition || "",
      pages: String(record.pages || ""),
      volume: record.volume || "",
      published_year: String(record.published_year || metadata.published_year || ""),
      category: record.category || metadata.category || "",
      subject: record.subject || metadata.subject || "",
      language: record.language || metadata.language || "",
      shelf_location: record.shelf_location || "",
      rack: record.rack || "",
      condition: record.condition || "good",
      purchase_price: String(record.purchase_price || ""),
    };
  };

  const reviewEdit = (record: DigitizationRecord) => reviewEdits[record.id] || digitizationValues(record);

  // Live preview of which publisher entity a raw value will resolve to on approval.
  const publisherByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of publisherEntities) if (p.normalized_name) m.set(p.normalized_name, p.name);
    return m;
  }, [publisherEntities]);
  const resolvePublisher = (name: string): { key: string; matchName: string | null } => {
    const key = normalizePublisher(name);
    return { key, matchName: key ? publisherByKey.get(key) ?? null : null };
  };

  const setReviewEdit = (record: DigitizationRecord, key: keyof DigitizationReviewEdit, value: string) => {
    setReviewEdits((current) => ({
      ...current,
      [record.id]: {
        ...reviewEdit(record),
        [key]: value,
      },
    }));
  };

  const duplicateSignals = (record: DigitizationRecord) => {
    const values = reviewEdit(record);
    const isbn = normalizeIsbn(values.isbn);
    const accession = values.accession_no.trim().toLowerCase();
    const branch = branches.find((row) => row.id === record.branch_id);
    const byAccession = accession && branch
      ? items.find((item) => item.institution_id === branch.institution_id && item.accession_no.toLowerCase() === accession)
      : null;
    const byIsbn = isbn
      ? books.find((book) => normalizeIsbn(book.isbn_13 || book.isbn_10 || "") === isbn)
      : null;
    return {
      accession: byAccession?.accession_no || "",
      isbn: byIsbn?.title || "",
    };
  };

  // Resolves the record's institution, then delegates to the pure duplicate checker.
  const findDuplicateReason = (
    input: { isbn?: string | null; accession?: string | null; barcode?: string | null; branchId: string },
    seen?: ReturnType<typeof emptySeen>,
  ): string | null => {
    const branch = branches.find((row) => row.id === input.branchId);
    return findDuplicateReasonPure(
      { ...input, institutionId: branch?.institution_id ?? null },
      { items, books, queue: digitization },
      seen,
    );
  };

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (libraryCampusId !== "all" && item.campus_id !== libraryCampusId) return false;
      if (selectedInstitutionId && item.institution_id !== selectedInstitutionId) return false;
      if (selectedBranchId && item.branch_id !== selectedBranchId) return false;
      if (!q) return true;
      return [
        item.accession_no,
        item.barcode,
        item.status,
        item.shelf_location,
        item.rack,
        item.library_books?.title,
        item.library_books?.isbn_13,
        item.library_branches?.name,
        authorsLabel(item.library_books?.authors),
      ].some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [items, libraryCampusId, query, selectedInstitutionId, selectedBranchId]);

  const visibleLoans = loans.filter((loan) => {
    const item = loan.library_items;
    if (!item) return false;
    if (libraryCampusId !== "all" && item.campus_id !== libraryCampusId) return false;
    if (selectedInstitutionId && item.institution_id !== selectedInstitutionId) return false;
    if (selectedBranchId && item.branch_id !== selectedBranchId) return false;
    return true;
  });
  const filteredDigitization = digitization.filter((record) => {
    if (selectedBranchId) return record.branch_id === selectedBranchId;
    if (!record.branch_id) return true;
    const branch = branches.find((row) => row.id === record.branch_id);
    if (!branch) return false;
    if (libraryCampusId !== "all" && branch.campus_id !== libraryCampusId) return false;
    if (selectedInstitutionId && branch.institution_id !== selectedInstitutionId) return false;
    if (assignmentScopedUser && !myAssignedBranchIds.has(branch.id)) return false;
    return true;
  });
  const activeLoans = visibleLoans.filter((loan) => loan.status === "active" || loan.status === "overdue");
  const overdueLoans = activeLoans.filter((loan) => isBefore(new Date(`${loan.due_on}T00:00:00`), today));
  const dueTodayLoans = activeLoans.filter((loan) => loan.due_on === format(today, "yyyy-MM-dd"));
  const scopedBookIds = new Set(filteredItems.map((item) => item.book_id));
  const lowCopyTitles = books.filter((book) => scopedBookIds.has(book.id) && filteredItems.filter((item) => item.book_id === book.id && item.status === "available").length === 0);
  const damagedOrLost = filteredItems.filter((item) => item.status === "damaged" || item.status === "lost");
  const pendingDigitization = filteredDigitization.filter((record) => ["captured", "matched", "needs_review"].includes(record.status));
  // Review queue after applying the auto-fetch filter (the visible/selectable list).
  const reviewList = filteredDigitization.filter((r) => {
    if (enrichFilter === "enriched") return r.enrichment_status === "enriched";
    if (enrichFilter === "no_match") return r.enrichment_status === "no_match";
    if (enrichFilter === "not_tried") return !r.enrichment_status;
    if (enrichFilter === "missing_cover") return !r.cover_image_url;
    return true;
  });

  const requireLibraryScope = () => {
    if (!scopeReady) {
      throw new Error("Select a campus, institution, and library before saving this record.");
    }
    return {
      campusId: selectedScopeCampusId,
      institutionId: selectedScopeInstitutionId,
      branchId: selectedBranchId,
    };
  };

  const createLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateLibrary) return;
    if (!newLibraryInstitution) {
      toast({ title: "Library setup needs an institution", description: "Select an institution before adding a library.", variant: "destructive" });
      return;
    }
    setSaving("library");
    try {
      const name = newLibrary.name.trim();
      if (!name) throw new Error("Library name is required.");
      const { data, error } = await (supabase as any)
        .from("library_branches")
        .insert({
          campus_id: newLibraryInstitution.campus_id,
          institution_id: newLibraryInstitution.id,
          name,
          code: newLibrary.code.trim() || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      const courseRows = courses
        .filter((course) => course.departments?.institution_id === newLibraryInstitution.id)
        .map((course) => ({ branch_id: data.id, course_id: course.id, created_by: user?.id || null }));
      await (supabase as any).from("library_settings").insert({ branch_id: data.id, borrowing_days: 14, borrowing_limit: 3, fine_per_day: 0 });
      if (courseRows.length) {
        await (supabase as any).from("library_branch_courses").insert(courseRows);
      }
      setBranches((current) => [...current, data]);
      setBranchCourses((current) => [...current, ...courseRows.map((row: any) => ({ ...row, id: `${data.id}-${row.course_id}`, active: true }))]);
      setSelectedInstitutionId(data.institution_id);
      setSelectedBranchId(data.id);
      setNewLibraryInstitutionId(data.institution_id);
      setNewLibrary({ name: "Central Library", code: "" });
      toast({ title: "Library added", description: `${name} is ready for cataloging and circulation.` });
    } catch (err: any) {
      toast({ title: "Library setup failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleAssignmentRoleChange = (assignment_role: LibraryStaffAssignment["assignment_role"]) => {
    setStaffForm((current) => ({
      ...current,
      assignment_role,
      ...assignmentDefaults(assignment_role),
    }));
  };

  const handleAssignStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSelectedLibrary || !selectedBranchId) return;
    setSaving("staff");
    try {
      if (!staffForm.user_id) throw new Error("Select a librarian to assign.");
      const profile = staffProfiles.find((row) => row.user_id === staffForm.user_id);
      const { error } = await (supabase as any).from("library_staff_assignments").insert({
        branch_id: selectedBranchId,
        user_id: staffForm.user_id,
        profile_id: profile?.id || null,
        assignment_role: staffForm.assignment_role,
        can_catalog: staffForm.can_catalog,
        can_circulate: staffForm.can_circulate,
        can_inventory: staffForm.can_inventory,
        can_digitize: staffForm.can_digitize,
        can_manage_settings: staffForm.can_manage_settings,
        created_by: user?.id || null,
      });
      if (error) throw error;
      toast({ title: "Librarian assigned", description: `${profile?.display_name || "Staff member"} can now manage ${selectedBranch?.name || "this library"}.` });
      setStaffForm({ user_id: "", assignment_role: "librarian", ...assignmentDefaults("librarian") });
      fetchLibrary();
    } catch (err: any) {
      toast({
        title: "Staff assignment failed",
        description: err.code === "23505" ? "This librarian is already assigned to the selected library." : err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  const handleRemoveStaff = async (assignment: LibraryStaffAssignment) => {
    if (!canManageSelectedLibrary) return;
    setSaving(`staff-${assignment.id}`);
    try {
      const { error } = await (supabase as any).from("library_staff_assignments").delete().eq("id", assignment.id);
      if (error) throw error;
      toast({ title: "Assignment removed" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Remove assignment failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleToggleBranchCourse = async (course: Course, enabled: boolean) => {
    if (!canManageSelectedLibrary || !selectedBranchId) return;
    setSaving(`course-${course.id}`);
    try {
      if (enabled) {
        const { error } = await (supabase as any)
          .from("library_branch_courses")
          .upsert({
            branch_id: selectedBranchId,
            course_id: course.id,
            active: true,
            created_by: user?.id || null,
          }, { onConflict: "branch_id,course_id" });
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("library_branch_courses")
          .update({ active: false })
          .eq("branch_id", selectedBranchId)
          .eq("course_id", course.id);
        if (error) throw error;
      }
      await fetchLibrary();
    } catch (err: any) {
      toast({ title: "Course access update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  // Add/remove an extra institution this library serves (shared-library config).
  const handleToggleServedInstitution = async (institutionId: string, served: boolean) => {
    if (!canManageSelectedLibrary || !selectedBranchId || !selectedBranch) return;
    if (institutionId === selectedBranch.institution_id) return; // owner is always served
    setSaving(`served-${institutionId}`);
    try {
      if (served) {
        const { error } = await (supabase as any)
          .from("library_branch_institutions")
          .upsert({ branch_id: selectedBranchId, institution_id: institutionId }, { onConflict: "branch_id,institution_id" });
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("library_branch_institutions")
          .delete()
          .eq("branch_id", selectedBranchId)
          .eq("institution_id", institutionId);
        if (error) throw error;
      }
      await fetchLibrary();
    } catch (err: any) {
      toast({ title: "Served-institution update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleSaveLibraryRules = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageSelectedLibrary || !selectedBranchId) return;
    const formData = new FormData(e.currentTarget);
    setSaving("library-rules");
    try {
      const { error } = await (supabase as any)
        .from("library_settings")
        .upsert({
          branch_id: selectedBranchId,
          borrowing_days: Number(formData.get("borrowing_days") || 14),
          borrowing_limit: Number(formData.get("borrowing_limit") || 3),
          fine_per_day: Number(formData.get("fine_per_day") || 0),
          renewals_allowed: Number(formData.get("renewals_allowed") || 1),
          reference_books_circulate: formData.get("reference_books_circulate") === "on",
        }, { onConflict: "branch_id" });
      if (error) throw error;
      toast({ title: "Library rules saved" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Rule save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const ensureDefaultBranch = async () => {
    if (selectedBranchId) return selectedBranchId;
    if (!selectedInstitution || !selectedScopeCampusId) {
      throw new Error("Create or select a library before capturing digitization records.");
    }
    const { data, error } = await (supabase as any)
      .from("library_branches")
      .insert({ campus_id: selectedScopeCampusId, institution_id: selectedInstitution.id, name: "Main Library", code: "MAIN" })
      .select("id")
      .single();
    if (error) throw error;
    await fetchLibrary();
    return data.id;
  };

  const handleAddBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCatalog) return;
    setSaving("catalog");
    try {
      const isbn = normalizeIsbn(bookForm.isbn);
      const scope = requireLibraryScope();
      const { data: book, error: bookError } = await (supabase as any)
        .from("library_books")
        .insert({
          title: bookForm.title.trim(),
          authors: bookForm.authors.split(",").map((a) => cleanAuthorName(a)).filter(Boolean),
          isbn_13: isbn.length === 13 ? isbn : null,
          isbn_10: isbn.length === 10 ? isbn : null,
          publisher: bookForm.publisher.trim() || null,
          category: bookForm.category.trim() || null,
          subject: bookForm.subject.trim() || null,
        })
        .select("id")
        .single();
      if (bookError) throw bookError;

      // Link reusable author/publisher entities (mirrors approval); best-effort, non-fatal.
      await (supabase as any).rpc("library_sync_book_authors", { _book_id: book.id, _authors: bookForm.authors.split(",").map((a) => cleanAuthorName(a)).filter(Boolean) });
      await (supabase as any).rpc("library_sync_book_publisher", { _book_id: book.id, _name: bookForm.publisher.trim() || null });

      const { error: itemError } = await (supabase as any).from("library_items").insert({
        book_id: book.id,
        branch_id: scope.branchId,
        campus_id: scope.campusId,
        institution_id: scope.institutionId,
        accession_no: bookForm.accession_no.trim(),
        barcode: bookForm.barcode.trim() || bookForm.accession_no.trim(),
        shelf_location: bookForm.shelf_location.trim() || null,
        rack: bookForm.rack.trim() || null,
      });
      if (itemError) throw itemError;

      toast({ title: "Book added", description: `${bookForm.title} is ready in the catalog.` });
      setBookForm({ title: "", authors: "", isbn: "", publisher: "", category: "", subject: "", accession_no: "", barcode: "", shelf_location: "", rack: "" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Catalog save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCirculate) return;
    setSaving("issue");
    try {
      requireLibraryScope();
      const accession = circulationForm.accession_no.trim();
      const admissionNo = circulationForm.admission_no.trim();
      if (!admissionNo) throw new Error("Admission number is required.");
      const { error } = await (supabase as any).rpc("library_issue_by_admission_no", {
        _branch_id: selectedBranchId,
        _accession_or_barcode: accession,
        _admission_no: admissionNo,
        _due_on: null,
      });
      if (error) throw error;
      toast({
        title: "Book issued",
        description: `Issued against admission no. ${admissionNo}. Due date follows ${selectedLibrarySetting?.borrowing_days || 14}-day library rule.`,
      });
      setCirculationForm({ accession_no: "", admission_no: "" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Issue failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCirculate) return;
    setSaving("return");
    try {
      requireLibraryScope();
      const { data, error } = await (supabase as any).rpc("library_return_by_accession", {
        _branch_id: selectedBranchId,
        _accession_or_barcode: returnAccession.trim(),
      });
      if (error) throw error;
      const fineAmount = Array.isArray(data) ? Number(data[0]?.fine_amount || 0) : 0;
      toast({
        title: "Book returned",
        description: fineAmount > 0 ? `Overdue fine posted to student fee ledger: ₹${fineAmount.toFixed(2)}.` : "No fine was due.",
      });
      setReturnAccession("");
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Return failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleInventoryUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canInventory) return;
    setSaving("inventory");
    try {
      requireLibraryScope();
      const item = filteredItems.find((row) => row.accession_no === inventoryForm.accession_no.trim() || row.barcode === inventoryForm.accession_no.trim());
      if (!item) throw new Error("No copy found for that accession or barcode in the selected library.");
      const { error } = await (supabase as any)
        .from("library_items")
        .update({
          status: inventoryForm.status,
          shelf_location: inventoryForm.shelf_location.trim() || item.shelf_location,
          rack: inventoryForm.rack.trim() || item.rack,
        })
        .eq("id", item.id);
      if (error) throw error;
      toast({ title: "Inventory updated", description: `${item.accession_no} marked ${inventoryForm.status}.` });
      setInventoryForm({ accession_no: "", status: "available", shelf_location: "", rack: "" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Inventory update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleDigitize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canDigitize) return;
    setSaving("digitize");
    try {
      const branchId = await ensureDefaultBranch();
      const isbn = normalizeIsbn(digitizeForm.isbn || digitizeForm.scanned_barcode);
      const duplicateReason = findDuplicateReason({ isbn, barcode: digitizeForm.scanned_barcode, branchId });
      if (duplicateReason && !window.confirm(`${duplicateReason}.\n\nCapture it anyway (it will be flagged as a duplicate)?`)) {
        setSaving(null);
        return;
      }
      let suggested: any = {};
      let confidence = 0.2;
      if (isbn) {
        const { data, error } = await supabase.functions.invoke("library-book-lookup", { body: { isbn } });
        if (!error && data?.book) {
          suggested = data.book;
          confidence = data.confidence || 0.75;
        }
      }
      const { error } = await (supabase as any).from("library_digitization_records").insert({
        branch_id: branchId,
        source: digitizeForm.source,
        scanned_barcode: digitizeForm.scanned_barcode.trim() || null,
        isbn: isbn || null,
        raw_ocr_text: digitizeForm.raw_ocr_text.trim() || null,
        suggested_metadata: suggested,
        confidence,
        status: duplicateReason ? "duplicate" : (Object.keys(suggested).length ? "matched" : "needs_review"),
        notes: duplicateReason || null,
      });
      if (error) throw error;
      toast({ title: duplicateReason ? "Captured as duplicate" : "Digitization record captured", description: duplicateReason || (Object.keys(suggested).length ? "Metadata matched and queued for review." : "Queued for librarian review.") });
      setDigitizeForm({ isbn: "", scanned_barcode: "", source: "barcode", raw_ocr_text: "" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Digitization failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleImportLibraryFile = async (file: File | null) => {
    if (!file || !canDigitize) return;
    setSaving("library-import");
    try {
      const branchId = await ensureDefaultBranch();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheetName = workbook.SheetNames[0];
      // Read as array-of-arrays so we can find the real header row and forward-fill
      // ditto/blank cells before mapping columns. defval keeps blank cells positional.
      const grid = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false }).slice(0, 20000);
      if (!grid.length) throw new Error("No rows found in the selected file.");

      const headerIdx = detectHeaderRow(grid.map((r) => (r || []).map((c) => (c ?? "").toString())));
      const headerRow = (grid[headerIdx] || []).map((c) => (c ?? "").toString());
      const cols = resolveColumns(headerRow);
      if (cols.title == null && cols.accession == null) {
        throw new Error("Could not find an Accession or Title column. Check the file's header row.");
      }
      const width = headerRow.length;
      const body = grid.slice(headerIdx + 1).map((r) => (r || []).map((c) => (c ?? "").toString()));
      // Forward-fill ditto/blank cells, but never propagate the per-row accession or remark.
      const exempt = new Set<number>();
      if (cols.accession != null) exempt.add(cols.accession);
      if (cols.remark != null) exempt.add(cols.remark);
      const filled = forwardFill(body, width, exempt);
      const cell = (row: string[], field: string) => (cols[field] != null ? (row[cols[field]] ?? "").toString().trim() : "");

      const { data: batch, error: batchError } = await (supabase as any)
        .from("library_digitization_batches")
        .insert({
          branch_id: branchId,
          name: `Import - ${file.name}`,
          created_by: user?.id || null,
        })
        .select("id")
        .single();
      if (batchError) throw batchError;

      const records = [];
      const seen = emptySeen();
      let dupCount = 0;
      for (const row of filled) {
        const accession = cell(row, "accession");
        const author = cell(row, "author");
        const title = cell(row, "title");
        if (!accession && !title && !author) continue; // skip blank/spacer rows
        const isbn = normalizeIsbn(cell(row, "isbn"));
        const barcode = cell(row, "barcode") || null;
        const duplicateReason = findDuplicateReason({ isbn, accession, barcode, branchId }, seen);
        if (duplicateReason) dupCount += 1;
        rememberSeen(seen, { isbn, accession, barcode });
        // ISBN-less registers never hit the network; only look up when an ISBN is present.
        let suggested: any = {};
        let confidence = isbn ? 0.35 : 0.2;
        if (isbn && !duplicateReason) {
          const { data } = await supabase.functions.invoke("library-book-lookup", { body: { isbn } });
          if (data?.book) {
            suggested = data.book;
            confidence = data.confidence || 0.82;
          }
        }
        const { place, publisher } = splitPlacePublisher(cell(row, "placePublisher"));
        const remark = cell(row, "remark");
        const authorsText = cleanAuthorName(author) || (Array.isArray(suggested.authors) ? suggested.authors.join(", ") : null);
        records.push({
          batch_id: batch.id,
          branch_id: branchId,
          captured_by: user?.id || null,
          source: "csv_import",
          accession_no: accession || null,
          scanned_barcode: barcode,
          isbn: isbn || null,
          title: title || suggested.title || null,
          authors_text: authorsText,
          publisher: publisher || suggested.publisher || null,
          place: place || null,
          edition: cell(row, "edition") || suggested.edition || null,
          pages: parseIntLoose(cell(row, "pages")),
          volume: cell(row, "volume") || null,
          published_year: parseIntLoose(cell(row, "year")) ?? suggested.published_year ?? null,
          category: cell(row, "category") || suggested.category || null,
          subject: cell(row, "subject") || suggested.subject || null,
          language: cell(row, "language") || suggested.language || null,
          shelf_location: cell(row, "shelf"),
          rack: cell(row, "rack"),
          condition: cell(row, "condition") || "good",
          purchase_price: parseAmount(cell(row, "cost")),
          import_row: Object.fromEntries(headerRow.map((h, i) => [h || `col${i}`, row[i] ?? ""])),
          suggested_metadata: Object.keys(suggested).length ? suggested : {
            title,
            authors: authorsText ? authorsText.split(",").map((name) => name.trim()).filter(Boolean) : [],
          },
          confidence,
          status: duplicateReason ? "duplicate" : (Object.keys(suggested).length ? "matched" : "needs_review"),
          notes: [duplicateReason, remark ? `Remark: ${remark}` : null].filter(Boolean).join(" · ") || null,
        });
      }

      if (!records.length) throw new Error("No importable rows found (all rows were blank).");

      // Chunk inserts so a 2,600+ row register doesn't exceed the request payload limit.
      const CHUNK = 500;
      for (let i = 0; i < records.length; i += CHUNK) {
        const { error } = await (supabase as any).from("library_digitization_records").insert(records.slice(i, i + CHUNK));
        if (error) throw error;
      }
      toast({ title: "Import queued", description: `${records.length} book rows added${dupCount ? `, ${dupCount} flagged as duplicates` : ""}.` });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Library import failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleGenerateAccession = async (record: DigitizationRecord) => {
    const branchId = record.branch_id || selectedBranchId;
    if (!branchId) return;
    setSaving(`accession-${record.id}`);
    try {
      const { data, error } = await (supabase as any).rpc("library_next_accession_no", {
        _branch_id: branchId,
        _prefix: branches.find((branch) => branch.id === branchId)?.code || null,
      });
      if (error) throw error;
      setReviewEdit(record, "accession_no", data || "");
    } catch (err: any) {
      toast({ title: "Accession generation failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleApproveDigitization = async (record: DigitizationRecord) => {
    if (!canCatalog) return;
    const values = reviewEdit(record);
    setSaving(`approve-${record.id}`);
    try {
      const { error } = await (supabase as any).rpc("library_approve_digitization_record", {
        _record_id: record.id,
        _accession_no: values.accession_no.trim() || null,
        _title: values.title.trim() || null,
        _authors_text: values.authors_text.trim() || null,
        _isbn: normalizeIsbn(values.isbn) || null,
        _publisher: values.publisher.trim() || null,
        _published_year: numberOrNull(values.published_year),
        _category: values.category.trim() || null,
        _subject: values.subject.trim() || null,
        _language: values.language.trim() || null,
        _shelf_location: values.shelf_location.trim() || null,
        _rack: values.rack.trim() || null,
        _condition: values.condition.trim() || "good",
        _purchase_price: numberOrNull(values.purchase_price),
        _edition: values.edition.trim() || null,
        _pages: numberOrNull(values.pages),
        _volume: values.volume.trim() || null,
        _place: values.place.trim() || null,
      });
      if (error) throw error;
      toast({ title: "Book approved", description: "Catalog title and physical copy were created." });
      setReviewEdits((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleRejectDigitization = async (record: DigitizationRecord) => {
    if (!canDigitize) return;
    setSaving(`reject-${record.id}`);
    try {
      const { error } = await (supabase as any).rpc("library_reject_digitization_record", {
        _record_id: record.id,
        _notes: "Rejected during librarian review",
      });
      if (error) throw error;
      toast({ title: "Record rejected" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Reject failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleMarkDuplicate = async (record: DigitizationRecord) => {
    if (!canDigitize) return;
    setSaving(`duplicate-${record.id}`);
    try {
      const { error } = await (supabase as any).rpc("library_mark_digitization_duplicate", {
        _record_id: record.id,
        _duplicate_of: null,
        _notes: "Marked duplicate during librarian review",
      });
      if (error) throw error;
      toast({ title: "Record marked duplicate" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Duplicate update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  // A record is worth enriching if it's missing a cover or any of the key metadata fields.
  const recordNeedsEnrichment = (r: DigitizationRecord) => {
    const blank = (v: unknown) => v == null || String(v).trim() === "";
    return blank(r.cover_image_url) || blank(r.isbn) || blank(r.publisher)
      || blank(r.category) || blank(r.subject) || blank(r.language);
  };

  // Core enrichment: look up a record, fill only BLANK columns, pull a cover. No toast/refetch —
  // returns what it did so single and bulk callers can present it. `prefer` picks the lookup source.
  const enrichRecordOnce = async (
    record: DigitizationRecord,
    prefer?: "open_library",
  ): Promise<{ matched: boolean; filled: number; cover: boolean; overlay: Partial<DigitizationReviewEdit> }> => {
    const markStatus = async (enrichment_status: string) => {
      await (supabase as any).from("library_digitization_records").update({ enrichment_status }).eq("id", record.id);
    };
    const values = reviewEdit(record);
    const isbn = normalizeIsbn(values.isbn);
    const title = values.title.trim();
    if (!isbn && !title) { await markStatus("no_match"); return { matched: false, filled: 0, cover: false, overlay: {} }; }

    const { data, error } = await supabase.functions.invoke("library-book-lookup", {
      body: { isbn: isbn || undefined, title: title || undefined, author: values.authors_text.split(",")[0]?.trim() || undefined, prefer },
    });
    const book = data?.book;
    if (error || !book) { await markStatus("no_match"); return { matched: false, filled: 0, cover: false, overlay: {} }; }

    const blank = (v: unknown) => v == null || String(v).trim() === "";
    const upd: Record<string, unknown> = {};
    const overlay: Partial<DigitizationReviewEdit> = {};
    const bookIsbn = normalizeIsbn(book.isbn_13 || book.isbn_10 || "");
    if (blank(record.isbn) && bookIsbn) { upd.isbn = bookIsbn; overlay.isbn = bookIsbn; }
    if (blank(record.title) && book.title) { upd.title = book.title; overlay.title = book.title; }
    if (blank(record.authors_text) && Array.isArray(book.authors) && book.authors.length) {
      const a = book.authors.map((x: string) => cleanAuthorName(x)).filter(Boolean).join(", ");
      if (a) { upd.authors_text = a; overlay.authors_text = a; }
    }
    if (blank(record.publisher) && book.publisher) { upd.publisher = book.publisher; overlay.publisher = book.publisher; }
    if (blank(record.category) && book.category) { upd.category = book.category; overlay.category = book.category; }
    if (blank(record.subject) && book.subject) { upd.subject = book.subject; overlay.subject = book.subject; }
    if (blank(record.language) && book.language) { upd.language = book.language; overlay.language = book.language; }
    if (blank(record.published_year) && book.published_year) { upd.published_year = book.published_year; overlay.published_year = String(book.published_year); }
    upd.suggested_metadata = { ...(record.suggested_metadata || {}), ...book };
    upd.enrichment_status = "enriched";

    const { error: updErr } = await (supabase as any).from("library_digitization_records").update(upd).eq("id", record.id);
    if (updErr) throw updErr;

    let cover = false;
    if (book.cover_url && blank(record.cover_image_url)) {
      const cap = await supabase.functions.invoke("library-cover-capture", {
        body: { target: "record", id: record.id, source_url: book.cover_url },
      });
      cover = !!cap.data?.ok;
    }
    return { matched: true, filled: Object.keys(overlay).length, cover, overlay };
  };

  const handleAutofillRecord = async (record: DigitizationRecord) => {
    if (!canDigitize) return;
    const values = reviewEdit(record);
    if (!normalizeIsbn(values.isbn) && !values.title.trim()) {
      toast({ title: "Need a title or ISBN", description: "Add a title (or ISBN) before auto-filling.", variant: "destructive" });
      return;
    }
    setSaving(`cover-${record.id}`);
    try {
      const res = await enrichRecordOnce(record);
      if (!res.matched) throw new Error("No match found online");
      // Reflect filled values in the review form without dropping unsaved edits.
      setReviewEdits((cur) => ({ ...cur, [record.id]: { ...reviewEdit(record), ...res.overlay } }));
      toast({ title: "Enriched from web", description: `${res.filled} field(s) filled${res.cover ? " + cover" : ""}.` });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Auto-fill failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  // Enrich a set of pending records that still need data. Batched with small concurrency and
  // prefer=open_library (no API key / no daily quota) so a large queue doesn't hit Google limits.
  const handleBulkEnrich = async (setSize = 50) => {
    if (!canDigitize) return;
    const queue = filteredDigitization.filter((r) => ["captured", "matched", "needs_review"].includes(r.status) && recordNeedsEnrichment(r)).slice(0, setSize);
    if (!queue.length) {
      toast({ title: "Nothing to enrich", description: "All pending records in view already have covers and metadata." });
      return;
    }
    setBulkEnrich({ done: 0, total: queue.length });
    let filledFields = 0, matched = 0, covers = 0;
    try {
      const CONCURRENCY = 4;
      for (let i = 0; i < queue.length; i += CONCURRENCY) {
        const batch = queue.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map((r) => enrichRecordOnce(r, "open_library")));
        for (const res of results) {
          if (res.status === "fulfilled" && res.value.matched) { matched += 1; filledFields += res.value.filled; if (res.value.cover) covers += 1; }
        }
        setBulkEnrich({ done: Math.min(i + CONCURRENCY, queue.length), total: queue.length });
      }
      toast({ title: "Bulk enrich complete", description: `${matched}/${queue.length} matched · ${filledFields} fields filled · ${covers} covers.` });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Bulk enrich stopped", description: err.message, variant: "destructive" });
      fetchLibrary();
    } finally {
      setBulkEnrich(null);
    }
  };

  // Super-admin: schedule / run the server-side enrichment batch.
  const fetchEnrichCron = async () => {
    try {
      const { data } = await (supabase as any).rpc("library_get_enrich_cron");
      if (data?.[0]) setEnrichCron({ enabled: !!data[0].enabled, minutes: Number(data[0].minutes) || 30 });
    } catch { /* non-fatal */ }
  };
  const handleSetEnrichCron = async (enabled: boolean, minutes: number) => {
    setSaving("enrich-cron");
    try {
      const { error } = await (supabase as any).rpc("library_set_enrich_cron", { _enabled: enabled, _minutes: minutes });
      if (error) throw error;
      setEnrichCron({ enabled, minutes });
      toast({ title: enabled ? `Auto-fill scheduled every ${minutes} min` : "Auto-fill schedule turned off" });
    } catch (err: any) {
      toast({ title: "Schedule update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };
  const handleRunEnrichNow = async () => {
    setSaving("enrich-now");
    try {
      const { data, error } = await (supabase as any).functions.invoke("library-enrich-batch", { body: { limit: 150 } });
      if (error) throw error;
      toast({ title: "Batch run complete", description: `${data?.matched ?? 0} matched · ${data?.covers ?? 0} covers · ${data?.remaining ?? 0} left` });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Batch run failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleUploadCover = async (record: DigitizationRecord, file: File | null) => {
    if (!file || !canDigitize) return;
    setSaving(`cover-${record.id}`);
    try {
      const image_base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("library-cover-capture", {
        body: { target: "record", id: record.id, image_base64 },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Upload failed");
      toast({ title: "Cover uploaded" });
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Cover upload failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const toggleDigitizationSelected = (id: string) => {
    setSelectedDigitization((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDeleteDigitization = async () => {
    if (!canDigitize || selectedDigitization.size === 0) return;
    const ids = [...selectedDigitization];
    if (!window.confirm(`Permanently delete ${ids.length} digitization record(s)? This cannot be undone.`)) return;
    setSaving("bulk-delete");
    try {
      const { data, error } = await (supabase as any).rpc("library_delete_digitization_records", { _record_ids: ids });
      if (error) throw error;
      const deleted = Number(data ?? 0);
      toast({ title: `${deleted} record(s) deleted`, description: deleted < ids.length ? `${ids.length - deleted} skipped (no access)` : undefined });
      setSelectedDigitization(new Set());
      fetchLibrary();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handlePrintBarcodeLabels = () => {
    const rows = filteredItems.filter((item) => item.accession_no);
    if (!rows.length) {
      toast({ title: "No labels to print", description: "The current library filter has no accessioned books." });
      return;
    }
    const html = `<!doctype html>
      <html>
        <head>
          <title>Library Barcode Labels</title>
          <style>
            @page { size: A4; margin: 10mm; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
            .label { border: 1px solid #111; min-height: 82px; padding: 7px; break-inside: avoid; }
            .library { font-size: 10px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .barcode svg { width: 100%; height: 38px; margin-top: 4px; }
            .accession { font-size: 12px; font-weight: 700; text-align: center; letter-spacing: 0; margin-top: 2px; }
            .title { font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
          </style>
        </head>
        <body>
          <div class="grid">
            ${rows.map((item) => `
              <div class="label">
                <div class="library">${escapeHtml(item.library_branches?.name || selectedBranchLabel)}</div>
                <div class="barcode">${code39Svg(item.accession_no)}</div>
                <div class="accession">${escapeHtml(item.accession_no)}</div>
                <div class="title">${escapeHtml(item.library_books?.title || "Library book")}</div>
              </div>
            `).join("")}
          </div>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>`;
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      toast({ title: "Popup blocked", description: "Allow popups to print barcode labels.", variant: "destructive" });
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Library</h1>
          <p className="text-sm text-muted-foreground mt-1">{isPatronOnly ? "Search, holds, renewals, and current loans" : "Catalog, circulation, inventory, and digitization"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> {role?.replace(/_/g, " ") || "User"}</Badge>
          <Button variant="outline" size="sm" onClick={fetchLibrary}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.9fr)]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" />
                Data View Filter
              </CardTitle>
              <Badge variant={selectedBranch ? "outline" : "secondary"}>
                {selectedBranch ? "Single library" : "All libraries combined"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Campus
                <select
                  value={libraryCampusId}
                  onChange={(e) => {
                    setLibraryCampusId(e.target.value);
                    setSelectedInstitutionId("");
                    setSelectedBranchId("");
                  }}
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="all">All campuses</option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}{campus.code ? ` (${campus.code})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Institution
                <select
                  value={selectedInstitutionId}
                  onChange={(e) => {
                    setSelectedInstitutionId(e.target.value);
                    setSelectedBranchId("");
                  }}
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">All institutions</option>
                  {visibleInstitutions.length === 0 ? (
                    <option value="" disabled>No institutions for this campus</option>
                  ) : (
                    visibleInstitutions.map((institution) => (
                      <option key={institution.id} value={institution.id}>
                        {institution.name}{institution.code ? ` (${institution.code})` : ""}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Library
                <select
                  value={selectedBranchId}
                  onChange={(e) => handleLibraryFilterChange(e.target.value)}
                  disabled={selectableBranches.length === 0}
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
                >
                  <option value="">All libraries</option>
                  {selectableBranches.length === 0 ? (
                    <option value="" disabled>No library configured</option>
                  ) : (
                    selectableBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {libraryOptionLabel(branch)}
                      </option>
                    ))
                  )}
                </select>
                {selectedBranchInstitution && (
                  <span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">
                    Institution: {selectedBranchInstitution.name}{selectedBranchInstitution.code ? ` (${selectedBranchInstitution.code})` : ""}
                  </span>
                )}
              </label>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">Currently viewing</p>
                  <p className="mt-1 text-base font-semibold text-foreground">{selectedBranchLabel}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{activeScopeDescription}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{filteredItems.length} copies</Badge>
                  <Badge variant="outline">{activeLoans.length} active loans</Badge>
                  <Badge variant="outline">{pendingDigitization.length} pending digitization</Badge>
                  {selectedBranchId && <Badge variant="outline">{selectedBranchCourseCount} courses enabled</Badge>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {canCreateLibrary && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" />
                Add Library
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createLibrary} className="space-y-3">
                <label className="block text-xs font-medium text-muted-foreground">
                  Institution for new library
                  <select
                    value={newLibraryInstitutionId}
                    onChange={(e) => setNewLibraryInstitutionId(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {visibleInstitutions.length === 0 ? (
                      <option value="">No institutions for this campus</option>
                    ) : (
                      visibleInstitutions.map((institution) => (
                        <option key={institution.id} value={institution.id}>
                          {institution.name}{institution.code ? ` (${institution.code})` : ""}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                  <Input label="Library Name" value={newLibrary.name} placeholder="Central Library" onChange={(name) => setNewLibrary((p) => ({ ...p, name }))} />
                  <Input label="Code" value={newLibrary.code} placeholder="LIB-A" onChange={(code) => setNewLibrary((p) => ({ ...p, code }))} />
                </div>
                <Button type="submit" disabled={!newLibraryInstitutionId || saving === "library"} className="w-full">
                  {saving === "library" ? <ButtonOrb state="working" onFilled /> : <Plus className="mr-2 h-4 w-4" />}
                  Add Library
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ tab })} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="circulation">Issue / Return</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="digitization">Digitization</TabsTrigger>
          <TabsTrigger value="authors">Authors</TabsTrigger>
          <TabsTrigger value="publishers">Publishers</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Active Loans" value={activeLoans.length} icon={BookOpen} />
            <StatCard title="Overdue" value={overdueLoans.length} icon={AlertTriangle} tone="danger" />
            <StatCard title="Due Today" value={dueTodayLoans.length} icon={Clock} />
            <StatCard title="Pending Digitization" value={pendingDigitization.length} icon={FileSearch} />
            <StatCard title="Catalog Titles" value={scopedBookIds.size} icon={LibraryIcon} />
            <StatCard title="Physical Copies" value={filteredItems.length} icon={Barcode} />
            <StatCard title="No Available Copy" value={lowCopyTitles.length} icon={Search} />
            <StatCard title="Lost / Damaged" value={damagedOrLost.length} icon={AlertTriangle} tone="danger" />
          </div>
          <CatalogSearch query={query} setQuery={setQuery} items={filteredItems.slice(0, 12)} canHold={!canCirculate} />
        </TabsContent>

        <TabsContent value="catalog" className="grid gap-4 xl:grid-cols-[420px_1fr]">
          {canCatalog && (
            <Card>
              <CardHeader><CardTitle className="text-base">Add Book + Copy</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleAddBook} className="space-y-3">
                  <Input label="Title" value={bookForm.title} required onChange={(title) => setBookForm((p) => ({ ...p, title }))} />
                  <Input label="Authors" value={bookForm.authors} placeholder="Comma separated" onChange={(authors) => setBookForm((p) => ({ ...p, authors }))} />
                  <Input label="ISBN" value={bookForm.isbn} onChange={(isbn) => setBookForm((p) => ({ ...p, isbn }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Publisher" value={bookForm.publisher} onChange={(publisher) => setBookForm((p) => ({ ...p, publisher }))} />
                    <Input label="Category" value={bookForm.category} onChange={(category) => setBookForm((p) => ({ ...p, category }))} />
                  </div>
                  <Input label="Subject" value={bookForm.subject} onChange={(subject) => setBookForm((p) => ({ ...p, subject }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Accession No." value={bookForm.accession_no} required onChange={(accession_no) => setBookForm((p) => ({ ...p, accession_no }))} />
                    <Input label="Barcode" value={bookForm.barcode} onChange={(barcode) => setBookForm((p) => ({ ...p, barcode }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Shelf" value={bookForm.shelf_location} onChange={(shelf_location) => setBookForm((p) => ({ ...p, shelf_location }))} />
                    <Input label="Rack" value={bookForm.rack} onChange={(rack) => setBookForm((p) => ({ ...p, rack }))} />
                  </div>
                  <Button type="submit" disabled={!scopeReady || saving === "catalog"} className="w-full">
                    {saving === "catalog" ? <ButtonOrb state="working" onFilled /> : <Plus className="mr-2 h-4 w-4" />}
                    Save Catalog Record
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
          <CatalogSearch query={query} setQuery={setQuery} items={filteredItems} canHold={!canCirculate} />
        </TabsContent>

        <TabsContent value="circulation" className="grid gap-4 xl:grid-cols-2">
          {canCirculate && !scopeReady && <div className="xl:col-span-2"><ScopeNotice action="issue or return books" /></div>}
          <Card>
            <CardHeader><CardTitle className="text-base">Issue Book</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleIssue} className="space-y-3">
                <Input label="Accession / Barcode" value={circulationForm.accession_no} required disabled={!canCirculate || !scopeReady} onChange={(accession_no) => setCirculationForm((p) => ({ ...p, accession_no }))} />
                <Input label="Student Admission No." value={circulationForm.admission_no} required disabled={!canCirculate || !scopeReady} onChange={(admission_no) => setCirculationForm((p) => ({ ...p, admission_no }))} />
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Borrowing rule</p>
                  <p>
                    {selectedBranch ? selectedBranch.name : "Selected library"} allows {selectedLibrarySetting?.borrowing_days || 14} day loans,
                    limit {selectedLibrarySetting?.borrowing_limit || 3} active books, and ₹{Number(selectedLibrarySetting?.fine_per_day || 0).toFixed(2)} fine per overdue day.
                  </p>
                  <p className="mt-1">
                    Student must be active, must belong to an enabled course for this library, and must have no unpaid library dues.
                  </p>
                </div>
                <Button type="submit" disabled={!canCirculate || !scopeReady || saving === "issue"} className="w-full">
                  {saving === "issue" ? <ButtonOrb state="working" onFilled /> : <BookOpen className="mr-2 h-4 w-4" />}
                  Issue
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Return Book</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleReturn} className="flex gap-2">
                <input value={returnAccession} disabled={!canCirculate || !scopeReady} onChange={(e) => setReturnAccession(e.target.value)} placeholder="Accession or barcode" className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm" />
                <Button type="submit" disabled={!canCirculate || !scopeReady || saving === "return"}>
                  {saving === "return" ? <ButtonOrb state="working" onFilled /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  Return
                </Button>
              </form>
              <LoanList loans={activeLoans} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          {canInventory && !scopeReady && <ScopeNotice action="run a shelf audit" />}
          <Card>
            <CardHeader><CardTitle className="text-base">Shelf Audit</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleInventoryUpdate} className="grid gap-3 md:grid-cols-5">
                <Input label="Accession / Barcode" value={inventoryForm.accession_no} required disabled={!canInventory || !scopeReady} onChange={(accession_no) => setInventoryForm((p) => ({ ...p, accession_no }))} />
                <Select label="Status" value={inventoryForm.status} disabled={!canInventory || !scopeReady} options={["available", "issued", "reserved", "lost", "damaged", "repair", "withdrawn", "reference_only"]} onChange={(status) => setInventoryForm((p) => ({ ...p, status }))} />
                <Input label="Shelf" value={inventoryForm.shelf_location} disabled={!canInventory || !scopeReady} onChange={(shelf_location) => setInventoryForm((p) => ({ ...p, shelf_location }))} />
                <Input label="Rack" value={inventoryForm.rack} disabled={!canInventory || !scopeReady} onChange={(rack) => setInventoryForm((p) => ({ ...p, rack }))} />
                <Button type="submit" disabled={!canInventory || !scopeReady || saving === "inventory"} className="self-end">
                  {saving === "inventory" ? <ButtonOrb state="working" onFilled /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Update
                </Button>
              </form>
            </CardContent>
          </Card>
          <CatalogSearch query={query} setQuery={setQuery} items={filteredItems} canHold={false} />
        </TabsContent>

        <TabsContent value="digitization" className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="space-y-4">
            {canDigitize && !scopeReady && <ScopeNotice action="capture, import, or print labels" />}
            <Card>
              <CardHeader><CardTitle className="text-base">Capture Offline Record</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleDigitize} className="space-y-3">
                  <Select label="Source" value={digitizeForm.source} disabled={!canDigitize || !scopeReady} options={["barcode", "cover_photo", "spine_photo", "csv_import", "manual"]} onChange={(source) => setDigitizeForm((p) => ({ ...p, source }))} />
                  <Input label="ISBN" value={digitizeForm.isbn} disabled={!canDigitize || !scopeReady} onChange={(isbn) => setDigitizeForm((p) => ({ ...p, isbn }))} />
                  <Input label="Scanned Barcode" value={digitizeForm.scanned_barcode} disabled={!canDigitize || !scopeReady} onChange={(scanned_barcode) => setDigitizeForm((p) => ({ ...p, scanned_barcode }))} />
                  <label className="block text-xs font-medium text-muted-foreground">
                    OCR / Notes
                    <textarea value={digitizeForm.raw_ocr_text} disabled={!canDigitize || !scopeReady} onChange={(e) => setDigitizeForm((p) => ({ ...p, raw_ocr_text: e.target.value }))} className="mt-1.5 min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
                  </label>
                  <Button type="submit" disabled={!canDigitize || !scopeReady || saving === "digitize"} className="w-full">
                    {saving === "digitize" ? <ButtonOrb state="working" onFilled /> : <Barcode className="mr-2 h-4 w-4" />}
                    Capture
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel / CSV Import
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Import existing registers into the review queue. Approval creates final catalog titles and copy accessions.
                </p>
                <label className="block rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    disabled={!canDigitize || !scopeReady || saving === "library-import"}
                    onChange={(e) => {
                      handleImportLibraryFile(e.target.files?.[0] || null);
                      e.currentTarget.value = "";
                    }}
                  />
                  {saving === "library-import" ? <ButtonOrb state="composing" className="mx-auto mb-2" /> : <FileSpreadsheet className="mx-auto mb-2 h-5 w-5" />}
                  Select Excel or CSV file
                </label>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Printer className="h-4 w-4" />
                  Accession Barcode Labels
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Print Code 39 labels for the currently filtered catalog. Paste them on books without reliable accession barcodes.
                </p>
                <Button type="button" variant="outline" className="w-full" disabled={!canExport || filteredItems.length === 0} onClick={handlePrintBarcodeLabels}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print {filteredItems.length} Labels
                </Button>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">Review Queue</CardTitle>
              {canDigitize && filteredDigitization.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={enrichFilter}
                    onChange={(e) => { setEnrichFilter(e.target.value as typeof enrichFilter); setSelectedDigitization(new Set()); }}
                    className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                  >
                    <option value="all">All ({filteredDigitization.length})</option>
                    <option value="enriched">Auto-fetch ✓ ({filteredDigitization.filter((r) => r.enrichment_status === "enriched").length})</option>
                    <option value="no_match">Auto-fetch failed ({filteredDigitization.filter((r) => r.enrichment_status === "no_match").length})</option>
                    <option value="not_tried">Not tried ({filteredDigitization.filter((r) => !r.enrichment_status).length})</option>
                    <option value="missing_cover">Missing cover ({filteredDigitization.filter((r) => !r.cover_image_url).length})</option>
                  </select>
                  <Button type="button" variant="outline" size="sm" disabled={!!bulkEnrich} onClick={() => handleBulkEnrich(50)}>
                    {bulkEnrich ? <ButtonOrb state="working" /> : <FileSearch className="mr-2 h-4 w-4" />}
                    {bulkEnrich ? `Enriching ${bulkEnrich.done}/${bulkEnrich.total}…` : "Auto-fill next 50"}
                  </Button>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={reviewList.length > 0 && selectedDigitization.size === reviewList.length}
                      ref={(el) => { if (el) el.indeterminate = selectedDigitization.size > 0 && selectedDigitization.size < reviewList.length; }}
                      onChange={(e) => setSelectedDigitization(e.target.checked ? new Set(reviewList.map((r) => r.id)) : new Set())}
                    />
                    Select all
                  </label>
                  <Button type="button" variant="destructive" size="sm" disabled={selectedDigitization.size === 0 || saving === "bulk-delete"} onClick={handleBulkDeleteDigitization}>
                    {saving === "bulk-delete" ? <ButtonOrb state="working" onFilled /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Delete selected{selectedDigitization.size > 0 ? ` (${selectedDigitization.size})` : ""}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {reviewList.length === 0 ? <EmptyRow text={filteredDigitization.length === 0 ? "No digitization records yet" : "No records match this filter"} /> : reviewList.map((record) => {
                  const values = reviewEdit(record);
                  const signals = duplicateSignals(record);
                  const canApproveRecord = canCatalog && ["captured", "matched", "needs_review"].includes(record.status);
                  return (
                    <div key={record.id} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                          {canDigitize && (
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded border-border"
                              checked={selectedDigitization.has(record.id)}
                              onChange={() => toggleDigitizationSelected(record.id)}
                            />
                          )}
                          {record.cover_image_url ? (
                            <img src={record.cover_image_url} alt="" className="h-14 w-10 shrink-0 rounded border border-border object-cover" />
                          ) : (
                            <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded border border-dashed border-border text-muted-foreground"><BookOpen className="h-4 w-4" /></div>
                          )}
                          <div>
                          <p className="text-sm font-medium text-foreground">{values.title || record.isbn || record.scanned_barcode || "Untitled capture"}</p>
                          <p className="text-xs text-muted-foreground">
                            {record.source} · {record.isbn || "no ISBN"} · {new Date(record.created_at).toLocaleDateString("en-IN")}
                          </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {record.enrichment_status === "enriched" && (
                            <Badge className="border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Auto-fetch ✓</Badge>
                          )}
                          {record.enrichment_status === "no_match" && (
                            <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Auto-fetch failed</Badge>
                          )}
                          {record.confidence != null && <Badge variant="secondary">{Math.round(Number(record.confidence) * 100)}%</Badge>}
                          <Badge variant={record.status === "needs_review" ? "destructive" : "outline"}>{record.status.replace(/_/g, " ")}</Badge>
                        </div>
                      </div>
                      {(signals.accession || signals.isbn) && (
                        <div className="mt-3 rounded-xl border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning-foreground">
                          {signals.accession && <p>Accession already exists: {signals.accession}</p>}
                          {signals.isbn && <p>ISBN matches existing title: {signals.isbn}</p>}
                        </div>
                      )}
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <Input label="Accession No." value={values.accession_no} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "accession_no", value)} />
                        <Input label="Title" value={values.title} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "title", value)} />
                        <Input label="Authors" value={values.authors_text} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "authors_text", value)} />
                        <Input label="ISBN" value={values.isbn} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "isbn", value)} />
                        <Input label="Place" value={values.place} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "place", value)} />
                        <div>
                          <Input label="Publisher" value={values.publisher} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "publisher", value)} />
                          {values.publisher.trim() && (() => {
                            const r = resolvePublisher(values.publisher);
                            if (r.matchName && r.matchName !== values.publisher.trim()) {
                              return <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">↳ Resolves to: {r.matchName}</p>;
                            }
                            if (r.matchName) return <p className="mt-1 text-[11px] text-muted-foreground">↳ Matches existing publisher</p>;
                            return <p className="mt-1 text-[11px] text-muted-foreground">↳ New publisher on approval</p>;
                          })()}
                        </div>
                        <Input label="Edition" value={values.edition} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "edition", value)} />
                        <Input label="Volume" value={values.volume} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "volume", value)} />
                        <Input label="Pages" value={values.pages} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "pages", value)} />
                        <Input label="Year" value={values.published_year} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "published_year", value)} />
                        <Input label="Category" value={values.category} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "category", value)} />
                        <Input label="Subject" value={values.subject} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "subject", value)} />
                        <Input label="Language" value={values.language} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "language", value)} />
                        <Input label="Shelf" value={values.shelf_location} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "shelf_location", value)} />
                        <Input label="Rack" value={values.rack} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "rack", value)} />
                        <Input label="Price" value={values.purchase_price} disabled={!canApproveRecord} onChange={(value) => setReviewEdit(record, "purchase_price", value)} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={!canApproveRecord || saving === `accession-${record.id}`} onClick={() => handleGenerateAccession(record)}>
                          {saving === `accession-${record.id}` ? <ButtonOrb state="working" /> : <Barcode className="mr-2 h-4 w-4" />}
                          Generate Accession
                        </Button>
                        <Button type="button" size="sm" disabled={!canApproveRecord || !values.title.trim() || saving === `approve-${record.id}`} onClick={() => handleApproveDigitization(record)}>
                          {saving === `approve-${record.id}` ? <ButtonOrb state="working" onFilled /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                          Approve to Catalog
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={!canDigitize || !canApproveRecord || saving === `duplicate-${record.id}`} onClick={() => handleMarkDuplicate(record)}>
                          Mark Duplicate
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={!canDigitize || saving === `cover-${record.id}`} onClick={() => handleAutofillRecord(record)}>
                          {saving === `cover-${record.id}` ? <ButtonOrb state="working" /> : <FileSearch className="mr-2 h-4 w-4" />}
                          Auto-fill from web
                        </Button>
                        <label className={`inline-flex cursor-pointer items-center rounded-md border border-input px-3 text-sm font-medium h-9 ${!canDigitize || saving === `cover-${record.id}` ? "pointer-events-none opacity-50" : "hover:bg-accent"}`}>
                          Upload cover
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleUploadCover(record, e.target.files?.[0] || null); e.currentTarget.value = ""; }} />
                        </label>
                        <Button type="button" variant="outline" size="sm" disabled={!canDigitize || !canApproveRecord || saving === `reject-${record.id}`} onClick={() => handleRejectDigitization(record)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="authors">
          <CatalogEntityManager
            nounSingular="author" nounPlural="authors" canManage={canCatalog} active={activeTab === "authors"}
            listRpc="library_list_authors" dupPairsRpc="library_author_duplicate_pairs"
            mergeRpc="library_merge_authors" renameRpc="library_rename_author"
          />
        </TabsContent>

        <TabsContent value="publishers">
          <CatalogEntityManager
            nounSingular="publisher" nounPlural="publishers" canManage={canCatalog} active={activeTab === "publishers"}
            listRpc="library_list_publishers" dupPairsRpc="library_publisher_duplicate_pairs"
            mergeRpc="library_merge_publishers" renameRpc="library_rename_publisher"
          />
        </TabsContent>

        <TabsContent value="members">
          <Card>
            <CardHeader><CardTitle className="text-base">Members</CardTitle></CardHeader>
            <CardContent>
              <div className="divide-y divide-border rounded-xl border border-border">
                {members.length === 0 ? <EmptyRow text="No members yet" /> : members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-3 p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{member.display_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {member.member_type}
                        {member.admission_no ? ` · admission ${member.admission_no}` : ""}
                        {member.institution_id ? ` · ${institutions.find((institution) => institution.id === member.institution_id)?.name || "institution"}` : ""}
                        · limit {member.borrowing_limit} · {member.phone || member.email || "no contact"}
                      </p>
                    </div>
                    <Badge variant={member.status === "active" ? "outline" : "destructive"}>{member.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <ReportAction title="Overdue Loans" count={overdueLoans.length} disabled={!canExport} onClick={() => downloadCsv("library-overdue.csv", overdueLoans as any)} />
            <ReportAction title="Lost / Damaged" count={damagedOrLost.length} disabled={!canExport} onClick={() => downloadCsv("library-lost-damaged.csv", damagedOrLost as any)} />
            <ReportAction title="Catalog Export" count={filteredItems.length} disabled={!canExport} onClick={() => downloadCsv("library-catalog.csv", filteredItems.map((item) => ({
              campus: campuses.find((campus) => campus.id === item.campus_id)?.name,
              institution: institutions.find((institution) => institution.id === item.institution_id)?.name,
              library: item.library_branches?.name,
              accession_no: item.accession_no,
              barcode: item.barcode,
              title: item.library_books?.title,
              authors: authorsLabel(item.library_books?.authors),
              status: item.status,
              shelf: item.shelf_location,
              rack: item.rack,
            })))} />
          </div>
          <LoanList loans={visibleLoans.slice(0, 80)} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          {role === "super_admin" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSearch className="h-4 w-4" />
                  Automatic metadata enrichment (super admin)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Runs the "Auto-fill from web" batch on the server for never-tried pending records across all
                  libraries (prefers Open Library — no quota). Fills blank fields + fetches covers, ~150 records per run.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={enrichCron.enabled}
                      disabled={saving === "enrich-cron"}
                      onChange={(e) => handleSetEnrichCron(e.target.checked, enrichCron.minutes)}
                    />
                    <span className="font-medium text-foreground">Run automatically</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Every
                    <select
                      value={enrichCron.minutes}
                      disabled={saving === "enrich-cron"}
                      onChange={(e) => handleSetEnrichCron(enrichCron.enabled, Number(e.target.value))}
                      className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                    >
                      <option value={30}>30 minutes</option>
                      <option value={60}>60 minutes</option>
                    </select>
                  </label>
                  <Button type="button" variant="outline" size="sm" disabled={saving === "enrich-now"} onClick={handleRunEnrichNow}>
                    {saving === "enrich-now" ? <ButtonOrb state="working" /> : <FileSearch className="mr-2 h-4 w-4" />}
                    Run now
                  </Button>
                  <Badge variant={enrichCron.enabled ? "outline" : "secondary"}>
                    {enrichCron.enabled ? `Scheduled · every ${enrichCron.minutes} min` : "Off"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <span>Libraries</span>
                <Badge variant={selectedBranch ? "outline" : "secondary"}>
                  {selectedBranch ? selectedBranch.name : "No library selected"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Library to configure
                <select
                  value={selectedBranchId}
                  onChange={(e) => handleLibraryFilterChange(e.target.value)}
                  disabled={selectableBranches.length === 0}
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
                >
                  <option value="">Select a library</option>
                  {selectableBranches.length === 0 ? (
                    <option value="" disabled>No library configured</option>
                  ) : (
                    selectableBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {libraryOptionLabel(branch)}
                      </option>
                    ))
                  )}
                </select>
                {selectedBranchInstitution && (
                  <span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">
                    Institution: {selectedBranchInstitution.name}{selectedBranchInstitution.code ? ` (${selectedBranchInstitution.code})` : ""}
                  </span>
                )}
              </label>
              <div className="divide-y divide-border rounded-xl border border-border">
                {visibleBranches.length === 0 ? <EmptyRow text={canCreateLibrary ? "No library configured for the selected institution. Add one above." : "No libraries visible"} /> : visibleBranches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => handleLibraryFilterChange(branch.id)}
                    className={`flex w-full items-center justify-between gap-3 p-3 text-left transition-colors ${
                      selectedBranchId === branch.id ? "bg-primary/5 ring-1 ring-inset ring-primary/30" : "hover:bg-muted/40"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{branch.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {branch.code || "no code"} · {institutions.find((institution) => institution.id === branch.institution_id)?.name || "institution"} · {campuses.find((campus) => campus.id === branch.campus_id)?.name || "campus"} · {branch.active ? "active" : "inactive"}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      {selectedBranchId === branch.id && <Badge variant="outline">Selected</Badge>}
                      <Settings className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Loan Rules for {selectedBranch?.name || "Selected Library"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedBranchId ? (
                <EmptyRow text="Select a library to configure loan duration and fines" />
              ) : (
                <form key={selectedBranchId || "library-rules"} onSubmit={handleSaveLibraryRules} className="grid gap-3 md:grid-cols-5">
                  <Input label="Loan Days" name="borrowing_days" type="number" min={1} defaultValue={selectedLibrarySetting?.borrowing_days || 14} disabled={!canManageSelectedLibrary} />
                  <Input label="Book Limit" name="borrowing_limit" type="number" min={1} defaultValue={selectedLibrarySetting?.borrowing_limit || 3} disabled={!canManageSelectedLibrary} />
                  <Input label="Fine / Day" name="fine_per_day" type="number" min={0} step="0.01" defaultValue={selectedLibrarySetting?.fine_per_day || 0} disabled={!canManageSelectedLibrary} />
                  <Input label="Renewals" name="renewals_allowed" type="number" min={0} defaultValue={selectedLibrarySetting?.renewals_allowed || 1} disabled={!canManageSelectedLibrary} />
                  <div className="flex items-end">
                    <Button type="submit" disabled={!canManageSelectedLibrary || saving === "library-rules"} className="w-full">
                      {saving === "library-rules" ? <ButtonOrb state="working" onFilled /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Save Rules
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground md:col-span-5">
                    <input name="reference_books_circulate" type="checkbox" defaultChecked={selectedLibrarySetting?.reference_books_circulate || false} disabled={!canManageSelectedLibrary} />
                    Allow reference-only books to circulate
                  </label>
                </form>
              )}
            </CardContent>
          </Card>
          {canManageSelectedLibrary && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4" />
                  Served Institutions for {selectedBranch?.name || "Selected Library"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selectedBranchId ? (
                  <EmptyRow text="Select a library to configure which institutions it serves" />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      A shared library serves students of more than one institution on the same campus. The owning
                      institution is always served; tick others to let their students borrow (then enable their courses below).
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {institutions
                        .filter((inst) => inst.campus_id === selectedBranch?.campus_id)
                        .map((inst) => {
                          const isOwner = inst.id === selectedBranch?.institution_id;
                          const served = isOwner || selectedServedInstitutionIds.has(inst.id);
                          return (
                            <label key={inst.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-foreground">{inst.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">{isOwner ? "Owning institution" : inst.code}</span>
                              </span>
                              <input
                                type="checkbox"
                                checked={served}
                                disabled={isOwner || saving === `served-${inst.id}`}
                                onChange={(e) => handleToggleServedInstitution(inst.id, e.target.checked)}
                              />
                            </label>
                          );
                        })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4" />
                Borrowing Access for {selectedBranch?.name || "Selected Library"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedBranchId ? (
                <EmptyRow text="Select a library to configure course borrowing access" />
              ) : selectedInstitutionCourses.length === 0 ? (
                <EmptyRow text="No courses found under this library institution" />
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{selectedBranchCourseCount}</span> of {selectedInstitutionCourses.length} institution courses can borrow from this library.
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {selectedInstitutionCourses.map((course) => {
                      const checked = selectedBranchCourseIds.has(course.id);
                      return (
                        <label key={course.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{course.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{course.code}</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canManageSelectedLibrary || saving === `course-${course.id}`}
                            onChange={(e) => handleToggleBranchCourse(course, e.target.checked)}
                          />
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Librarians for {selectedBranch?.name || "Selected Library"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canManageSelectedLibrary && selectedBranchId && (
                <form onSubmit={handleAssignStaff} className="grid gap-3 lg:grid-cols-[1.4fr_150px_1.8fr_auto]">
                  <label className="block text-xs font-medium text-muted-foreground">
                    Librarian
                    <select
                      value={staffForm.user_id}
                      onChange={(e) => setStaffForm((p) => ({ ...p, user_id: e.target.value }))}
                      className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      <option value="">Select librarian</option>
                      {staffProfiles
                        .filter((profile) => !selectedBranchAssignments.some((assignment) => assignment.user_id === profile.user_id))
                        .map((profile) => (
                          <option key={profile.user_id} value={profile.user_id}>
                            {profile.display_name || profile.email || profile.phone || "Unnamed librarian"}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    Role
                    <select
                      value={staffForm.assignment_role}
                      onChange={(e) => handleAssignmentRoleChange(e.target.value as LibraryStaffAssignment["assignment_role"])}
                      className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      {["manager", "librarian", "assistant", "auditor"].map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 text-xs text-muted-foreground sm:grid-cols-5">
                    {[
                      ["can_catalog", "Catalog"],
                      ["can_circulate", "Circulate"],
                      ["can_inventory", "Inventory"],
                      ["can_digitize", "Digitize"],
                      ["can_manage_settings", "Settings"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(staffForm[key as keyof typeof staffForm])}
                          onChange={(e) => setStaffForm((p) => ({ ...p, [key]: e.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Button type="submit" disabled={!staffForm.user_id || saving === "staff"} className="self-end">
                    {saving === "staff" ? <ButtonOrb state="working" onFilled /> : <UserPlus className="mr-2 h-4 w-4" />}
                    Assign
                  </Button>
                </form>
              )}
              <div className="divide-y divide-border rounded-xl border border-border">
                {!selectedBranchId ? (
                  <EmptyRow text="Select a library to manage librarians" />
                ) : selectedBranchAssignments.length === 0 ? (
                  <EmptyRow text={canManageSelectedLibrary ? "No librarians assigned to this library yet" : "No librarian assignments visible"} />
                ) : selectedBranchAssignments.map((assignment) => (
                  <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {assignment.profiles?.display_name || assignment.profiles?.email || assignment.profiles?.phone || assignment.user_id}
                      </p>
                      <p className="text-xs text-muted-foreground">{assignment.assignment_role} · {[
                        assignment.can_catalog && "catalog",
                        assignment.can_circulate && "circulate",
                        assignment.can_inventory && "inventory",
                        assignment.can_digitize && "digitize",
                        assignment.can_manage_settings && "settings",
                      ].filter(Boolean).join(", ") || "view only"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={assignment.active ? "outline" : "secondary"}>{assignment.active ? "active" : "inactive"}</Badge>
                      {canManageSelectedLibrary && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={saving === `staff-${assignment.id}`}
                          onClick={() => handleRemoveStaff(assignment)}
                        >
                          {saving === `staff-${assignment.id}` ? <ButtonOrb state="working" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

function StatCard({ title, value, icon: Icon, tone }: { title: string; value: number; icon: any; tone?: "danger" }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
        </div>
        <Icon className={`h-5 w-5 ${tone === "danger" ? "text-destructive" : "text-primary"}`} />
      </CardContent>
    </Card>
  );
}

function CatalogSearch({ query, setQuery, items, canHold }: { query: string; setQuery: (v: string) => void; items: LibraryItem[]; canHold: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Catalog</CardTitle>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, author, ISBN, accession..." className="w-full rounded-xl border border-input bg-background py-2 pl-10 pr-3 text-sm" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border rounded-xl border border-border">
          {items.length === 0 ? <EmptyRow text="No catalog matches" /> : items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-3">
                {item.library_books?.cover_url ? (
                  <img src={item.library_books.cover_url} alt="" className="h-12 w-9 shrink-0 rounded border border-border object-cover" />
                ) : (
                  <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded border border-dashed border-border text-muted-foreground"><BookOpen className="h-4 w-4" /></div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.library_books?.title || "Untitled book"}</p>
                  <p className="truncate text-xs text-muted-foreground">{authorsLabel(item.library_books?.authors)} · {item.accession_no} · {item.shelf_location || "unshelved"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={item.status === "available" ? "outline" : item.status === "issued" ? "secondary" : "destructive"}>{item.status.replace(/_/g, " ")}</Badge>
                {canHold && <Button variant="outline" size="sm" disabled={item.status === "available"}>Hold</Button>}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LoanList({ loans }: { loans: LibraryLoan[] }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      {loans.length === 0 ? <EmptyRow text="No loans found" /> : loans.map((loan) => (
        <div key={loan.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{loan.library_items?.library_books?.title || loan.library_items?.accession_no || "Loan"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {loan.library_members?.display_name || "Member"}
              {loan.library_members?.admission_no ? ` · ${loan.library_members.admission_no}` : ""}
              · due {loan.due_on}
            </p>
          </div>
          <Badge variant={loan.status === "active" ? "outline" : loan.status === "returned" ? "secondary" : "destructive"}>{loan.status}</Badge>
        </div>
      ))}
    </div>
  );
}

function ReportAction({ title, count, disabled, onClick }: { title: string; count: number; disabled: boolean; onClick: () => void }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{count} rows</p>
        </div>
        <Button variant="outline" size="sm" disabled={disabled || count === 0} onClick={onClick}><Download className="mr-2 h-4 w-4" /> CSV</Button>
      </CardContent>
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{text}</div>;
}

// Shown at the top of scope-gated tabs so it's obvious why actions are disabled.
function ScopeNotice({ action }: { action: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Select a <span className="font-semibold">Library</span> above to {action}. These actions stay disabled while “All libraries” is selected.</span>
    </div>
  );
}

function Input({
  label,
  value,
  defaultValue,
  onChange,
  type = "text",
  required,
  disabled,
  placeholder,
  name,
  min,
  step,
}: {
  label: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
  min?: number;
  step?: string;
}) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      <input
        type={type}
        name={name}
        required={required}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        min={min}
        step={step}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
      />
    </label>
  );
}

function Select({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: string[]; disabled?: boolean }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50">
        {options.map((option) => <option key={option} value={option}>{option.replace(/_/g, " ")}</option>)}
      </select>
    </label>
  );
}

export default Library;
