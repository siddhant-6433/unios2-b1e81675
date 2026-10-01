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
const accessPolicy = readFileSync("src/lib/accessPolicy.ts", "utf8");
const inviteDialog = readFileSync("src/components/admin/InviteUserDialog.tsx", "utf8");
// Mobile moved to (staff)/(family) route groups: librarians now land on the
// staff Work tab, and the library screen lives under (family).
const mobileWork = readFileSync("mobile/app/(staff)/(tabs)/work.tsx", "utf8");
const mobileAuth = readFileSync("mobile/contexts/AuthContext.tsx", "utf8");
const mobileLibrary = readFileSync("mobile/app/(family)/library.tsx", "utf8");
const lookupFunction = readFileSync("supabase/functions/library-book-lookup/index.ts", "utf8");
const librarianAccessMigration = readFileSync(
  "supabase/migrations/20260922171823_library_librarian_access_and_bulk_approval.sql",
  "utf8",
);
const libraryQueuePerfMigration = readFileSync(
  "supabase/migrations/20260922180544_library_digitization_queue_perf_and_grants.sql",
  "utf8",
);
const publisherCanonicalMigration = readFileSync(
  "supabase/migrations/20260923044733_library_publisher_canonicalization.sql",
  "utf8",
);
const myBranchesMigration = readFileSync(
  "supabase/migrations/20260923052956_library_my_branches_rpc.sql",
  "utf8",
);
const publisherRecordsMigration = readFileSync(
  "supabase/migrations/20260923142236_library_publisher_records_rpc.sql",
  "utf8",
);
const accessMatrixSearchMigration = readFileSync(
  "supabase/migrations/20260923150559_library_access_matrix_search.sql",
  "utf8",
);
const barcodeScanner = readFileSync("src/components/library/BarcodeScanner.tsx", "utf8");
const publisherNormalizer = readFileSync("src/components/library/PublisherNormalizer.tsx", "utf8");

describe("library module", () => {
  it("adds librarian as a first-class role and exposes it in admin role surfaces", () => {
    expect(roleMigration).toContain("ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'librarian'");
    expect(inviteDialog).toContain('{ value: "librarian", label: "Librarian" }');
    // The role list is derived from accessPolicy, so the matrix picks up
    // librarian automatically instead of hardcoding it.
    expect(accessPolicy).toContain('librarian: "Librarian"');
    expect(permissions).toContain("ALL_APP_ROLES");
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
    expect(libraryPage).toContain("Access Matrix");
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
    expect(libraryPage).toContain("Accession QR Labels");
    expect(libraryPage).toContain("handlePrintQrLabels");
    expect(libraryPage).toContain("handleIssue");
    expect(libraryPage).toContain("handleReturn");
    expect(libraryPage).toContain("handleInventoryUpdate");
    expect(libraryPage).toContain("downloadCsv");
  });

  it("adds a mobile Library tab with scanner capture for librarians and patron discovery", () => {
    expect(mobileWork).toContain("if (role === 'librarian') return <LibrarianWork");
    expect(mobileWork).toContain("function LibrarianWork(");
    expect(mobileLibrary).toContain("CameraView");
    expect(mobileLibrary).toContain("onBarcodeScanned");
    expect(mobileLibrary).toContain("type ScanAction = 'digitize' | 'issue' | 'return' | 'audit'");
    expect(mobileLibrary).toContain("issueScannedBook");
    expect(mobileLibrary).toContain("returnScannedBook");
    expect(mobileLibrary).toContain("auditScannedBook");
    expect(mobileLibrary).toContain("library_issue_by_admission_no");
    expect(mobileLibrary).toContain("library_return_by_accession");
    expect(mobileLibrary).toContain("library_digitization_records");
    expect(mobileLibrary).toContain("library_my_branches");
    // Only ISBN-shaped scans trigger a metadata lookup.
    expect(mobileLibrary).toContain("startsWith('978')");
    expect(mobileLibrary).toContain("branch_id: selectedBranchId");
    expect(mobileLibrary).toContain("library-book-lookup");
    expect(mobileLibrary).toContain("canOperate ? 'Scan, digitize, and audit books' : 'Search catalog and current loans'");
  });

  it("makes the librarian role operational without a manual staff assignment", () => {
    // The librarian gets campus-scoped operational access by role, but an explicit
    // assignment still overrides the fallback (so auditors stay restricted).
    expect(librarianAccessMigration).toContain("public.library_user_has_explicit_assignment");
    expect(librarianAccessMigration).toContain("public.has_role(_user_id, 'librarian'::public.app_role)");
    expect(librarianAccessMigration).toContain("NOT public.library_user_has_explicit_assignment(_user_id)");
    expect(librarianAccessMigration).toContain("public.user_has_campus_scope(_user_id)");
    expect(librarianAccessMigration).toContain("_action IN ('view', 'catalog', 'circulate', 'inventory', 'digitize', 'export')");
    // Principal/campus_admin get read oversight of the queue.
    expect(librarianAccessMigration).toContain("public.library_can_view_digitization");
    expect(librarianAccessMigration).toContain('CREATE POLICY "Library staff view digitization records"');
  });

  it("approves imported registers in bulk with accession generation and duplicate handling", () => {
    expect(librarianAccessMigration).toContain("public.library_bulk_approve_digitization");
    expect(librarianAccessMigration).toContain("public.library_mark_duplicate_accessions");
    expect(librarianAccessMigration).toContain("public.library_existing_accessions");
    expect(librarianAccessMigration).toContain("Duplicate accession in queue");
    expect(librarianAccessMigration).toContain("Accession already in catalog");
    // Reuses the single-record approval (18-arg overload) so accession minting stays consistent.
    expect(librarianAccessMigration).toContain("PERFORM public.library_approve_digitization_record(");
    // Existing branches get loan rules backfilled.
    expect(librarianAccessMigration).toContain("INSERT INTO public.library_settings (branch_id, borrowing_days");
    // Patron self-service holds.
    expect(librarianAccessMigration).toContain("public.library_place_hold");
  });

  it("pages and filters the digitization queue on the server instead of a 200-row fetch", () => {
    expect(librarianAccessMigration).toContain("public.library_list_digitization_records");
    expect(librarianAccessMigration).toContain("public.library_digitization_summary");
    expect(libraryPage).toContain("library_list_digitization_records");
    expect(libraryPage).toContain("library_digitization_summary");
    expect(libraryPage).toContain("library_mark_duplicate_accessions");
    expect(libraryPage).toContain("library_bulk_approve_digitization");
    expect(libraryPage).toContain("library_existing_accessions");
    expect(libraryPage).toContain("Approve all pending");
    expect(libraryPage).toContain("fetchDigitization");
    // Patron (faculty/student) discovery view.
    expect(libraryPage).toContain("function PatronLibrary(");
    expect(libraryPage).toContain("library_place_hold");
    expect(libraryPage).toContain("isPatronOnly");
  });

  it("exposes an operable library access matrix for granular grant/revoke", () => {
    // Server API: roster + upsert + revoke, guarded by manage_settings.
    expect(librarianAccessMigration).toContain("public.library_access_matrix");
    expect(librarianAccessMigration).toContain("public.library_set_access");
    expect(librarianAccessMigration).toContain("public.library_remove_access");
    expect(librarianAccessMigration).toContain("You do not have permission to manage library access");
    expect(librarianAccessMigration).toContain("ON CONFLICT (branch_id, user_id) DO UPDATE");
    // UI: editable capability matrix, promoted to its own tab.
    expect(libraryPage).toContain("library_access_matrix");
    expect(libraryPage).toContain("library_set_access");
    expect(libraryPage).toContain("library_remove_access");
    expect(libraryPage).toContain("handleUpdateAccess");
    expect(libraryPage).toContain("handleMatrixGrant");
    expect(libraryPage).toContain("handleRemoveAccess");
    expect(libraryPage).toContain('<TabsContent value="access"');
    expect(sidebar).toContain('title: "Access Matrix"');
    // Fetches on the Access Matrix tab (not Settings) and searches server-side.
    expect(libraryPage).toContain('effectiveTab !== "access"');
    expect(libraryPage).toContain("_search: accessSearch.trim()");
    // Settings/Access tabs are manager-gated, not merely permission-gated.
    expect(libraryPage).toContain("isLibraryManager");
    // The CRM badge aggregate must not run for non-CRM roles (it timed out for
    // the librarian under their RLS policies).
    expect(sidebar).toContain("canSeeLeadBadges");
    expect(sidebar).toContain("if (!canSeeLeadBadges) return;");
    expect(accessMatrixSearchMigration).toContain("library_access_matrix(uuid, text, int)");
    expect(accessMatrixSearchMigration).toContain("public.get_user_role(p.user_id) = 'librarian'::public.app_role");
    const accessMatrix = readFileSync("src/components/library/LibraryAccessMatrix.tsx", "utf8");
    expect(accessMatrix).toContain("Library Access Matrix");
    expect(accessMatrix).toContain("ACCESS_CAPABILITY_KEYS");
    // Assignment-derived capabilities surface in the permission layer.
    const permissionContext = readFileSync("src/contexts/PermissionContext.tsx", "utf8");
    expect(permissionContext).toContain("library_staff_assignments");
    expect(permissionContext).toContain('next.add("library:catalog")');
  });

  it("evaluates queue access once per branch, not per record, and locks RPCs to authenticated", () => {
    expect(libraryQueuePerfMigration).toContain("public.library_accessible_branch_ids");
    expect(libraryQueuePerfMigration).toContain("public.library_queue_branch_ids");
    expect(libraryQueuePerfMigration).toContain("d.branch_id = ANY(v_branches)");
    expect(libraryQueuePerfMigration).toContain("d.branch_id = ANY(a.ids)");
    expect(libraryQueuePerfMigration).toContain("d.status::text = ANY(_statuses)");
    // Postgres grants EXECUTE to PUBLIC by default; revoke it so anon can't reach them.
    expect(libraryQueuePerfMigration).toContain("REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC");
    expect(libraryQueuePerfMigration).toContain("REVOKE EXECUTE ON FUNCTION %s FROM anon");
  });

  it("clubs publisher variants through a seeded alias dictionary and a review surface", () => {
    expect(publisherCanonicalMigration).toContain("CREATE TABLE IF NOT EXISTS public.library_publisher_aliases");
    expect(publisherCanonicalMigration).toContain("public.library_canonical_publisher");
    expect(publisherCanonicalMigration).toContain("public.library_apply_publisher_canonicalization");
    expect(publisherCanonicalMigration).toContain("public.library_set_publisher_alias");
    expect(publisherCanonicalMigration).toContain("ON CONFLICT (alias_norm) DO UPDATE");
    // Seeded shorthand handled.
    expect(publisherCanonicalMigration).toContain("Jaypee Brothers Medical Publishers");
    expect(publisherCanonicalMigration).toContain("Eastern Book Company");
    expect(publisherCanonicalMigration).toContain("All India Reporter");
    // upsert now canonicalises before fuzzy matching.
    expect(publisherCanonicalMigration).toContain("v_name := coalesce(public.library_canonical_publisher(_name), trim(_name))");

    expect(libraryPage).toContain("PublisherNormalizer");
    expect(publisherNormalizer).toContain("library_publisher_usage");
    expect(publisherNormalizer).toContain("library_apply_publisher_canonicalization");
    expect(publisherNormalizer).toContain("library_set_publisher_alias");

    // Drill-down: which books/accession numbers carry a name, so a librarian can
    // check the shelf before choosing the correct publisher.
    expect(publisherRecordsMigration).toContain("public.library_publisher_records");
    expect(publisherRecordsMigration).toContain("library_canonical_publisher(d.publisher)");
    expect(publisherNormalizer).toContain("library_publisher_records");
    expect(publisherNormalizer).toContain("View books");
    expect(publisherNormalizer).toContain("Print accession list");
  });

  it("scans barcodes from the phone camera on web and mobile", () => {
    // Web scanner with native BarcodeDetector + ZXing fallback.
    expect(barcodeScanner).toContain("BarcodeDetector");
    expect(barcodeScanner).toContain('import("@zxing/browser")');
    expect(barcodeScanner).toContain("facingMode");
    // Wired into circulation + digitization.
    expect(libraryPage).toContain("BarcodeScanner");
    expect(libraryPage).toContain("handleScanDetected");
    expect(libraryPage).toContain('setScanner({ kind: "issue" })');
    expect(libraryPage).toContain('setScanner({ kind: "return" })');
    expect(libraryPage).toContain('setScanner({ kind: "digitize" })');
    expect(libraryPage).toContain("isbnFromScan");
    expect(libraryPage).toContain("Scan ISBN / barcode");
    // QR labels encode NIMT + accession and print as QR, not Code 39.
    expect(libraryPage).toContain("libraryQrPayload");
    expect(libraryPage).toContain("NIMT:ACC:");
    expect(libraryPage).toContain("qrSvgMarkup");
    expect(libraryPage).toContain("QRCodeSVG");
    // Label layout: NIMT logo on top, title clamped to two lines at QR width.
    expect(libraryPage).toContain("NIMT_LOGO_URL");
    expect(libraryPage).toContain("-webkit-line-clamp: 2");
    // Scans decode the QR payload and fill the review record.
    expect(libraryPage).toContain("parseLibraryScan");
    expect(libraryPage).toContain('setScanner({ kind: "review", recordId: record.id })');
    expect(libraryPage).toContain("Scan QR / barcode / ISBN");
    // Mobile decodes the same payload.
    expect(mobileLibrary).toContain("parseScanned");
    expect(mobileLibrary).toContain("NIMT(?::ACC)");
    // Server RPC that resolves operable branches without an explicit assignment.
    expect(myBranchesMigration).toContain("public.library_my_branches");
    expect(myBranchesMigration).toContain("library_accessible_branch_ids");
  });

  it("normalizes external ISBN metadata lookup through one edge function", () => {
    expect(lookupFunction).toContain("www.googleapis.com/books/v1/volumes");
    expect(lookupFunction).toContain("openlibrary.org/isbn");
    expect(lookupFunction).toContain("covers.openlibrary.org");
    // Lookup also accepts a title, so the guard covers both inputs.
    expect(lookupFunction).toContain("A valid ISBN-10/13 or a title is required");
  });
});
