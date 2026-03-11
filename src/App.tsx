// GitHub sync confirmed - test commit March 8, 2026 v2
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Admissions from "./pages/Admissions";
import LeadDetail from "./pages/LeadDetail";
import LeadAllocation from "./pages/LeadAllocation";
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
import EnquiryForm from "./pages/EnquiryForm";
import NotFound from "./pages/NotFound";

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
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/admissions" element={<Admissions />} />
                      <Route path="/admissions/:id" element={<LeadDetail />} />
                      <Route path="/lead-allocation" element={<LeadAllocation />} />
                      <Route path="/search" element={<GlobalSearch />} />
                      <Route path="/students" element={<Students />} />
                      <Route path="/students/:admissionNo" element={<StudentProfile />} />
                      <Route path="/attendance" element={<Attendance />} />
                      <Route path="/finance" element={<Finance />} />
                      <Route path="/admin" element={<AdminPanel />} />
                      <Route path="/consultants" element={<Consultants />} />
                      <Route path="/admission-analytics" element={<AdmissionAnalytics />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AppLayout>
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
