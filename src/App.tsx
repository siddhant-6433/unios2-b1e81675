// GitHub sync confirmed - test commit March 8, 2026 v2
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

const App = () => (
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
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route
              path="/my-applications"
              element={
                <ApplicantRoute>
                  <ApplicantPortal />
                </ApplicantRoute>
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
                      <Route path="/call-log" element={<CallLog />} />
                      <Route path="/ai-call-log" element={<AiCallLog />} />
                      <Route path="/referrals" element={<StudentReferrals />} />
                      <Route path="/search" element={<GlobalSearch />} />
                      <Route path="/students" element={<Students />} />
                      <Route path="/students/:admissionNo" element={<StudentProfile />} />
                      <Route path="/attendance" element={<Attendance />} />
                      <Route path="/finance" element={<Finance />} />
                      <Route path="/admin" element={<AdminPanel />} />
                      <Route path="/consultants" element={<Consultants />} />
                      <Route path="/admission-analytics" element={<AdmissionAnalytics />} />
                      <Route path="/counsellor-dashboard" element={<CounsellorDashboard />} />
                      <Route path="/whatsapp-inbox" element={<WhatsAppInbox />} />
                      <Route path="/automation-rules" element={<AutomationRules />} />
                      <Route path="/consultant-portal" element={<ConsultantPortal />} />
                      <Route path="/consultant-guide" element={<ConsultantGuide />} />
                      <Route path="/template-manager" element={<TemplateManager />} />
                      <Route path="/fee-structures" element={<FeeStructures />} />
                      <Route path="/exams" element={<Exams />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/documents" element={<Documents />} />
                      <Route path="/settings" element={<Settings />} />
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
);

export default App;
