import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { getStudentClaimToken } from "@/lib/studentClaim";
import { brandForStudentOwner, type StudentBrand } from "@/lib/studentBranding";
import {
  IndianRupee, ClipboardCheck, Megaphone, Loader2,
  AlertCircle, CheckCircle, Clock, CreditCard,
} from "lucide-react";

const tabs = [
  { id: "fees", label: "Fees", icon: IndianRupee },
  { id: "attendance", label: "Attendance", icon: ClipboardCheck },
  { id: "notices", label: "Notices", icon: Megaphone },
];

interface StudentInfo {
  id: string;
  name: string;
  admission_no: string;
  course_id: string | null;
  campus_id: string | null;
  course_name: string;
  campus_name: string;
  semester: string;
  parent_phone: string;
  brand: StudentBrand;
}

interface FeeItem {
  id: string;
  fee_code_name: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  status: string;
  due_date: string;
}

interface AttendanceSummary {
  total_days: number;
  present: number;
  absent: number;
  late: number;
  percentage: number;
}

export default function StudentPortal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const claimToken = getStudentClaimToken(searchParams);
  const [activeTab, setActiveTab] = useState("fees");
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [fees, setFees] = useState<FeeItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimError, setClaimError] = useState<string | null>(null);

  const studentLayoutProps = student
    ? {
        institutionName: student.brand.name,
        institutionLogo: student.brand.logo,
        institutionLogoAlt: student.brand.logoAlt,
      }
    : {};

  useEffect(() => {
    if (!claimToken) return;

    let cancelled = false;
    const redeemClaim = async () => {
      setLoading(true);
      setClaimError(null);

      const { data, error } = await supabase.functions.invoke("student-portal-claim", {
        body: { token: claimToken },
      });

      if (cancelled) return;

      const session = data?.session;
      if (error || data?.error || !session?.access_token || !session?.refresh_token) {
        setClaimError(data?.error || error?.message || "Could not claim student portal access.");
        setLoading(false);
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });

      if (cancelled) return;

      if (sessionError) {
        setClaimError(sessionError.message);
        setLoading(false);
        return;
      }

      navigate("/student", { replace: true });
    };

    redeemClaim();
    return () => { cancelled = true; };
  }, [claimToken, navigate]);

  useEffect(() => {
    if (claimToken) return;
    if (!user?.id) {
      setLoading(true);
      return;
    }
    fetchStudentData();
  }, [claimToken, user?.id]);

  const fetchStudentData = async () => {
    setLoading(true);

    const { data: studentData } = await (supabase as any)
      .from("students")
      .select("id, name, admission_no, pre_admission_no, phone, father_phone, mother_phone, guardian_phone, campus_id, course_id, campuses:campus_id(name), courses:course_id(name, code, departments(institutions(name, type)))")
      .eq("user_id", user?.id)
      .limit(1)
      .single();

    if (studentData) {
      const course = (studentData as any).courses;
      const institution = course?.departments?.institutions;
      setStudent({
        id: studentData.id,
        name: studentData.name,
        admission_no: studentData.admission_no || studentData.pre_admission_no || "",
        course_id: studentData.course_id || null,
        campus_id: studentData.campus_id || null,
        course_name: course?.name || "",
        campus_name: (studentData as any).campuses?.name || "",
        semester: "",
        parent_phone: studentData.father_phone || studentData.mother_phone || studentData.guardian_phone || studentData.phone || "",
        brand: brandForStudentOwner({
          campusName: (studentData as any).campuses?.name,
          courseName: course?.name,
          courseCode: course?.code,
          institutionName: institution?.name,
          institutionType: institution?.type,
        }),
      });

      const [feeRes, attRes] = await Promise.all([
        supabase.from("fee_ledger")
          .select("id, total_amount, paid_amount, balance, status, due_date, term, fee_codes:fee_code_id(name, category)")
          .eq("student_id", studentData.id)
          .order("due_date", { ascending: true }),
        supabase.from("daily_attendance")
          .select("status")
          .eq("student_id", studentData.id),
      ]);

      if (feeRes.data) {
        setFees(feeRes.data.map((f: any) => ({
          id: f.id,
          fee_code_name: f.fee_codes?.name || f.term || "Fee",
          total_amount: Number(f.total_amount),
          paid_amount: Number(f.paid_amount),
          balance: Number(f.balance || 0),
          status: f.status,
          due_date: f.due_date,
        })));
      }

      if (attRes.data) {
        const total = attRes.data.length;
        const present = attRes.data.filter((a: any) => a.status === "present").length;
        const absent = attRes.data.filter((a: any) => a.status === "absent").length;
        const late = attRes.data.filter((a: any) => a.status === "late").length;
        setAttendance({
          total_days: total, present, absent, late,
          percentage: total > 0 ? Math.round((present / total) * 100) : 0,
        });
      }
    } else {
      sessionStorage.removeItem("unios_impersonation");
      await supabase.auth.signOut();
      navigate("/login?student=1", { replace: true });
      return;
    }

    setLoading(false);
  };

  const openPayment = (scope: "due" | "all" | "fee", feeId?: string) => {
    if (!student) return;
    const todayKey = new Date().toLocaleDateString("en-CA");
    const selectedFees = fees
      .filter((fee) => fee.balance > 0)
      .filter((fee) => {
        if (scope === "all") return true;
        if (scope === "fee") return fee.id === feeId;
        return fee.due_date <= todayKey;
      })
      .map((fee) => ({
        id: fee.id,
        fee_head: fee.fee_code_name,
        amount: fee.total_amount,
        balance: fee.balance,
        status: fee.status,
        due_date: fee.due_date,
      }));

    navigate(`/pay?student=${student.id}&scope=${scope}${feeId ? `&fee=${feeId}` : ""}&token=student_portal`, {
      state: {
        fromStudentPortal: true,
        student,
        fees: selectedFees,
      },
    });
  };

  const todayKey = new Date().toLocaleDateString("en-CA");
  const isOutstanding = (fee: FeeItem) => fee.balance > 0 && fee.status !== "paid";
  const isDueNow = (fee: FeeItem) => isOutstanding(fee) && fee.due_date <= todayKey;
  const isFutureDue = (fee: FeeItem) => isOutstanding(fee) && fee.due_date > todayKey;
  const dueNowFees = fees.filter(isDueNow);
  const futureFees = fees.filter(isFutureDue);
  const totalDueNow = dueNowFees.reduce((s, f) => s + f.balance, 0);
  const totalOutstanding = fees.filter(isOutstanding).reduce((s, f) => s + f.balance, 0);
  const payAllWaiver = Math.round(totalOutstanding * 0.05);
  const payAllAmount = Math.max(totalOutstanding - payAllWaiver, 0);

  if (loading) {
    return (
      <PortalLayout {...studentLayoutProps}>
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            {claimToken && <p className="text-sm text-gray-500">Claiming your student portal access...</p>}
          </div>
        </div>
      </PortalLayout>
    );
  }

  if (claimError) {
    return (
      <PortalLayout {...studentLayoutProps}>
        <div className="rounded-2xl bg-white border border-gray-200 p-12 text-center">
          <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Claim link could not be used</h2>
          <p className="text-sm text-gray-500 mb-5">{claimError}</p>
          <button
            onClick={() => navigate("/login")}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Go to Login
          </button>
        </div>
      </PortalLayout>
    );
  }

  if (!student) {
    return (
      <PortalLayout {...studentLayoutProps}>
        <div className="rounded-2xl bg-white border border-gray-200 p-12 text-center">
          <AlertCircle className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Profile not found</h2>
          <p className="text-sm text-gray-500">Contact the institution to link your account.</p>
          <button
            onClick={async () => {
              sessionStorage.removeItem("unios_impersonation");
              await supabase.auth.signOut();
              navigate("/login?student=1", { replace: true });
            }}
            className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Sign in as student
          </button>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} {...studentLayoutProps}>
      {/* Student Info Card */}
      <div className="rounded-2xl bg-white border border-gray-200 p-5 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
            {student.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">{student.name}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mt-0.5">
              {student.course_name && <span>{student.course_name}</span>}
              <span className="font-mono">{student.admission_no}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop tabs */}
      <div className="hidden sm:flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 mb-6 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t.id ? "bg-primary text-white" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Fees Tab */}
      {activeTab === "fees" && (
        <div className="space-y-4">
          {totalDueNow > 0 && (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-primary/70">Amount Due Till Today</p>
                <p className="text-xl font-bold text-primary">₹{totalDueNow.toLocaleString("en-IN")}</p>
              </div>
              <button
                onClick={() => openPayment("due")}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                <CreditCard className="h-4 w-4" /> Pay Now
              </button>
            </div>
          )}

          {futureFees.length > 0 && totalOutstanding > totalDueNow && (
            <div className="rounded-xl bg-white border border-gray-200 p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-gray-500">Annual Pay All</p>
                <p className="text-sm font-semibold text-gray-900">
                  ₹{payAllAmount.toLocaleString("en-IN")}
                  <span className="ml-2 text-xs font-medium text-green-600">
                    5% waiver saves ₹{payAllWaiver.toLocaleString("en-IN")}
                  </span>
                </p>
              </div>
              <button
                onClick={() => openPayment("all")}
                className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                <CreditCard className="h-4 w-4" /> Pay All
              </button>
            </div>
          )}

          <div className="rounded-xl bg-white border border-gray-200 overflow-hidden divide-y divide-gray-100">
            {fees.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No fees due right now</div>
            ) : (
              fees.map((fee) => {
                const futureDue = isFutureDue(fee);
                const paid = fee.status === "paid";
                const overdue = fee.status === "overdue" && !futureDue;
                return (
                <div key={fee.id} className="flex items-center gap-3 p-4">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
                    paid ? "bg-green-100" : overdue ? "bg-red-100" : futureDue ? "bg-blue-100" : "bg-yellow-100"
                  }`}>
                    {paid ? <CheckCircle className="h-4 w-4 text-green-600" /> :
                     overdue ? <AlertCircle className="h-4 w-4 text-red-600" /> :
                     <Clock className={`h-4 w-4 ${futureDue ? "text-blue-600" : "text-yellow-600"}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{fee.fee_code_name}</p>
                    <p className="text-xs text-gray-400">
                      {futureDue ? "Upcoming" : "Due"} {new Date(fee.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${paid ? "text-green-600" : "text-gray-900"}`}>
                      ₹{(paid ? fee.paid_amount : fee.balance).toLocaleString("en-IN")}
                    </p>
                    <p className={`text-[10px] font-medium capitalize ${
                      paid ? "text-green-600" : overdue ? "text-red-500" : futureDue ? "text-blue-600" : "text-yellow-600"
                    }`}>{futureDue ? "upcoming" : fee.status}</p>
                    {futureDue && (
                      <button
                        onClick={() => openPayment("fee", fee.id)}
                        className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-primary/40 hover:text-primary"
                      >
                        Pay
                      </button>
                    )}
                  </div>
                </div>
              )})
            )}
          </div>
        </div>
      )}

      {/* Attendance Tab */}
      {activeTab === "attendance" && (
        <div className="space-y-4">
          {attendance ? (
            <>
              <div className="rounded-2xl bg-white border border-gray-200 p-6 text-center">
                <div className="relative inline-flex items-center justify-center">
                  <svg className="h-32 w-32" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#f3f4f6" strokeWidth="10" />
                    <circle
                      cx="60" cy="60" r="50" fill="none"
                      stroke={attendance.percentage >= 75 ? "#16a34a" : attendance.percentage >= 50 ? "#f59e0b" : "#ef4444"}
                      strokeWidth="10"
                      strokeDasharray={`${(attendance.percentage / 100) * 314} 314`}
                      strokeLinecap="round"
                      transform="rotate(-90 60 60)"
                    />
                  </svg>
                  <span className="absolute text-3xl font-bold text-gray-900">{attendance.percentage}%</span>
                </div>
                <p className="text-sm text-gray-500 mt-3">Overall Attendance</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Present", value: attendance.present, color: "text-green-600", bg: "bg-green-50" },
                  { label: "Absent", value: attendance.absent, color: "text-red-600", bg: "bg-red-50" },
                  { label: "Late", value: attendance.late, color: "text-yellow-600", bg: "bg-yellow-50" },
                ].map((stat) => (
                  <div key={stat.label} className={`rounded-xl ${stat.bg} p-4 text-center`}>
                    <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl bg-white border border-gray-200 p-8 text-center text-sm text-gray-400">
              No attendance records available
            </div>
          )}
        </div>
      )}

      {/* Notices Tab */}
      {activeTab === "notices" && (
        <div className="rounded-xl bg-white border border-gray-200 p-8 text-center">
          <Megaphone className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No notices at this time</p>
        </div>
      )}
    </PortalLayout>
  );
}
