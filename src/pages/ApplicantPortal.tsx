import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  GraduationCap, LogOut, Loader2, ArrowRight, CheckCircle2,
  Clock, FileText, AlertCircle, Plus, RefreshCw, Receipt,
} from "lucide-react";
import { ReceiptDialog, type ReceiptData } from "@/components/receipts/ReceiptDialog";
import { TokenFeePanel } from "@/components/applicant/TokenFeePanel";

interface CourseSelection {
  course_name?: string;
  campus_name?: string;
  program_category?: string;
}

interface Application {
  application_id: string;
  full_name: string;
  status: string;
  payment_status: string;
  fee_amount: number;
  payment_ref: string | null;
  course_selections: CourseSelection[];
  flags: string[];
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  form_pdf_url: string | null;
  fee_receipt_url: string | null;
}

function portalFromFlags(flags: string[]): { slug: string; label: string } {
  const tag = (flags || []).find((f) => f.startsWith("portal:"));
  const slug = tag?.replace("portal:", "") || "nimt";
  const labels: Record<string, string> = {
    nimt:   "NIMT",
    beacon: "Beacon School",
    mirai:  "Mirai School",
  };
  return { slug, label: labels[slug] || slug.toUpperCase() };
}

function StatusBadge({ status, paymentStatus }: { status: string; paymentStatus: string }) {
  if (status === "submitted" || status === "under_review" || status === "accepted") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Submitted
      </span>
    );
  }
  if (paymentStatus === "paid") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Payment Done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
      <Clock className="h-3.5 w-3.5" /> In Progress
    </span>
  );
}

export default function ApplicantPortal() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const fetchApplications = async () => {
    setLoading(true);
    setError(null);

    const phone = profile?.phone || user?.phone || null;
    const email = user?.email || null;

    if (!phone && !email) {
      setError("Could not identify your account. Please contact support.");
      setLoading(false);
      return;
    }

    let query = (supabase as any)
      .from("applications")
      .select("application_id, full_name, status, payment_status, fee_amount, payment_ref, course_selections, flags, created_at, updated_at, submitted_at, form_pdf_url, fee_receipt_url")
      .order("created_at", { ascending: false });

    if (phone && email) {
      query = query.or(`phone.eq.${phone},email.eq.${email}`);
    } else if (phone) {
      query = query.eq("phone", phone);
    } else {
      query = query.eq("email", email);
    }

    const { data, error: qErr } = await query;
    if (qErr) setError(qErr.message);
    else setApplications(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchApplications(); }, [profile?.phone, user?.email]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const handleContinue = (app: Application) => {
    const { slug } = portalFromFlags(app.flags);
    navigate(`/apply/${slug}`);
  };

  const handleNewApplication = () => {
    // Default to /apply — user can choose portal from there
    navigate("/apply");
  };

  const displayName = profile?.display_name || user?.user_metadata?.full_name || "Applicant";
  const inProgress  = applications.filter((a) => a.status === "draft" || a.status === "in_progress");
  const submitted   = applications.filter((a) => a.status !== "draft" && a.status !== "in_progress");

  return (
    <>
    <ReceiptDialog data={receipt} onClose={() => setReceipt(null)} />
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <GraduationCap className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 leading-tight">My Applications</p>
              <p className="text-xs text-gray-500 leading-tight">Admission Portal</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Welcome */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome back, {displayName.split(" ")[0]}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Track your applications and pick up where you left off.
            </p>
          </div>
          <button
            onClick={handleNewApplication}
            className="shrink-0 flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> New Application
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        )}

        {/* ── In-progress applications ── */}
        {!loading && inProgress.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Continue Application
              </h2>
              <button onClick={fetchApplications} className="text-gray-400 hover:text-gray-600">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              {inProgress.map((app) => {
                const portal = portalFromFlags(app.flags);
                const courses = (app.course_selections || []) as CourseSelection[];
                return (
                  <div
                    key={app.application_id}
                    className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">
                            {app.application_id}
                          </span>
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-md font-medium">
                            {portal.label}
                          </span>
                          <StatusBadge status={app.status} paymentStatus={app.payment_status} />
                        </div>

                        {courses.length > 0 ? (
                          <div className="space-y-0.5">
                            {courses.map((c, i) => (
                              <p key={i} className="text-sm font-medium text-gray-900">
                                {c.course_name || "Programme"}
                                {c.campus_name && (
                                  <span className="text-gray-500 font-normal"> · {c.campus_name}</span>
                                )}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No courses selected yet</p>
                        )}

                        <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                          <span>Started {new Date(app.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                          {app.fee_amount > 0 && (
                            <span>
                              Fee: ₹{app.fee_amount.toLocaleString("en-IN")}
                              {app.payment_status === "paid"
                                ? <span className="ml-1 text-green-600 font-medium">✓ Paid</span>
                                : <span className="ml-1 text-yellow-600 font-medium">Pending</span>}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        {app.payment_status === "paid" && app.fee_amount > 0 && (
                          <button
                            onClick={() => setReceipt({
                              type: "application_fee",
                              application_id: app.application_id,
                              applicant_name: app.full_name,
                              amount: app.fee_amount,
                              payment_ref: app.payment_ref,
                              payment_date: app.updated_at,
                            })}
                            className="shrink-0 flex items-center gap-1.5 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
                          >
                            <Receipt className="h-3.5 w-3.5" /> Receipt
                          </button>
                        )}
                        <button
                          onClick={() => handleContinue(app)}
                          className="shrink-0 flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                        >
                          Continue <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Submitted applications ── */}
        {!loading && submitted.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Submitted Applications
            </h2>
            <div className="space-y-3">
              {submitted.map((app) => {
                const portal = portalFromFlags(app.flags);
                const courses = (app.course_selections || []) as CourseSelection[];
                return (
                  <div
                    key={app.application_id}
                    className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">
                            {app.application_id}
                          </span>
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-md font-medium">
                            {portal.label}
                          </span>
                          <StatusBadge status={app.status} paymentStatus={app.payment_status} />
                        </div>

                        {courses.length > 0 ? (
                          <div className="space-y-0.5">
                            {courses.map((c, i) => (
                              <p key={i} className="text-sm font-medium text-gray-900">
                                {c.course_name || "Programme"}
                                {c.campus_name && (
                                  <span className="text-gray-500 font-normal"> · {c.campus_name}</span>
                                )}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No courses selected</p>
                        )}

                        <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                          {app.submitted_at && (
                            <span>Submitted {new Date(app.submitted_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                          )}
                          {app.payment_ref && (
                            <span>Ref: <span className="font-mono">{app.payment_ref}</span></span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {app.form_pdf_url && (
                          <a
                            href={app.form_pdf_url}
                            target="_blank"
                            rel="noopener"
                            className="flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <FileText className="h-3.5 w-3.5" /> Application Form
                          </a>
                        )}
                        {app.payment_status === "paid" && app.fee_amount > 0 && (
                          app.fee_receipt_url ? (
                            <a
                              href={app.fee_receipt_url}
                              target="_blank"
                              rel="noopener"
                              className="flex items-center gap-1.5 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
                            >
                              <Receipt className="h-3.5 w-3.5" /> Fee Receipt
                            </a>
                          ) : (
                            <button
                              onClick={() => setReceipt({
                                type: "application_fee",
                                application_id: app.application_id,
                                applicant_name: app.full_name,
                                amount: app.fee_amount,
                                payment_ref: app.payment_ref,
                                payment_date: app.submitted_at || app.updated_at,
                              })}
                              className="flex items-center gap-1.5 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
                            >
                              <Receipt className="h-3.5 w-3.5" /> Receipt
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    {/* Offer letter + token fee — only renders if an approved offer exists for this app's lead */}
                    <TokenFeePanel
                      applicationId={app.application_id}
                      applicantName={app.full_name}
                      applicantPhone={profile?.phone || user?.phone || null}
                      applicantEmail={user?.email || null}
                      onPayment={fetchApplications}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && applications.length === 0 && (
          <div className="rounded-2xl bg-white border border-gray-200 p-12 text-center shadow-sm">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 mx-auto mb-4">
              <FileText className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No applications yet</h3>
            <p className="text-sm text-gray-500 mb-6">
              Start your admission application to get enrolled.
            </p>
            <button
              onClick={handleNewApplication}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> Start Application
            </button>
          </div>
        )}
      </main>
    </div>
    </>
  );
}
