import { Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Year1LumpSumOffer } from "@/lib/year1LumpSumWaiver";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function Year1LumpSumInfoBanner({ offer }: { offer: Year1LumpSumOffer }) {
  if (!offer.eligible) return null;
  return (
    <Alert variant="info">
      <Sparkles className="h-4 w-4" />
      <AlertTitle>{offer.pct}% off Year 1 tuition</AlertTitle>
      <AlertDescription>
        Pay remaining Year 1 tuition in one payment to save {inr(offer.discount)}.
        Payable {inr(offer.amountDue)} after waiver. Uniform is not included.
      </AlertDescription>
    </Alert>
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
