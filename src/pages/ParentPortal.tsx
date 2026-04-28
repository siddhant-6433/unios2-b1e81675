import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { ReceiptDialog, type ReceiptData } from "@/components/receipts/ReceiptDialog";
import {
  IndianRupee, ClipboardCheck, Megaphone, Loader2,
  AlertCircle, CheckCircle, Clock, ChevronRight, Receipt, CreditCard,
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
  batch_name: string;
}

interface FeeItem {
  id: string;
  fee_code_name: string;
  category: string;
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

export default function ParentPortal() {
  const { user, profile } = useAuth();
  const [activeTab, setActiveTab] = useState("fees");
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [fees, setFees] = useState<FeeItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  useEffect(() => {
    fetchStudentData();
  }, [user?.id]);

  const fetchStudentData = async () => {
    setLoading(true);

    // Find student linked to this parent/user
    const { data: studentData } = await supabase
      .from("students")
      .select("id, name, admission_no, pre_admission_no, semester, campus_id, batch_id, campuses:campus_id(name), batches:batch_id(name), courses:course_id(name)")
      .or(`parent_user_id.eq.${user?.id},user_id.eq.${user?.id}`)
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
        batch_name: (studentData as any).batches?.name || "",
      });

      // Fetch fees
      const { data: feeData } = await supabase
        .from("fee_ledger")
        .select("id, total_amount, paid_amount, balance, status, due_date, term, fee_codes:fee_code_id(name, category)")
        .eq("student_id", studentData.id)
        .order("due_date", { ascending: true });

      if (feeData) {
        setFees(feeData.map((f: any) => ({
          id: f.id,
          fee_code_name: f.fee_codes?.name || f.term || "Fee",
          category: f.fee_codes?.category || "other",
          total_amount: Number(f.total_amount),
          paid_amount: Number(f.paid_amount),
          balance: Number(f.balance || 0),
          status: f.status,
          due_date: f.due_date,
        })));
      }

      // Fetch attendance summary
      const { data: attData } = await supabase
        .from("daily_attendance")
        .select("status")
        .eq("student_id", studentData.id);

      if (attData) {
        const total = attData.length;
        const present = attData.filter((a: any) => a.status === "present").length;
        const absent = attData.filter((a: any) => a.status === "absent").length;
        const late = attData.filter((a: any) => a.status === "late").length;
        setAttendance({
          total_days: total,
          present,
          absent,
          late,
          percentage: total > 0 ? Math.round((present / total) * 100) : 0,
        });
      }
    }

    setLoading(false);
  };

  const totalDue = fees.reduce((s, f) => s + f.balance, 0);
  const totalPaid = fees.reduce((s, f) => s + f.paid_amount, 0);

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
          <h2 className="text-lg font-semibold text-gray-900 mb-1">No student linked</h2>
          <p className="text-sm text-gray-500">Contact the institution to link your account to a student profile.</p>
        </div>
      </PortalLayout>
    );
  }

  return (
    <>
      <ReceiptDialog data={receipt} onClose={() => setReceipt(null)} />
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

        {/* Tab nav (desktop) */}
        <div className="hidden sm:flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 mb-6 w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? "bg-primary text-white"
                  : "text-gray-500 hover:text-gray-900"
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
            {/* Fee summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">Amount Due</p>
                <p className="text-2xl font-bold text-gray-900">
                  {totalDue > 0 ? `₹${totalDue.toLocaleString("en-IN")}` : "₹0"}
                </p>
              </div>
              <div className="rounded-xl bg-white border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">Total Paid</p>
                <p className="text-2xl font-bold text-green-600">₹{totalPaid.toLocaleString("en-IN")}</p>
              </div>
            </div>

            {/* Pay Now CTA */}
            {totalDue > 0 && (
              <button className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors">
                <CreditCard className="h-4 w-4" />
                Pay Now — ₹{totalDue.toLocaleString("en-IN")}
              </button>
            )}

            {/* Fee items */}
            <div className="rounded-xl bg-white border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {fees.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No fees assigned</div>
              ) : (
                fees.map((fee) => (
                  <div key={fee.id} className="flex items-center gap-3 p-4">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
                      fee.status === "paid"
                        ? "bg-green-100"
                        : fee.status === "overdue"
                        ? "bg-red-100"
                        : "bg-yellow-100"
                    }`}>
                      {fee.status === "paid" ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : fee.status === "overdue" ? (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      ) : (
                        <Clock className="h-4 w-4 text-yellow-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{fee.fee_code_name}</p>
                      <p className="text-xs text-gray-400">
                        Due {new Date(fee.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <div className="text-right">
                      {fee.status === "paid" ? (
                        <p className="text-sm font-semibold text-green-600">₹{fee.paid_amount.toLocaleString("en-IN")}</p>
                      ) : (
                        <p className="text-sm font-semibold text-gray-900">₹{fee.balance.toLocaleString("en-IN")}</p>
                      )}
                      <p className={`text-[10px] font-medium capitalize ${
                        fee.status === "paid" ? "text-green-600" : fee.status === "overdue" ? "text-red-500" : "text-yellow-600"
                      }`}>
                        {fee.status}
                      </p>
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
                {/* Big percentage */}
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

                {/* Breakdown */}
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

                <p className="text-xs text-gray-400 text-center">
                  {attendance.total_days} total class days recorded
                </p>
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
    </>
  );
}
