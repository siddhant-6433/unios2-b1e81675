// GitHub sync confirmed - test commit March 8, 2026 v2
import { Component, ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CampusProvider } from "@/contexts/CampusContext";
import { PermissionProvider } from "@/contexts/PermissionContext";
import {
  ProtectedRoute,
  StaffRoute,
  StudentRoute,
  ParentRoute,
  ApplicantRoute,
  RequirePermission,
  RequireRole,
} from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Admissions from "./pages/Admissions";
import LeadDetail from "./pages/LeadDetail";
import LeadAllocation from "./pages/LeadAllocation";
import LeadBuckets from "./pages/LeadBuckets";
import CallLog from "./pages/CallLog";
import AiCallLog from "./pages/AiCallLog";
import CloudDialer from "./pages/CloudDialer";
import MissedCalls from "./pages/MissedCalls";
import Applications from "./pages/Applications";
import AdminApplicationView from "./pages/AdminApplicationView";
import PendingFollowups from "./pages/PendingFollowups";
import FreshLeads from "./pages/FreshLeads";
import VisitMonitor from "./pages/VisitMonitor";
import StudentReferrals from "./pages/StudentReferrals";
import GlobalSearch from "./pages/GlobalSearch";
import Students from "./pages/Students";
import StudentProfile from "./pages/StudentProfile";
import Attendance from "./pages/Attendance";
import Finance from "./pages/Finance";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import AdminPanel from "./pages/AdminPanel";
import ApplyPortal from "./pages/ApplyPortal";
import Consultants from "./pages/Consultants";
import AdmissionAnalytics from "./pages/AdmissionAnalytics";
import CounsellorDashboard from "./pages/CounsellorDashboard";
import WhatsAppInbox from "./pages/WhatsAppInbox";
import WhatsAppHealth from "./pages/WhatsAppHealth";
import AutomationRules from "./pages/AutomationRules";
import ConsultantPortal from "./pages/ConsultantPortal";
import PublisherPortal from "./pages/PublisherPortal";
import PublisherLogin from "./pages/PublisherLogin";
import PublisherAnalytics from "./pages/PublisherAnalytics";
import ConsultantGuide from "./pages/ConsultantGuide";
import TemplateManager from "./pages/TemplateManager";
import FeeStructures from "./pages/FeeStructures";
import EnquiryForm from "./pages/EnquiryForm";
import Exams from "./pages/Exams";
import Reports from "./pages/Reports";
import Documents from "./pages/Documents";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import Forbidden from "./pages/Forbidden";
import ApplicantPortal from "./pages/ApplicantPortal";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import AlumniVerification from "./pages/AlumniVerification";
import AlumniVerifications from "./pages/AlumniVerifications";
import Inbox from "./pages/Inbox";
import HrDashboard from "./pages/HrDashboard";
import HrAttendance from "./pages/HrAttendance";
import HrLeaveManagement from "./pages/HrLeaveManagement";
import HrEmployeeDirectory from "./pages/HrEmployeeDirectory";
import HrJobApplicants from "./pages/HrJobApplicants";
import FeeCollections from "./pages/FeeCollections";
import ParentPortal from "./pages/ParentPortal";
import StudentPortalPage from "./pages/StudentPortal";
import PaymentPortal from "./pages/PaymentPortal";
// IB Academics pages
import ProgrammeOfInquiry from "./pages/ib/ProgrammeOfInquiry";
import UnitPlanner from "./pages/ib/UnitPlanner";
import UnitDetail from "./pages/ib/UnitDetail";
import Gradebook from "./pages/ib/Gradebook";
import AssessmentDetail from "./pages/ib/AssessmentDetail";
import Portfolios from "./pages/ib/Portfolios";
import StudentPortfolio from "./pages/ib/StudentPortfolio";
import ActionService from "./pages/ib/ActionService";
import Exhibition from "./pages/ib/Exhibition";
import ReportCards from "./pages/ib/ReportCards";
import ReportCardView from "./pages/ib/ReportCardView";
import ReportTemplates from "./pages/ib/ReportTemplates";
import MYPProjects from "./pages/ib/MYPProjects";
import ProjectDetail from "./pages/ib/ProjectDetail";
import InterdisciplinaryUnits from "./pages/ib/InterdisciplinaryUnits";

const queryClient = new QueryClient();

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

const App = () => (
  <AppErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/apply" element={<ApplyPortal />} />
            <Route path="/apply/nimt" element={<ApplyPortal />} />
            <Route path="/apply/beacon" element={<ApplyPortal />} />
            <Route path="/apply/mirai" element={<ApplyPortal />} />
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
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/alumni-verification" element={<AlumniVerification />} />
            <Route path="/pay" element={<PaymentPortal />} />
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
              element={
                <StudentRoute>
                  <StudentPortalPage />
                </StudentRoute>
              }
            />
            <Route path="/forbidden" element={<Forbidden />} />
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
                      <Route path="/pending-followups" element={<RequirePermission module="leads" action="view"><PendingFollowups /></RequirePermission>} />
                      <Route path="/fresh-leads" element={<RequirePermission module="leads" action="view"><FreshLeads /></RequirePermission>} />
                      <Route path="/visit-monitor" element={<RequirePermission module="leads" action="view"><VisitMonitor /></RequirePermission>} />
                      <Route path="/call-log" element={<RequirePermission module="call_log" action="view"><CallLog /></RequirePermission>} />
                      <Route path="/ai-call-log" element={<RequirePermission module="call_log" action="view"><AiCallLog /></RequirePermission>} />
                      <Route path="/cloud-dialer" element={<RequirePermission module="call_log" action="view"><CloudDialer /></RequirePermission>} />
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
                      <Route path="/settings" element={<RequirePermission module="user_management" action="view"><Settings /></RequirePermission>} />

                      {/* Comms */}
                      <Route path="/inbox" element={<Inbox />} />
                      <Route path="/whatsapp-inbox" element={<RequirePermission module="whatsapp" action="view"><WhatsAppInbox /></RequirePermission>} />
                      <Route path="/whatsapp-health" element={<RequirePermission module="user_management" action="view"><WhatsAppHealth /></RequirePermission>} />
                      <Route path="/template-manager" element={<RequirePermission module="templates" action="view"><TemplateManager /></RequirePermission>} />

                      {/* Analytics & reporting */}
                      <Route path="/admission-analytics" element={<RequirePermission module="analytics" action="view"><AdmissionAnalytics /></RequirePermission>} />
                      <Route path="/counsellor-dashboard" element={<RequirePermission module="performance" action="view"><CounsellorDashboard /></RequirePermission>} />
                      <Route path="/reports" element={<RequirePermission module="reports" action="view"><Reports /></RequirePermission>} />

                      {/* Portals */}
                      <Route path="/consultants" element={<RequirePermission module="consultants" action="view"><Consultants /></RequirePermission>} />
                      <Route path="/consultant-portal" element={<RequirePermission module="consultant_portal" action="view"><ConsultantPortal /></RequirePermission>} />
                      <Route path="/consultant-guide" element={<RequirePermission module="consultant_portal" action="view"><ConsultantGuide /></RequirePermission>} />
                      <Route path="/publisher-portal" element={<RequirePermission module="publisher_portal" action="view"><PublisherPortal /></RequirePermission>} />
                      <Route path="/publisher-analytics" element={<RequirePermission module="publisher_portal" action="view"><PublisherAnalytics /></RequirePermission>} />

                      {/* Misc */}
                      <Route path="/exams" element={<RequirePermission module="exams" action="view"><Exams /></RequirePermission>} />
                      <Route path="/documents" element={<RequirePermission module="documents" action="view"><Documents /></RequirePermission>} />
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

                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AppLayout>
                  </CampusProvider>
                  </PermissionProvider>
                </StaffRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
