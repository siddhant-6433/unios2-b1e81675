import { Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Year1LumpSumOffer } from "@/lib/year1LumpSumWaiver";
import { year1LumpSumNoticeVisible } from "@/lib/year1LumpSumWaiver";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function Year1LumpSumInfoBanner({ offer }: { offer: Year1LumpSumOffer }) {
  if (!year1LumpSumNoticeVisible(offer)) return null;
  if (offer.eligible) {
    return (
      <Alert className="border-emerald-300 bg-emerald-50 text-emerald-950 [&>svg]:text-emerald-700">
        <Sparkles className="h-4 w-4" />
        <AlertTitle>{offer.pct}% off Year 1 tuition</AlertTitle>
        <AlertDescription>
          Pay remaining Year 1 college tuition in one payment to save {inr(offer.discount)}.
          Payable {inr(offer.amountDue)} after waiver. Uniform and the ABVMU deposit are not included.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="border-emerald-200 bg-emerald-50/70 text-emerald-950 [&>svg]:text-emerald-700">
      <Sparkles className="h-4 w-4" />
      <AlertTitle>{offer.pct}% Year 1 tuition waiver</AlertTitle>
      <AlertDescription>
        Applies to remaining college Year 1 tuition paid in one payment — not uniform, later years, or the ABVMU deposit.
        {offer.alreadyAvailed ? " This student has no remaining Year 1 college tuition." : ""}
      </AlertDescription>
    </Alert>
  );
}

export function Year1LumpSumYearGroupNotice({
  offer,
  colSpan,
}: {
  offer: Year1LumpSumOffer;
  colSpan: number;
}) {
  if (!year1LumpSumNoticeVisible(offer)) return null;
  return (
    <tr className="bg-emerald-50">
      <td colSpan={colSpan} className="px-4 py-2.5">
        <div className="flex items-start gap-2 text-[12px] text-emerald-950">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
          <p>
            {offer.eligible ? (
              <>
                <span className="font-semibold">{offer.pct}% off Year 1 tuition</span>
                {" "}— pay remaining college tuition in one payment to save {inr(offer.discount)}.
                Payable {inr(offer.amountDue)}. Uniform and the ABVMU deposit are not included.
              </>
            ) : (
              <>
                <span className="font-semibold">{offer.pct}% Year 1 tuition waiver</span>
                {" "}applies to remaining college Year 1 tuition paid in one payment.
                Uniform and the ABVMU deposit are not included.
                {offer.alreadyAvailed ? " No remaining Year 1 college tuition on this ledger." : ""}
              </>
            )}
          </p>
        </div>
      </td>
    </tr>
  );
}

export function Year1TuitionWaiverBadge({
  offer,
  feeId,
}: {
  offer: Year1LumpSumOffer;
  feeId: string;
}) {
  if (!year1LumpSumNoticeVisible(offer) || !offer.feeIds.includes(feeId)) return null;
  return (
    <span className="mt-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
      {offer.eligible
        ? `${offer.pct}% off if paid in full · save ${inr(offer.discount)}`
        : `${offer.pct}% Year 1 tuition waiver`}
    </span>
  );
}

export function Year1LumpSumIncentiveCard({
  offer,
  onPay,
}: {
  offer: Year1LumpSumOffer;
  onPay: () => void;
}) {
  if (!offer.eligible) return null;
  return (
    <div className="rounded-xl border-2 border-success/30 bg-gradient-to-br from-emerald-50 to-green-50 p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles className="h-3.5 w-3.5 text-success" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-success">
            One-time Year 1 tuition
          </p>
        </div>
        <p className="text-sm font-semibold text-gray-900">
          Pay {inr(offer.amountDue)}
          <span className="ml-2 text-xs font-medium text-success">
            {offer.pct}% waiver saves {inr(offer.discount)}
          </span>
        </p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Remaining Year 1 tuition {inr(offer.remaining)}. Uniform is not included.
        </p>
      </div>
      <button
        type="button"
        onClick={onPay}
        className="shrink-0 rounded-xl bg-success px-4 py-2.5 text-sm font-semibold text-white hover:bg-success/90 transition-colors"
      >
        Pay Year 1
      </button>
    </div>
  );
}
