import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PortalLayout } from "@/components/layout/PortalLayout";
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
  course_name: string;
  semester: string;
  campus_name: string;
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
  const [activeTab, setActiveTab] = useState("fees");
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [fees, setFees] = useState<FeeItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStudentData();
  }, [user?.id]);

  const fetchStudentData = async () => {
    setLoading(true);

    const { data: studentData } = await supabase
      .from("students")
      .select("id, name, admission_no, pre_admission_no, semester, campus_id, campuses:campus_id(name), courses:course_id(name)")
      .eq("user_id", user?.id)
      .limit(1)
      .single();

    if (studentData) {
      setStudent({
        id: studentData.id,
        name: studentData.name,
        admission_no: studentData.admission_no || studentData.pre_admission_no || "",
        course_name: (studentData as any).courses?.name || "",
        semester: studentData.semester || "",
        campus_name: (studentData as any).campuses?.name || "",
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
    }

    setLoading(false);
  };

  const totalDue = fees.reduce((s, f) => s + f.balance, 0);

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </PortalLayout>
    );
  }

  if (!student) {
    return (
      <PortalLayout>
        <div className="rounded-2xl bg-white border border-gray-200 p-12 text-center">
          <AlertCircle className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Profile not found</h2>
          <p className="text-sm text-gray-500">Contact the institution to link your account.</p>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
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
              {student.semester && <span>Sem {student.semester}</span>}
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
          {totalDue > 0 && (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-primary/70">Amount Due</p>
                <p className="text-xl font-bold text-primary">₹{totalDue.toLocaleString("en-IN")}</p>
              </div>
              <button className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors">
                <CreditCard className="h-4 w-4" /> Pay Now
              </button>
            </div>
          )}

          <div className="rounded-xl bg-white border border-gray-200 overflow-hidden divide-y divide-gray-100">
            {fees.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No fees due right now</div>
            ) : (
              fees.map((fee) => (
                <div key={fee.id} className="flex items-center gap-3 p-4">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
                    fee.status === "paid" ? "bg-green-100" : fee.status === "overdue" ? "bg-red-100" : "bg-yellow-100"
                  }`}>
                    {fee.status === "paid" ? <CheckCircle className="h-4 w-4 text-green-600" /> :
                     fee.status === "overdue" ? <AlertCircle className="h-4 w-4 text-red-600" /> :
                     <Clock className="h-4 w-4 text-yellow-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{fee.fee_code_name}</p>
                    <p className="text-xs text-gray-400">
                      Due {new Date(fee.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${fee.status === "paid" ? "text-green-600" : "text-gray-900"}`}>
                      ₹{(fee.status === "paid" ? fee.paid_amount : fee.balance).toLocaleString("en-IN")}
                    </p>
                    <p className={`text-[10px] font-medium capitalize ${
                      fee.status === "paid" ? "text-green-600" : fee.status === "overdue" ? "text-red-500" : "text-yellow-600"
                    }`}>{fee.status}</p>
                  </div>
                </div>
              ))
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
