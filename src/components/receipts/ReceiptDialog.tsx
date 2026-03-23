import { useRef, useState } from "react";
import { X, Download, Loader2, Printer } from "lucide-react";

// ── Receipt data shape ────────────────────────────────────────────────────────

export interface ReceiptData {
  type: "application_fee" | "student_fee";
  // Application fee
  application_id?: string;
  applicant_name?: string;
  phone?: string;
  email?: string;
  // Student fee
  receipt_no?: string;
  student_name?: string;
  admission_no?: string;
  payment_mode?: string;
  fee_description?: string;
  recorded_by?: string;
  // Common
  amount: number;
  payment_ref?: string | null;
  payment_date: string;
  institution_name?: string;
  campus_name?: string;
}

// ── Printable receipt content ─────────────────────────────────────────────────

function ReceiptContent({ d }: { d: ReceiptData }) {
  const isApp = d.type === "application_fee";
  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#fff",
        width: "580px",
        padding: "40px",
        boxSizing: "border-box",
        color: "#1a1a2e",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #6366f1", paddingBottom: "20px", marginBottom: "24px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <div style={{ background: "#6366f1", borderRadius: "8px", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: "18px", fontWeight: "bold" }}>N</span>
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "16px" }}>{d.institution_name || "NIMT Education"}</p>
              {d.campus_name && <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>{d.campus_name}</p>}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "#6366f1", textTransform: "uppercase", letterSpacing: "1px" }}>
            {isApp ? "Application Receipt" : "Payment Receipt"}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#94a3b8" }}>
            {isApp ? `Application ID: ${d.application_id}` : `Receipt No: ${d.receipt_no || "—"}`}
          </p>
        </div>
      </div>

      {/* Date */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Date & Time</p>
          <p style={{ margin: "3px 0 0", fontSize: "13px", fontWeight: 600 }}>{fmtDate(d.payment_date)}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Status</p>
          <p style={{ margin: "3px 0 0", fontSize: "13px", fontWeight: 700, color: "#16a34a" }}>✓ PAID</p>
        </div>
      </div>

      {/* Payer details */}
      <div style={{ background: "#f8fafc", borderRadius: "10px", padding: "16px 20px", marginBottom: "20px" }}>
        <p style={{ margin: "0 0 12px", fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {isApp ? "Applicant Details" : "Student Details"}
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {isApp ? (
              <>
                <Row label="Name" value={d.applicant_name} />
                <Row label="Phone" value={d.phone} />
                {d.email && <Row label="Email" value={d.email} />}
                <Row label="Application ID" value={d.application_id} mono />
              </>
            ) : (
              <>
                <Row label="Name" value={d.student_name} />
                {d.admission_no && <Row label="Admission No" value={d.admission_no} mono />}
                {d.fee_description && <Row label="Fee Head" value={d.fee_description} />}
                {d.payment_mode && <Row label="Payment Mode" value={d.payment_mode.replace("_", " ").toUpperCase()} />}
                {d.recorded_by && <Row label="Recorded By" value={d.recorded_by} />}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Amount */}
      <div style={{ background: "#6366f1", borderRadius: "10px", padding: "16px 20px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#c7d2fe", fontSize: "13px", fontWeight: 600 }}>Amount Paid</span>
        <span style={{ color: "#fff", fontSize: "24px", fontWeight: 800 }}>₹{fmt(d.amount)}</span>
      </div>

      {/* Transaction Ref */}
      {d.payment_ref && (
        <div style={{ marginBottom: "20px", padding: "12px 16px", border: "1px solid #e2e8f0", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Transaction Reference</span>
          <span style={{ fontSize: "12px", fontFamily: "monospace", fontWeight: 600, color: "#334155" }}>{d.payment_ref}</span>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, fontSize: "10px", color: "#94a3b8" }}>
          This is a computer-generated receipt and does not require a signature.
        </p>
        <p style={{ margin: 0, fontSize: "10px", color: "#6366f1", fontWeight: 600 }}>unios.nimt.ac.in</p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <tr>
      <td style={{ padding: "3px 0", fontSize: "12px", color: "#64748b", width: "140px", verticalAlign: "top" }}>{label}</td>
      <td style={{ padding: "3px 0", fontSize: "12px", fontWeight: 600, color: "#1e293b", fontFamily: mono ? "monospace" : "inherit" }}>{value}</td>
    </tr>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface Props {
  data: ReceiptData | null;
  onClose: () => void;
}

export function ReceiptDialog({ data, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  if (!data) return null;

  const isApp = data.type === "application_fee";
  const filename = isApp
    ? `receipt-${data.application_id}-${Date.now()}.pdf`
    : `receipt-${data.receipt_no || data.student_name?.replace(/\s+/g, "-")}-${Date.now()}.pdf`;

  const downloadPdf = async () => {
    if (!printRef.current) return;
    setGenerating(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const imgW = 210;
      const imgH = (canvas.height * imgW) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, imgW, Math.min(imgH, 297));
      pdf.save(filename);
    } finally {
      setGenerating(false);
    }
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Receipt</title><style>body{margin:0;padding:0;}</style></head><body>${printRef.current.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Dialog header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            {isApp ? "Application Fee Receipt" : "Payment Receipt"}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
            <button
              onClick={downloadPdf}
              disabled={generating}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {generating ? "Generating…" : "Download PDF"}
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Receipt preview */}
        <div className="overflow-y-auto p-6 bg-gray-50 flex justify-center">
          <div ref={printRef} className="shadow-lg">
            <ReceiptContent d={data} />
          </div>
        </div>
      </div>
    </div>
  );
}
