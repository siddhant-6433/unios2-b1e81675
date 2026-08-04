import { useState, useEffect, useMemo, Fragment } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { StudentAvatar } from "@/components/ui/student-avatar";
import {
  defaultFeeTermLabel, ONE_TIME_TERMS, ONE_TIME_GROUP, oneTimeRank,
} from "@/lib/feeTermLabels";
import { getStudentClaimToken } from "@/lib/studentClaim";
import { brandForStudentOwner, type StudentBrand } from "@/lib/studentBranding";
import {
  IndianRupee, ClipboardCheck, Megaphone, Loader2,
  AlertCircle, CheckCircle, Clock, CreditCard, FileText,
  // Aliased: `Receipt` is the payment-row type in this file.
  Receipt as ReceiptIcon, ChevronDown,
} from "lucide-react";

const tabs = [
  { id: "fees", label: "Fees", icon: IndianRupee },
  { id: "attendance", label: "Attendance", icon: ClipboardCheck },
  { id: "notices", label: "Notices", icon: Megaphone },
];

interface StudentInfo {
  id: string;
  name: string;
  photo_url: string | null;
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
  fee_code: string | null;
  term: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  concession: number;
  status: string;
  due_date: string;
}

interface Receipt {
  receipt_no: string | null;
  amount: number;
  type: string;
  payment_date: string | null;
  receipt_url: string | null;
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
  // Consultant-managed fee hiding: when the fee structure is hidden, the
  // student-role fee_ledger SELECT returns zero rows. This holds the RPC-backed
  // fallback (due total + receipts only — no structure/installments).
  const [hiddenFee, setHiddenFee] = useState<{
    due_total: number;
    receipts: Receipt[];
  } | null>(null);
  // Every confirmed payment on file, for the "what have I already paid" question
  // the ledger alone can't answer.
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [showReceipts, setShowReceipts] = useState(false);
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
      .select("id, name, photo_url, admission_no, pre_admission_no, phone, father_phone, mother_phone, guardian_phone, campus_id, course_id, campuses:campus_id(name), courses:course_id(name, code, departments(institutions(name, type)))")
      .eq("user_id", user?.id)
      .limit(1)
      .single();

    if (studentData) {
      const course = (studentData as any).courses;
      const institution = course?.departments?.institutions;
      setStudent({
        id: studentData.id,
        name: studentData.name,
        photo_url: (studentData as any).photo_url || null,
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
          .select("id, total_amount, paid_amount, balance, concession, status, due_date, term, fee_codes:fee_code_id(code, name, category)")
          .eq("student_id", studentData.id)
          .order("due_date", { ascending: true }),
        supabase.from("daily_attendance")
          .select("status")
          .eq("student_id", studentData.id),
      ]);

      if (feeRes.data) {
        setFees(feeRes.data.map((f: any) => ({
          id: f.id,
          fee_code_name: f.fee_codes?.name || defaultFeeTermLabel(f.term) || "Fee",
          fee_code: f.fee_codes?.code || null,
          term: f.term,
          total_amount: Number(f.total_amount),
          paid_amount: Number(f.paid_amount),
          balance: Number(f.balance || 0),
          concession: Number(f.concession || 0),
          status: f.status,
          due_date: f.due_date,
        })));

        // student_fee_due_summary is SECURITY DEFINER and self-scoped
        // (students.user_id = auth.uid()), so it serves every student — not
        // just the consultant-managed ones. Call it always: receipts live in
        // lead_payments, which a student login cannot read directly, and this
        // is the only path that hands them over.
        const { data: summary } = await supabase.rpc("student_fee_due_summary" as any, { _student_id: studentData.id });
        const dueTotal = Number((summary as any)?.due_total || 0);
        const receipts = ((summary as any)?.receipts || []) as Receipt[];
        setReceipts(receipts);

        // Zero visible ledger rows means the fee structure is consultant-
        // managed and hidden for this student — fall back to due + receipts
        // only, with no structure.
        if (feeRes.data.length === 0 && (dueTotal > 0 || receipts.length > 0)) {
          setHiddenFee({ due_total: dueTotal, receipts });
        } else if (feeRes.data.length > 0) {
          setHiddenFee(null);
        }
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

  // `ids` pays an explicit set of ledger rows — one custom head, or a whole
  // quarter. The gateways resolve the amount from the ids server-side
  // (feeSelectionFromBody honours a non-empty fee_ids over the scope), so the
  // client never names a price.
  const openPayment = (scope: "due" | "all" | "fee" | "set", feeId?: string, ids?: string[]) => {
    if (!student) return;
    const todayKey = new Date().toLocaleDateString("en-CA");
    const idSet = new Set(ids || []);
    const selectedFees = fees
      .filter((fee) => fee.balance > 0)
      .filter((fee) => {
        if (scope === "all") return true;
        if (scope === "set") return idSet.has(fee.id);
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

  // Same grouping the counter sees, so a parent reading this page and a cashier
  // reading the staff ledger are looking at the same shape: the one-time joining
  // charges collapsed into one section (application fee → admission → deposit),
  // then each collection term in due-date order. A flat due-date sort put the
  // security deposit above the application fee and scattered a quarter's heads.
  const feeGroups = useMemo(() => {
    const oneTime = fees
      .filter((f) => ONE_TIME_TERMS.includes(String(f.term || "").toLowerCase()))
      .sort((a, b) => oneTimeRank(a.fee_code, a.fee_code_name) - oneTimeRank(b.fee_code, b.fee_code_name));

    const groups: { term: string; rows: FeeItem[] }[] = [];
    if (oneTime.length) groups.push({ term: ONE_TIME_GROUP, rows: oneTime });

    for (const f of fees) {
      if (ONE_TIME_TERMS.includes(String(f.term || "").toLowerCase())) continue;
      const last = groups[groups.length - 1];
      if (last && last.term === f.term) last.rows.push(f);
      else groups.push({ term: f.term, rows: [f] });
    }
    return groups;
  }, [fees]);

  const receiptsTotal = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);

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
          <AlertCircle className="h-10 w-10 text-destructive/80 mx-auto mb-3" />
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
          <StudentAvatar
            src={student.photo_url}
            name={student.name}
            className="h-12 w-12 rounded-full text-sm"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900 truncate">{student.name}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mt-0.5">
              {student.course_name && <span>{student.course_name}</span>}
              <span className="font-mono">{student.admission_no}</span>
            </div>
          </div>
          {!claimToken && (
            <button
              onClick={() => navigate("/my-applications")}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
              title="Open your application dashboard"
            >
              <FileText className="h-4 w-4" /> Application
            </button>
          )}
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

      {/* Fees Tab — hidden-fee mode (consultant-managed): due + Pay + receipts only */}
      {activeTab === "fees" && fees.length === 0 && hiddenFee && (
        <div className="space-y-4">
          {hiddenFee.due_total > 0 ? (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-primary/70">Amount Due</p>
                <p className="text-xl font-bold text-primary">₹{hiddenFee.due_total.toLocaleString("en-IN")}</p>
              </div>
              <button
                onClick={() => openPayment("due")}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                <CreditCard className="h-4 w-4" /> Pay Now
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-white border border-gray-200 p-8 text-center text-sm text-gray-400">
              No fees due right now
            </div>
          )}

          {hiddenFee.receipts.length > 0 && (
            <div className="rounded-xl bg-white border border-gray-200 overflow-hidden divide-y divide-gray-100">
              <div className="p-4 pb-2">
                <p className="text-sm font-semibold text-gray-900">Receipts</p>
              </div>
              {hiddenFee.receipts.map((r, i) => (
                <div key={r.receipt_no || i} className="flex items-center gap-3 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10 shrink-0">
                    <CheckCircle className="h-4 w-4 text-success" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">Receipt {r.receipt_no || "—"}</p>
                    <p className="text-xs text-gray-400">
                      {r.payment_date ? new Date(r.payment_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-success">₹{Number(r.amount).toLocaleString("en-IN")}</p>
                    {r.receipt_url && (
                      <a href={r.receipt_url} target="_blank" rel="noopener" className="text-[11px] font-medium text-primary hover:underline">PDF</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fees Tab */}
      {activeTab === "fees" && !(fees.length === 0 && hiddenFee) && (
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
                  <span className="ml-2 text-xs font-medium text-success">
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
              feeGroups.map((g) => {
                // Same predicate the Pay button selects on, so the amount on the
                // button is always exactly what it charges.
                const gPayable = g.rows.filter((r) => r.balance > 0);
                const gOutstanding = gPayable.reduce((s, r) => s + r.balance, 0);
                const gWaived = g.rows.reduce((s, r) => s + r.concession, 0);
                return (
                <Fragment key={g.term}>
                  <div className="flex items-center gap-2 bg-gray-50 px-4 py-2">
                    <span className="text-xs font-semibold text-gray-700">
                      {g.term === ONE_TIME_GROUP ? "One-time Fees" : defaultFeeTermLabel(g.term)}
                    </span>
                    {gWaived > 0 && (
                      <span className="text-[10px] font-medium text-success">
                        ₹{gWaived.toLocaleString("en-IN")} waived
                      </span>
                    )}
                    <span className="ml-auto text-[11px] font-semibold text-gray-500">
                      {gOutstanding > 0 ? `₹${gOutstanding.toLocaleString("en-IN")} due` : "Cleared"}
                    </span>
                    {/* Settle the whole quarter at once, including the ones not
                        due yet — otherwise paying a term ahead means tapping
                        every head in it one at a time. */}
                    {gOutstanding > 0 && (
                      <button
                        onClick={() => openPayment("set", undefined, gPayable.map((r) => r.id))}
                        className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-primary/90"
                      >
                        Pay ₹{gOutstanding.toLocaleString("en-IN")}
                      </button>
                    )}
                  </div>
                  {g.rows.map((fee) => {
                const futureDue = isFutureDue(fee);
                const paid = fee.status === "paid";
                const overdue = fee.status === "overdue" && !futureDue;
                return (
                <div key={fee.id} className="flex items-center gap-3 p-4">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
                    paid ? "bg-success/10" : overdue ? "bg-destructive/10" : futureDue ? "bg-info/10" : "bg-yellow-100"
                  }`}>
                    {paid ? <CheckCircle className="h-4 w-4 text-success" /> :
                     overdue ? <AlertCircle className="h-4 w-4 text-destructive" /> :
                     <Clock className={`h-4 w-4 ${futureDue ? "text-info-foreground" : "text-yellow-600"}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{fee.fee_code_name}</p>
                    <p className="text-xs text-gray-400">
                      {futureDue ? "Upcoming" : "Due"} {new Date(fee.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
                    {/* What the family was actually let off on this head. Without
                        it a waived row just looks like a smaller bill. */}
                    {fee.concession > 0 && (
                      <p className="text-[11px] font-medium text-success">
                        ₹{fee.concession.toLocaleString("en-IN")} waiver applied
                        <span className="text-gray-400">
                          {" "}· ₹{fee.total_amount.toLocaleString("en-IN")} before waiver
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${paid ? "text-success" : "text-gray-900"}`}>
                      ₹{(paid ? fee.paid_amount : fee.balance).toLocaleString("en-IN")}
                    </p>
                    <p className={`text-[10px] font-medium capitalize ${
                      paid ? "text-success" : overdue ? "text-destructive" : futureDue ? "text-info-foreground" : "text-yellow-600"
                    }`}>{futureDue ? "upcoming" : fee.status}</p>
                    {/* Every outstanding head is individually payable. This used
                        to be upcoming-only, which left a one-off charge like a
                        meal add-on with no way to settle it on its own — the
                        only options were the whole due total or the whole year. */}
                    {!paid && fee.balance > 0 && (
                      <button
                        onClick={() => openPayment("fee", fee.id)}
                        className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-primary/40 hover:text-primary"
                      >
                        Pay
                      </button>
                    )}
                  </div>
                </div>
              )})}
                </Fragment>
              )})
            )}
          </div>

          {/* Paid receipts. Collapsed by default — the ledger answers "what do I
              owe", this answers "what have I already paid", and only one of
              those is urgent on open. */}
          {receipts.length > 0 && (
            <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
              <button
                onClick={() => setShowReceipts((v) => !v)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-gray-50"
              >
                <ReceiptIcon className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-900">Paid Fee Receipts</span>
                <span className="text-xs text-gray-400">
                  {receipts.length} · ₹{receiptsTotal.toLocaleString("en-IN")} paid
                </span>
                <ChevronDown className={`ml-auto h-4 w-4 text-gray-400 transition-transform ${showReceipts ? "rotate-180" : ""}`} />
              </button>
              {showReceipts && (
                <div className="divide-y divide-gray-100 border-t border-gray-100">
                  {receipts.map((r, i) => (
                    <div key={r.receipt_no || i} className="flex items-center gap-3 p-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
                        <CheckCircle className="h-4 w-4 text-success" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          Receipt {r.receipt_no || "—"}
                        </p>
                        <p className="text-xs text-gray-400">
                          {r.payment_date
                            ? new Date(r.payment_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                            : "—"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-gray-900">
                          ₹{Number(r.amount).toLocaleString("en-IN")}
                        </p>
                        {r.receipt_url ? (
                          <a
                            href={r.receipt_url}
                            target="_blank"
                            rel="noopener"
                            className="text-[11px] font-medium text-primary hover:underline"
                          >
                            Download PDF
                          </a>
                        ) : (
                          <span className="text-[10px] text-gray-400">PDF generating…</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
                  { label: "Present", value: attendance.present, color: "text-success", bg: "bg-success/5" },
                  { label: "Absent", value: attendance.absent, color: "text-destructive", bg: "bg-destructive/5" },
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
