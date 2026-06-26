import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const roleMigration = readFileSync("supabase/migrations/20260626100000_add_librarian_role.sql", "utf8");
const libraryMigration = readFileSync("supabase/migrations/20260626100100_library_module.sql", "utf8");
const staffAssignmentMigration = readFileSync("supabase/migrations/20260626113000_library_staff_assignments.sql", "utf8");
const staffPolicyTighteningMigration = readFileSync("supabase/migrations/20260626114500_library_staff_policy_tightening.sql", "utf8");
const studentAccessMigration = readFileSync("supabase/migrations/20260626193000_library_student_access_rules.sql", "utf8");
const digitizationApprovalMigration = readFileSync("supabase/migrations/20260627003100_library_digitization_approval.sql", "utf8");
const libraryPage = readFileSync("src/pages/Library.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const permissions = readFileSync("src/components/admin/PermissionMatrixPanel.tsx", "utf8");
const inviteDialog = readFileSync("src/components/admin/InviteUserDialog.tsx", "utf8");
const mobileTabs = readFileSync("mobile/app/(tabs)/_layout.tsx", "utf8");
const mobileAuth = readFileSync("mobile/contexts/AuthContext.tsx", "utf8");
const mobileLibrary = readFileSync("mobile/app/(tabs)/library.tsx", "utf8");
const lookupFunction = readFileSync("supabase/functions/library-book-lookup/index.ts", "utf8");

describe("library module", () => {
  it("adds librarian as a first-class role and exposes it in admin role surfaces", () => {
    expect(roleMigration).toContain("ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'librarian'");
    expect(inviteDialog).toContain('{ value: "librarian", label: "Librarian" }');
    expect(permissions).toContain('"ib_coordinator", "librarian"');
    expect(mobileAuth).toContain("| 'librarian'");
  });

  it("creates the library schema with catalog, circulation, digitization, and audit tables", () => {
    for (const table of [
      "library_branches",
      "library_books",
      "library_items",
      "library_members",
      "library_loans",
      "library_holds",
      "library_fines",
      "library_digitization_batches",
      "library_digitization_records",
      "library_audit_events",
      "library_settings",
    ]) {
      expect(libraryMigration).toContain(`public.${table}`);
      expect(libraryMigration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }

    expect(libraryMigration).toContain("library_mark_item_issued");
    expect(libraryMigration).toContain("Library item is not available for issue");
    expect(libraryMigration).toContain("idx_library_one_active_loan_per_item");
    expect(libraryMigration).toContain("institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE");
    expect(libraryMigration).toContain("UNIQUE (campus_id, institution_id, name)");
    expect(libraryMigration).toContain("UNIQUE (institution_id, accession_no)");
    expect(libraryMigration).toContain("idx_library_items_institution_status");
  });

  it("seeds library permissions and keeps operational writes scoped to library staff", () => {
    for (const action of ["view", "catalog", "circulate", "inventory", "digitize", "manage_settings", "export"]) {
      expect(libraryMigration).toContain(`('library', '${action}'`);
    }

    expect(libraryMigration).toContain("public.has_role(auth.uid(), 'librarian'::public.app_role)");
    expect(libraryMigration).toContain("SELECT 'librarian'::public.app_role, id");
    expect(libraryMigration).toContain("SELECT 'super_admin'::public.app_role, id");
    expect(libraryMigration).toContain("p.action = 'view'");
    expect(libraryMigration).toContain("ARRAY['student','parent','faculty','teacher']");
    expect(libraryMigration).toContain('CREATE POLICY "Library staff catalog books"');
    expect(libraryMigration).toContain('CREATE POLICY "Patrons create own holds"');
  });

  it("links librarians to specific libraries before allowing branch operations", () => {
    expect(staffAssignmentMigration).toContain("public.library_staff_assignments");
    expect(staffAssignmentMigration).toContain("branch_id uuid NOT NULL REFERENCES public.library_branches");
    expect(staffAssignmentMigration).toContain("user_id uuid NOT NULL REFERENCES auth.users");
    expect(staffAssignmentMigration).toContain("UNIQUE (branch_id, user_id)");
    expect(staffAssignmentMigration).toContain("library_user_can_access_branch");
    expect(staffAssignmentMigration).toContain("_action = 'catalog' AND a.can_catalog");
    expect(staffAssignmentMigration).toContain("_action = 'circulate' AND a.can_circulate");
    expect(staffAssignmentMigration).toContain('DROP POLICY IF EXISTS "Library staff manage items"');
    expect(staffAssignmentMigration).toContain('CREATE POLICY "Library staff catalog items"');
    expect(staffAssignmentMigration).toContain('CREATE POLICY "Library staff circulate loans"');
    expect(staffPolicyTighteningMigration).toContain("_action IN ('view', 'manage_settings', 'export')");
    expect(staffPolicyTighteningMigration).toContain('CREATE POLICY "Library administrators create branches"');
    expect(staffPolicyTighteningMigration).toContain('CREATE POLICY "Library managers update branches"');
  });

  it("derives student library membership from admission and course access rules", () => {
    expect(studentAccessMigration).toContain("public.library_branch_courses");
    expect(studentAccessMigration).toContain("library_branch_student_members");
    expect(studentAccessMigration).toContain("admission_no text");
    expect(studentAccessMigration).toContain("library_student_can_borrow_from_branch");
    expect(studentAccessMigration).toContain("library_student_has_unpaid_dues");
    expect(studentAccessMigration).toContain("Student has unpaid library dues and cannot borrow more books");
    expect(studentAccessMigration).toContain("Student has reached the active book borrowing limit");
    expect(studentAccessMigration).toContain("library_issue_by_admission_no");
    expect(studentAccessMigration).toContain("library_return_by_accession");
    expect(studentAccessMigration).toContain("LIB-FINE");
    expect(studentAccessMigration).toContain("public.fee_ledger");
  });

  it("stages imported book records for librarian review before approving catalog copies", () => {
    expect(digitizationApprovalMigration).toContain("ALTER TABLE public.library_digitization_records");
    expect(digitizationApprovalMigration).toContain("accession_no text");
    expect(digitizationApprovalMigration).toContain("import_row jsonb");
    expect(digitizationApprovalMigration).toContain("library_next_accession_no");
    expect(digitizationApprovalMigration).toContain("library_approve_digitization_record");
    expect(digitizationApprovalMigration).toContain("Accession number % already exists in this institution");
    expect(digitizationApprovalMigration).toContain("INSERT INTO public.library_books");
    expect(digitizationApprovalMigration).toContain("INSERT INTO public.library_items");
    expect(digitizationApprovalMigration).toContain("digitization.approved");
    expect(digitizationApprovalMigration).toContain("library_mark_digitization_duplicate");
    expect(digitizationApprovalMigration).toContain("library_reject_digitization_record");
  });

  it("routes the web Library module under permission-gated Library navigation", () => {
    expect(app).toContain('const Library              = lazy(() => import("./pages/Library"))');
    expect(app).toContain('<RequirePermission module="library" action="view"><Library /></RequirePermission>');
    expect(sidebar).toContain("const academicsSubMenu");
    expect(sidebar).toContain('title: "Library Dashboard"');
    expect(sidebar).toContain('permission: "library:digitize"');
    expect(sidebar).toContain("<span>Library</span>");
  });

  it("implements core web workflows for catalog, circulation, inventory, digitization, and exports", () => {
    expect(libraryPage).toContain("Data View Filter");
    expect(libraryPage).toContain("Add Library");
    expect(libraryPage).toContain("All libraries combined");
    expect(libraryPage).toContain("libraryCampusId");
    expect(libraryPage).toContain("setLibraryCampusId");
    expect(libraryPage).toContain("newLibraryInstitutionId");
    expect(libraryPage).toContain("handleLibraryFilterChange");
    expect(libraryPage).toContain("libraryOptionLabel");
    expect(libraryPage).toContain("Institution:");
    expect(libraryPage).toContain("selectedInstitutionId");
    expect(libraryPage).toContain("createLibrary");
    expect(libraryPage).toContain("canCreateLibrary");
    expect(libraryPage).toContain("Library Name");
    expect(libraryPage).toContain("Student Admission No.");
    expect(libraryPage).toContain("library_issue_by_admission_no");
    expect(libraryPage).toContain("library_return_by_accession");
    expect(libraryPage).toContain("library_branch_courses");
    expect(libraryPage).toContain("Loan Rules for");
    expect(libraryPage).toContain("Borrowing Access for");
    expect(libraryPage).toContain("Library to configure");
    expect(libraryPage).toContain("onClick={() => handleLibraryFilterChange(branch.id)}");
    expect(libraryPage).toContain("selectedBranchId === branch.id");
    expect(libraryPage).toContain('key={selectedBranchId || "library-rules"}');
    expect(libraryPage).toContain("requireLibraryScope");
    expect(libraryPage).toContain("library_staff_assignments");
    expect(libraryPage).toContain("handleAssignStaff");
    expect(libraryPage).toContain("Librarians for");
    expect(libraryPage).toContain('from("library_books")');
    expect(libraryPage).toContain('from("library_items")');
    expect(libraryPage).toContain('from("library_loans")');
    expect(libraryPage).toContain('from("library_digitization_records")');
    expect(libraryPage).toContain('supabase.functions.invoke("library-book-lookup"');
    expect(libraryPage).toContain('const XLSX = await import("xlsx")');
    expect(libraryPage).toContain("handleImportLibraryFile");
    expect(libraryPage).toContain("Excel / CSV Import");
    expect(libraryPage).toContain("Review Queue");
    expect(libraryPage).toContain("Approve to Catalog");
    expect(libraryPage).toContain("Generate Accession");
    expect(libraryPage).toContain("library_approve_digitization_record");
    expect(libraryPage).toContain("library_mark_digitization_duplicate");
    expect(libraryPage).toContain("library_reject_digitization_record");
    expect(libraryPage).toContain("Accession Barcode Labels");
    expect(libraryPage).toContain("code39Svg");
    expect(libraryPage).toContain("handleIssue");
    expect(libraryPage).toContain("handleReturn");
    expect(libraryPage).toContain("handleInventoryUpdate");
    expect(libraryPage).toContain("downloadCsv");
  });

  it("adds a mobile Library tab with scanner capture for librarians and patron discovery", () => {
    expect(mobileTabs).toContain("librarian:");
    expect(mobileTabs).toContain("{ name: 'library', title: 'Library', icon: BookOpen }");
    expect(mobileTabs).toContain("if (role === 'librarian') return roleTabs.librarian");
    expect(mobileLibrary).toContain("CameraView");
    expect(mobileLibrary).toContain("onBarcodeScanned");
    expect(mobileLibrary).toContain("type ScanAction = 'digitize' | 'issue' | 'return' | 'audit'");
    expect(mobileLibrary).toContain("issueScannedBook");
    expect(mobileLibrary).toContain("returnScannedBook");
    expect(mobileLibrary).toContain("auditScannedBook");
    expect(mobileLibrary).toContain("library_issue_by_admission_no");
    expect(mobileLibrary).toContain("library_return_by_accession");
    expect(mobileLibrary).toContain("library_digitization_records");
    expect(mobileLibrary).toContain("library_staff_assignments");
    expect(mobileLibrary).toContain("branch_id: selectedBranchId");
    expect(mobileLibrary).toContain("library-book-lookup");
    expect(mobileLibrary).toContain("canOperate ? 'Scan, digitize, and audit books' : 'Search catalog and current loans'");
  });

  it("normalizes external ISBN metadata lookup through one edge function", () => {
    expect(lookupFunction).toContain("www.googleapis.com/books/v1/volumes");
    expect(lookupFunction).toContain("openlibrary.org/isbn");
    expect(lookupFunction).toContain("covers.openlibrary.org");
    expect(lookupFunction).toContain("A valid ISBN-10 or ISBN-13 is required");
  });
});
