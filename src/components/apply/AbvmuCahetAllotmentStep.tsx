import { useEffect, useState } from "react";
import { Landmark, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { SelectField, TextField } from "@/components/ui/state-fields";
import { supabase } from "@/integrations/supabase/client";
import {
  ABVMU_CHALLAN_FALLBACK_AMOUNT,
  withAbvmuCahetAllotmentFlag,
} from "@/lib/abvmuCahetAllotment";
import type { ApplicationData } from "./types";

interface Props {
  data: ApplicationData;
  onComplete: (flags: string[]) => Promise<boolean>;
  saving: boolean;
}

const allotmentOptions = [
  { value: "yes", label: "Yes — seat allotted by ABVMU CAHET counselling" },
  { value: "no", label: "No — continue with the regular application" },
];

const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function AbvmuCahetAllotmentStep({ data, onComplete, saving }: Props) {
  const [answer, setAnswer] = useState<"yes" | "no" | "">("");
  const [challanNo, setChallanNo] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [depositAmount, setDepositAmount] = useState(ABVMU_CHALLAN_FALLBACK_AMOUNT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!data.lead_id) return;
    let alive = true;
    (supabase as any)
      .rpc("lead_abvmu_deposit_amount", { _lead_id: data.lead_id })
      .then(({ data: amount }: { data: number | string | null }) => {
        if (!alive) return;
        const n = Number(amount || 0);
        if (n > 0) setDepositAmount(n);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [data.lead_id]);

  const busy = saving || submitting;

  const submitClaim = async () => {
    if (!data.lead_id) {
      throw new Error("Application is still linking to admissions. Wait a moment and try again.");
    }
    if (!file) {
      throw new Error("Upload the ABVMU challan (PDF or image) to continue.");
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `abvmu-claims/${data.lead_id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from("application-documents")
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) throw upErr;

    const { error: claimErr } = await (supabase as any).rpc("submit_abvmu_deposit_claim", {
      _lead_id: data.lead_id,
      _proof_path: path,
      _proof_file_name: file.name,
      _proof_content_type: file.type || null,
      _challan_number: challanNo || null,
      _challan_date: challanDate || null,
      _notes: "Uploaded during application (ABVMU CAHET counselling allotment)",
      _amount: depositAmount,
    });
    if (claimErr) {
      const message = String(claimErr.message || "");
      // A prior pending/approved claim (staff or a previous attempt) is enough to continue.
      if (!/already pending or approved/i.test(message)) throw claimErr;
    }
  };

  const handleContinue = async () => {
    if (!answer) {
      setShowErrors(true);
      setError("Select whether a seat has been allotted by ABVMU CAHET counselling.");
      return;
    }
    if (answer === "yes" && !file) {
      setShowErrors(true);
      setError(`Upload the ABVMU challan of ${fmt(depositAmount)} to continue.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (answer === "yes") await submitClaim();
      const ok = await onComplete(withAbvmuCahetAllotmentFlag(data.flags, answer === "yes"));
      if (!ok) setError("Could not save your answer. Please try again.");
    } catch (e: any) {
      setError(e?.message || "Could not save ABVMU counselling details");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-info/10 text-info flex items-center justify-center shrink-0">
          <Landmark className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">ABVMU CAHET counselling</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            For BPT and BMRIT, tell us if the candidate has already been allotted a seat through
            ABVMU CAHET counselling. If yes, upload the {fmt(depositAmount)} ABVMU challan now.
            When the offer letter is issued, this challan can be approved and the amount adjusted
            against the first-year fee — the same adjustment used after an offer is issued.
          </p>
        </div>
      </div>

      <SelectField
        label="Has the candidate been allotted a seat by ABVMU CAHET counselling?"
        value={answer}
        onValueChange={(v) => {
          setAnswer((v === "yes" || v === "no" ? v : "") as "yes" | "no" | "");
          setError(null);
        }}
        options={allotmentOptions}
        placeholder="Select yes or no"
        required
        error={showErrors && !answer ? "Required" : undefined}
      />

      {answer === "yes" && (
        <div className="space-y-4 rounded-xl border border-info/20 bg-info/5 p-4">
          <p className="text-sm font-medium text-info-foreground">
            Upload ABVMU challan of {fmt(depositAmount)}
          </p>
          <p className="text-xs text-info-foreground/80 leading-relaxed">
            This is the same university seat-reservation challan requested after the offer letter.
            Uploading it now lets admissions approve it when the offer is issued.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label="Challan number"
              value={challanNo}
              onValueChange={setChallanNo}
              placeholder="Optional"
            />
            <TextField
              label="Payment date"
              type="date"
              value={challanDate}
              onValueChange={setChallanDate}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Challan / proof (PDF or image) <span className="text-destructive">*</span>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-dashed border-input bg-card px-4 py-3 text-sm cursor-pointer hover:bg-muted/40">
              <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate text-foreground">
                {file ? file.name : "Choose PDF or image"}
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            {showErrors && !file && (
              <p className="text-xs text-destructive mt-1">Challan file is required</p>
            )}
          </div>
        </div>
      )}

      {answer === "no" && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          Continue with the regular application. If a seat is allotted later, the same ABVMU
          challan can still be uploaded after the offer letter is issued.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" onClick={handleContinue} disabled={busy} className="w-full gap-2">
        {busy ? (
          <>
            <ButtonOrb state="composing" /> Saving…
          </>
        ) : answer === "yes" ? (
          "Upload challan and continue"
        ) : (
          "Continue with application"
        )}
      </Button>
    </div>
  );
}
