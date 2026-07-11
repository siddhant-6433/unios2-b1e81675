// GitHub sync confirmed - test commit March 8, 2026 v2
import { Component, ReactNode, Suspense, lazy, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CampusProvider } from "@/contexts/CampusContext";
import { PermissionProvider } from "@/contexts/PermissionContext";
import { getStudentClaimToken } from "@/lib/studentClaim";
import {
  ProtectedRoute,
  StaffRoute,
  StudentRoute,
  ParentRoute,
  ApplicantRoute,
  RequirePermission,
  RequireRole,
  BlockRole,
} from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";

// All pages are code-split so the initial JS bundle stays small. Counsellors
// no longer download HR, IB-academics, parent/student portal, etc. just to
// open the login screen. Each route loads its own chunk on demand.
const Dashboard            = lazy(() => import("./pages/Dashboard"));
const Admissions           = lazy(() => import("./pages/Admissions"));
const LeadDetail           = lazy(() => import("./pages/LeadDetail"));
const LeadAllocation       = lazy(() => import("./pages/LeadAllocation"));
const LeadBuckets          = lazy(() => import("./pages/LeadBuckets"));
const LeadLists            = lazy(() => import("./pages/LeadLists"));
const Marketing            = lazy(() => import("./pages/Marketing"));
const LeadAssignmentHistoryPage = lazy(() => import("./pages/LeadAssignmentHistoryPage"));
const CallLog              = lazy(() => import("./pages/CallLog"));
const AiCallLog            = lazy(() => import("./pages/AiCallLog"));
const CloudDialer          = lazy(() => import("./pages/CloudDialer"));
const CahetSprint          = lazy(() => import("./pages/CahetSprint"));
const UpdeledSprint        = lazy(() => import("./pages/UpdeledSprint"));
const MissedCalls          = lazy(() => import("./pages/MissedCalls"));
const Applications         = lazy(() => import("./pages/Applications"));
const AdminApplicationView = lazy(() => import("./pages/AdminApplicationView"));
const PendingFollowups     = lazy(() => import("./pages/PendingFollowups"));
const FreshLeads           = lazy(() => import("./pages/FreshLeads"));
const VisitMonitor         = lazy(() => import("./pages/VisitMonitor"));
const VisitCenter          = lazy(() => import("./pages/VisitCenter"));
const StudentReferrals     = lazy(() => import("./pages/StudentReferrals"));
const GlobalSearch         = lazy(() => import("./pages/GlobalSearch"));
const Students             = lazy(() => import("./pages/Students"));
const StudentProfile       = lazy(() => import("./pages/StudentProfile"));
const Attendance           = lazy(() => import("./pages/Attendance"));
const Finance              = lazy(() => import("./pages/Finance"));
const Login                = lazy(() => import("./pages/Login"));
const ResetPassword        = lazy(() => import("./pages/ResetPassword"));
const AdminPanel           = lazy(() => import("./pages/AdminPanel"));
const NavyaKnowledge       = lazy(() => import("./pages/admin/NavyaKnowledge"));
const IdCardCenter         = lazy(() => import("./pages/IdCardCenter"));
const ApplyPortal          = lazy(() => import("./pages/ApplyPortal"));
const Consultants          = lazy(() => import("./pages/Consultants"));
const AcademicPartners     = lazy(() => import("./pages/AcademicPartners"));
const AdmissionAnalytics   = lazy(() => import("./pages/AdmissionAnalytics"));
const CounsellorDashboard  = lazy(() => import("./pages/CounsellorDashboard"));
const WhatsAppInbox        = lazy(() => import("./pages/WhatsAppInbox"));
const WhatsAppHealth       = lazy(() => import("./pages/WhatsAppHealth"));
const AutomationRules      = lazy(() => import("./pages/AutomationRules"));
const ConsultantPortal     = lazy(() => import("./pages/ConsultantPortal"));
const AcademicPartnerPortal = lazy(() => import("./pages/AcademicPartnerPortal"));
const PublisherPortal      = lazy(() => import("./pages/PublisherPortal"));
const PublisherLogin       = lazy(() => import("./pages/PublisherLogin"));
const PublisherAnalytics   = lazy(() => import("./pages/PublisherAnalytics"));
const ConsultantGuide      = lazy(() => import("./pages/ConsultantGuide"));
const TemplateManager      = lazy(() => import("./pages/TemplateManager"));
const FeeStructures        = lazy(() => import("./pages/FeeStructures"));
const EnquiryForm          = lazy(() => import("./pages/EnquiryForm"));
const Exams                = lazy(() => import("./pages/Exams"));
const Reports              = lazy(() => import("./pages/Reports"));
const Documents            = lazy(() => import("./pages/Documents"));
const MyDocs               = lazy(() => import("./pages/MyDocs"));
const Settings             = lazy(() => import("./pages/Settings"));
const NotFound             = lazy(() => import("./pages/NotFound"));
const Forbidden            = lazy(() => import("./pages/Forbidden"));
const ApplicantPortal      = lazy(() => import("./pages/ApplicantPortal"));
const About                = lazy(() => import("./pages/About"));
const PrivacyPolicy        = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService       = lazy(() => import("./pages/TermsOfService"));
const AlumniVerification   = lazy(() => import("./pages/AlumniVerification"));
const AlumniVerifications  = lazy(() => import("./pages/AlumniVerifications"));
const Inbox                = lazy(() => import("./pages/Inbox"));
const HrDashboard          = lazy(() => import("./pages/HrDashboard"));
const HrAttendance         = lazy(() => import("./pages/HrAttendance"));
const HrLeaveManagement    = lazy(() => import("./pages/HrLeaveManagement"));
const HrEmployeeDirectory  = lazy(() => import("./pages/HrEmployeeDirectory"));
const HrJobApplicants      = lazy(() => import("./pages/HrJobApplicants"));
const FeeCollections       = lazy(() => import("./pages/FeeCollections"));
const ParentPortal         = lazy(() => import("./pages/ParentPortal"));
const StudentPortalPage    = lazy(() => import("./pages/StudentPortal"));
const PaymentPortal        = lazy(() => import("./pages/PaymentPortal"));
const PayLink              = lazy(() => import("./pages/PayLink"));
const Library              = lazy(() => import("./pages/Library"));
// IB Academics pages
const ProgrammeOfInquiry    = lazy(() => import("./pages/ib/ProgrammeOfInquiry"));
const UnitPlanner           = lazy(() => import("./pages/ib/UnitPlanner"));
const UnitDetail            = lazy(() => import("./pages/ib/UnitDetail"));
const Gradebook             = lazy(() => import("./pages/ib/Gradebook"));
const AssessmentDetail      = lazy(() => import("./pages/ib/AssessmentDetail"));
const Portfolios            = lazy(() => import("./pages/ib/Portfolios"));
const StudentPortfolio      = lazy(() => import("./pages/ib/StudentPortfolio"));
const ActionService         = lazy(() => import("./pages/ib/ActionService"));
const Exhibition            = lazy(() => import("./pages/ib/Exhibition"));
const ReportCards           = lazy(() => import("./pages/ib/ReportCards"));
const ReportCardView        = lazy(() => import("./pages/ib/ReportCardView"));
const ReportTemplates       = lazy(() => import("./pages/ib/ReportTemplates"));
const MYPProjects           = lazy(() => import("./pages/ib/MYPProjects"));
const ProjectDetail         = lazy(() => import("./pages/ib/ProjectDetail"));
const InterdisciplinaryUnits = lazy(() => import("./pages/ib/InterdisciplinaryUnits"));
const VideoEditorPortal      = lazy(() => import("./pages/VideoEditorPortal"));
const VideoApprovals         = lazy(() => import("./pages/VideoApprovals"));
const VideoBills             = lazy(() => import("./pages/VideoBills"));

// Shared cache so navigation between pages reuses recent results.
// TanStack defaults are too aggressive about refetching for a CRM where
// the same lead is opened and closed dozens of times per shift.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30s before a refetch is considered useful
      gcTime: 5 * 60_000,         // keep unused query data around for 5 min
      refetchOnWindowFocus: false, // counsellors switch tabs constantly; don't thrash
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

const GLOBAL_MEASUREMENT_ID = "G-9TPSZXEVZ3";
const APPLY_MEASUREMENT_ID = "G-MKHMKH1DE9";
const APPLY_LINKER_DOMAINS = ["nimt.ac.in", "miraischool.in", "school.nimt.ac.in"];

function isApplyAnalyticsSurface(pathname: string) {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "apply.nimt.ac.in" || (host === "uni.nimt.ac.in" && pathname.startsWith("/apply"));
}

function GoogleRouteTracker() {
  const location = useLocation();
  const didMount = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!didMount.current) {
      didMount.current = true;
      return;
    }

    const gtag = (window as any).gtag;
    if (!gtag) return;

    const pagePath = `${location.pathname}${location.search}${location.hash}`;
    const pageParams = {
      page_path: pagePath,
      page_location: `${window.location.origin}${pagePath}`,
      page_title: document.title,
    };

    gtag("config", GLOBAL_MEASUREMENT_ID, pageParams);

    if (isApplyAnalyticsSurface(location.pathname)) {
      gtag("config", APPLY_MEASUREMENT_ID, {
        ...pageParams,
        linker: { domains: APPLY_LINKER_DOMAINS },
      });
    }
  }, [location.pathname, location.search, location.hash]);

  return null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
          <p className="text-lg font-semibold text-destructive">Something went wrong</p>
          <pre className="text-xs text-muted-foreground bg-muted rounded-lg p-4 max-w-2xl overflow-auto">{this.state.error.message}{"\n"}{this.state.error.stack}</pre>
          <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm" onClick={() => { this.setState({ error: null }); window.location.href = "/"; }}>
            Go to Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function OfferLinkRedirect() {
  const { token } = useParams<{ token: string }>();
  if (!token) return <Navigate to="/apply" replace />;
  return <Navigate to={`/apply?token=${encodeURIComponent(token)}&view=offer`} replace />;
}

function StudentPortalEntry() {
  const [searchParams] = useSearchParams();
  const claimToken = getStudentClaimToken(searchParams);

  if (claimToken) return <StudentPortalPage />;

  return (
    <StudentRoute>
      <StudentPortalPage />
    </StudentRoute>
  );
}

const App = () => (
  <AppErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <GoogleRouteTracker />
        <AuthProvider>
          {/* All routes are React.lazy() — wrap in Suspense so concurrent
              renders can pause for the chunk instead of throwing
              "suspended while responding to synchronous input". */}
          <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-background">
              <div className="flex flex-col items-center gap-4 animate-rs-slide-up">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-primary/50 animate-bounce [animation-delay:0ms]" />
                  <span className="h-3 w-3 rounded-full bg-primary/50 animate-bounce [animation-delay:150ms]" />
                  <span className="h-3 w-3 rounded-full bg-primary/50 animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="text-sm text-muted-foreground">Loading…</span>
              </div>
            </div>
          }>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/apply" element={<ApplyPortal />} />
            <Route path="/apply/nimt" element={<ApplyPortal />} />
            <Route path="/apply/beacon" element={<ApplyPortal />} />
            <Route path="/apply/mirai" element={<ApplyPortal />} />
            <Route path="/applly/nimt" element={<Navigate to="/apply/nimt" replace />} />
            <Route path="/apply.mirai" element={<Navigate to="/apply/mirai" replace />} />
            {/*
              Magic-link entry point used by the offer_letter_acceptance
              WhatsApp template. The button URL is
              https://uni.nimt.ac.in/apply/offer/{token}; this route normalises
              the path-param token into the ?token= query string that the
              apply portal's existing redeem flow already handles, and adds a
              `view=offer` hint so the portal lands on the offer view after
              authentication.
            */}
            <Route path="/apply/offer/:token" element={<OfferLinkRedirect />} />
            <Route path="/enquiry" element={<EnquiryForm />} />
            <Route path="/publisher-login" element={<PublisherLogin />} />
            <Route path="/about" element={<About />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/alumni-verification" element={<AlumniVerification />} />
            <Route path="/pay" element={<PaymentPortal />} />
            <Route path="/pay/:token" element={<PayLink />} />
            <Route
              path="/my-applications"
              element={
                <ApplicantRoute>
                  <ApplicantPortal />
                </ApplicantRoute>
              }
            />
            <Route
              path="/parent"
              element={
                <ParentRoute>
                  <ParentPortal />
                </ParentRoute>
              }
            />
            <Route
              path="/student"
              element={<StudentPortalEntry />}
            />
            <Route path="/forbidden" element={<Forbidden />} />
            {import.meta.env.DEV && (
              <Route path="/dev/whatsapp-inbox" element={<WhatsAppInbox demoMode />} />
            )}
            <Route
              path="/*"
              element={
                <StaffRoute>
                  <PermissionProvider>
                  <CampusProvider>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />

                      {/* Admissions — requires leads:view */}
                      <Route path="/admissions" element={<RequirePermission module="leads" action="view"><Admissions /></RequirePermission>} />
                      <Route path="/admissions/:id" element={<RequirePermission module="leads" action="view"><LeadDetail /></RequirePermission>} />
                      <Route path="/lead-buckets" element={<RequirePermission module="lead_buckets" action="view"><LeadBuckets /></RequirePermission>} />
                      <Route path="/lead-assignments" element={<RequirePermission module="leads" action="view"><LeadAssignmentHistoryPage /></RequirePermission>} />
                      <Route path="/lists" element={<BlockRole roles={["academic_partner", "academic_partner_offer_letter"]}><RequirePermission module="leads" action="view"><LeadLists /></RequirePermission></BlockRole>} />
                      <Route path="/marketing" element={<BlockRole roles={["academic_partner", "academic_partner_offer_letter"]}><RequirePermission module="leads" action="view"><Marketing /></RequirePermission></BlockRole>} />
                      <Route path="/pending-followups" element={<RequirePermission module="leads" action="view"><PendingFollowups /></RequirePermission>} />
                      <Route path="/fresh-leads" element={<RequirePermission module="leads" action="view"><FreshLeads /></RequirePermission>} />
                      <Route path="/visit-monitor" element={<RequirePermission module="leads" action="view"><VisitMonitor /></RequirePermission>} />
                      <Route path="/visit-center" element={<RequirePermission module="leads" action="view"><VisitCenter /></RequirePermission>} />
                      <Route path="/call-log" element={<RequirePermission module="call_log" action="view"><CallLog /></RequirePermission>} />
                      <Route path="/ai-call-log" element={<RequirePermission module="call_log" action="view"><AiCallLog /></RequirePermission>} />
                      <Route path="/cloud-dialer" element={<RequirePermission module="call_log" action="view"><CloudDialer /></RequirePermission>} />
                      <Route path="/cahet-sprint" element={<RequirePermission module="call_log" action="view"><CahetSprint /></RequirePermission>} />
                      <Route path="/updeled-sprint" element={<RequirePermission module="call_log" action="view"><UpdeledSprint /></RequirePermission>} />
                      <Route path="/missed-calls" element={<RequirePermission module="call_log" action="view"><MissedCalls /></RequirePermission>} />
                      <Route path="/referrals" element={<RequirePermission module="referrals" action="view"><StudentReferrals /></RequirePermission>} />

                      {/* Lead allocation & automation — restricted roles */}
                      <Route path="/lead-allocation" element={<RequirePermission module="lead_allocation" action="view"><LeadAllocation /></RequirePermission>} />
                      <Route path="/automation-rules" element={<RequirePermission module="automation" action="view"><AutomationRules /></RequirePermission>} />

                      {/* Applications */}
                      <Route path="/applications" element={<RequirePermission module="students" action="view"><Applications /></RequirePermission>} />
                      <Route path="/applications/:applicationId" element={<RequirePermission module="students" action="view"><AdminApplicationView /></RequirePermission>} />

                      {/* Students */}
                      <Route path="/search" element={<RequirePermission module="search" action="view"><GlobalSearch /></RequirePermission>} />
                      <Route path="/students" element={<RequirePermission module="students" action="view"><Students /></RequirePermission>} />
                      <Route path="/students/:admissionNo" element={<RequirePermission module="students" action="view"><StudentProfile /></RequirePermission>} />
                      <Route path="/attendance" element={<RequirePermission module="attendance" action="view"><Attendance /></RequirePermission>} />

                      {/* Finance — accountant / admin only */}
                      <Route path="/finance" element={<RequirePermission module="finance" action="view"><Finance /></RequirePermission>} />
                      <Route path="/collections" element={<RequirePermission module="finance" action="view"><FeeCollections /></RequirePermission>} />
                      <Route path="/fee-structures" element={<RequirePermission module="courses_fees" action="view"><FeeStructures /></RequirePermission>} />

                      {/* HR — campus_admin / principal / office_admin only */}
                      <Route path="/hr" element={<RequirePermission module="hr" action="view"><HrDashboard /></RequirePermission>} />
                      <Route path="/hr-job-applicants" element={<RequirePermission module="hr" action="view"><HrJobApplicants /></RequirePermission>} />
                      <Route path="/hr-attendance" element={<RequirePermission module="hr" action="view"><HrAttendance /></RequirePermission>} />
                      <Route path="/hr-leave" element={<RequirePermission module="hr" action="view"><HrLeaveManagement /></RequirePermission>} />
                      <Route path="/hr-directory" element={<RequirePermission module="hr" action="view"><HrEmployeeDirectory /></RequirePermission>} />

                      {/* Admin — user_management:view */}
                      <Route path="/admin" element={<RequirePermission module="user_management" action="view"><AdminPanel /></RequirePermission>} />
                      <Route path="/admin/navya-knowledge" element={<RequireRole roles={["super_admin"]}><NavyaKnowledge /></RequireRole>} />
                      <Route path="/id-card-center" element={<IdCardCenter />} />
                      <Route path="/settings" element={<RequirePermission module="user_management" action="view"><Settings /></RequirePermission>} />

                      {/* Comms */}
                      <Route path="/inbox" element={<Inbox />} />
                      <Route path="/whatsapp-inbox" element={<RequirePermission module="whatsapp" action="view"><WhatsAppInbox /></RequirePermission>} />
                      <Route path="/whatsapp-health" element={<RequirePermission module="user_management" action="view"><WhatsAppHealth /></RequirePermission>} />
                      <Route path="/template-manager" element={<BlockRole roles={["academic_partner", "academic_partner_offer_letter"]}><RequirePermission module="templates" action="view"><TemplateManager /></RequirePermission></BlockRole>} />

                      {/* Analytics & reporting */}
                      <Route path="/admission-analytics" element={<RequirePermission module="analytics" action="view"><AdmissionAnalytics /></RequirePermission>} />
                      <Route path="/counsellor-dashboard" element={<RequirePermission module="performance" action="view"><CounsellorDashboard /></RequirePermission>} />
                      <Route path="/reports" element={<RequirePermission module="reports" action="view"><Reports /></RequirePermission>} />

                      {/* Portals */}
                      <Route path="/consultants" element={<RequirePermission module="consultants" action="view"><Consultants /></RequirePermission>} />
                      <Route path="/academic-partners" element={<RequirePermission module="academic_partners" action="view"><AcademicPartners /></RequirePermission>} />
                      <Route path="/consultant-portal" element={<RequirePermission module="consultant_portal" action="view"><ConsultantPortal /></RequirePermission>} />
                      <Route path="/academic-partner-portal" element={<RequirePermission module="academic_partner_portal" action="view"><AcademicPartnerPortal /></RequirePermission>} />
                      <Route path="/consultant-guide" element={<RequirePermission module="consultant_portal" action="view"><ConsultantGuide /></RequirePermission>} />
                      <Route path="/publisher-portal" element={<RequirePermission module="publisher_portal" action="view"><PublisherPortal /></RequirePermission>} />
                      <Route path="/publisher-analytics" element={<RequirePermission module="publisher_portal" action="view"><PublisherAnalytics /></RequirePermission>} />

                      {/* Misc */}
                      <Route path="/exams" element={<RequirePermission module="exams" action="view"><Exams /></RequirePermission>} />
                      <Route path="/documents" element={<RequirePermission module="documents" action="view"><Documents /></RequirePermission>} />
                      <Route path="/library" element={<RequirePermission module="library" action="view"><Library /></RequirePermission>} />
                      {/* Personal Document Tracker — gated server-side via RLS to allow-listed emails */}
                      <Route path="/my-docs" element={<MyDocs />} />
                      <Route path="/alumni-verifications" element={<AlumniVerifications />} />

                      {/* IB Academics — gated per-module */}
                      <Route path="/ib/poi" element={<RequirePermission module="ib_poi" action="view"><ProgrammeOfInquiry /></RequirePermission>} />
                      <Route path="/ib/units" element={<RequirePermission module="ib_units" action="view"><UnitPlanner /></RequirePermission>} />
                      <Route path="/ib/units/:id" element={<RequirePermission module="ib_units" action="view"><UnitDetail /></RequirePermission>} />
                      <Route path="/ib/gradebook" element={<RequirePermission module="ib_gradebook" action="view"><Gradebook /></RequirePermission>} />
                      <Route path="/ib/assessments/:id" element={<RequirePermission module="ib_gradebook" action="view"><AssessmentDetail /></RequirePermission>} />
                      <Route path="/ib/portfolios" element={<RequirePermission module="ib_portfolios" action="view"><Portfolios /></RequirePermission>} />
                      <Route path="/ib/portfolios/:studentId" element={<RequirePermission module="ib_portfolios" action="view"><StudentPortfolio /></RequirePermission>} />
                      <Route path="/ib/action" element={<RequirePermission module="ib_action" action="view"><ActionService /></RequirePermission>} />
                      <Route path="/ib/exhibition" element={<RequirePermission module="ib_exhibition" action="view"><Exhibition /></RequirePermission>} />
                      <Route path="/ib/reports" element={<RequirePermission module="ib_reports" action="view"><ReportCards /></RequirePermission>} />
                      <Route path="/ib/reports/templates" element={<RequirePermission module="ib_reports" action="view"><ReportTemplates /></RequirePermission>} />
                      <Route path="/ib/reports/:studentId/:term" element={<RequirePermission module="ib_reports" action="view"><ReportCardView /></RequirePermission>} />
                      <Route path="/ib/projects" element={<RequirePermission module="ib_projects" action="view"><MYPProjects /></RequirePermission>} />
                      <Route path="/ib/projects/:id" element={<RequirePermission module="ib_projects" action="view"><ProjectDetail /></RequirePermission>} />
                      <Route path="/ib/idu" element={<RequirePermission module="ib_idu" action="view"><InterdisciplinaryUnits /></RequirePermission>} />

                      {/* Video Approval — editor portal + super-admin queue + bills */}
                      <Route path="/video-editor"    element={<RequirePermission module="video_editor"   action="view"><VideoEditorPortal /></RequirePermission>} />
                      <Route path="/video-approvals" element={<RequirePermission module="video_approval" action="view"><VideoApprovals /></RequirePermission>} />
                      <Route path="/video-bills"     element={<RequirePermission module="video_bills"    action="view"><VideoBills /></RequirePermission>} />

                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AppLayout>
                  </CampusProvider>
                  </PermissionProvider>
                </StaffRoute>
              }
            />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
