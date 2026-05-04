// GitHub sync confirmed - test commit March 8, 2026 v2
import { Component, ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CampusProvider } from "@/contexts/CampusContext";
import { PermissionProvider } from "@/contexts/PermissionContext";
import { ProtectedRoute, ApplicantRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Admissions from "./pages/Admissions";
import LeadDetail from "./pages/LeadDetail";
import LeadAllocation from "./pages/LeadAllocation";
import LeadBuckets from "./pages/LeadBuckets";
import CallLog from "./pages/CallLog";
import AiCallLog from "./pages/AiCallLog";
import CloudDialer from "./pages/CloudDialer";
import Applications from "./pages/Applications";
import AdminApplicationView from "./pages/AdminApplicationView";
import PendingFollowups from "./pages/PendingFollowups";
import FreshLeads from "./pages/FreshLeads";
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
import ApplicantPortal from "./pages/ApplicantPortal";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import AlumniVerification from "./pages/AlumniVerification";
import AlumniVerifications from "./pages/AlumniVerifications";
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
                <ProtectedRoute>
                  <ParentPortal />
                </ProtectedRoute>
              }
            />
            <Route
              path="/student"
              element={
                <ProtectedRoute>
                  <StudentPortalPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <PermissionProvider>
                  <CampusProvider>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/admissions" element={<Admissions />} />
                      <Route path="/admissions/:id" element={<LeadDetail />} />
                      <Route path="/lead-allocation" element={<LeadAllocation />} />
                      <Route path="/lead-buckets" element={<LeadBuckets />} />
                      <Route path="/pending-followups" element={<PendingFollowups />} />
                      <Route path="/fresh-leads" element={<FreshLeads />} />
                      <Route path="/call-log" element={<CallLog />} />
                      <Route path="/ai-call-log" element={<AiCallLog />} />
                      <Route path="/cloud-dialer" element={<CloudDialer />} />
                      <Route path="/applications" element={<Applications />} />
                      <Route path="/applications/:applicationId" element={<AdminApplicationView />} />
                      <Route path="/referrals" element={<StudentReferrals />} />
                      <Route path="/search" element={<GlobalSearch />} />
                      <Route path="/students" element={<Students />} />
                      <Route path="/students/:admissionNo" element={<StudentProfile />} />
                      <Route path="/attendance" element={<Attendance />} />
                      <Route path="/finance" element={<Finance />} />
                      <Route path="/collections" element={<FeeCollections />} />
                      <Route path="/hr" element={<HrDashboard />} />
                      <Route path="/hr-job-applicants" element={<HrJobApplicants />} />
                      <Route path="/hr-attendance" element={<HrAttendance />} />
                      <Route path="/hr-leave" element={<HrLeaveManagement />} />
                      <Route path="/hr-directory" element={<HrEmployeeDirectory />} />
                      <Route path="/admin" element={<AdminPanel />} />
                      <Route path="/consultants" element={<Consultants />} />
                      <Route path="/admission-analytics" element={<AdmissionAnalytics />} />
                      <Route path="/counsellor-dashboard" element={<CounsellorDashboard />} />
                      <Route path="/whatsapp-inbox" element={<WhatsAppInbox />} />
                      <Route path="/automation-rules" element={<AutomationRules />} />
                      <Route path="/consultant-portal" element={<ConsultantPortal />} />
                      <Route path="/publisher-portal" element={<PublisherPortal />} />
                      <Route path="/publisher-analytics" element={<PublisherAnalytics />} />
                      <Route path="/consultant-guide" element={<ConsultantGuide />} />
                      <Route path="/template-manager" element={<TemplateManager />} />
                      <Route path="/fee-structures" element={<FeeStructures />} />
                      <Route path="/exams" element={<Exams />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/documents" element={<Documents />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/alumni-verifications" element={<AlumniVerifications />} />
                      {/* IB Academics routes */}
                      <Route path="/ib/poi" element={<ProgrammeOfInquiry />} />
                      <Route path="/ib/units" element={<UnitPlanner />} />
                      <Route path="/ib/units/:id" element={<UnitDetail />} />
                      <Route path="/ib/gradebook" element={<Gradebook />} />
                      <Route path="/ib/assessments/:id" element={<AssessmentDetail />} />
                      <Route path="/ib/portfolios" element={<Portfolios />} />
                      <Route path="/ib/portfolios/:studentId" element={<StudentPortfolio />} />
                      <Route path="/ib/action" element={<ActionService />} />
                      <Route path="/ib/exhibition" element={<Exhibition />} />
                      <Route path="/ib/reports" element={<ReportCards />} />
                      <Route path="/ib/reports/templates" element={<ReportTemplates />} />
                      <Route path="/ib/reports/:studentId/:term" element={<ReportCardView />} />
                      <Route path="/ib/projects" element={<MYPProjects />} />
                      <Route path="/ib/projects/:id" element={<ProjectDetail />} />
                      <Route path="/ib/idu" element={<InterdisciplinaryUnits />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AppLayout>
                  </CampusProvider>
                  </PermissionProvider>
                </ProtectedRoute>
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
