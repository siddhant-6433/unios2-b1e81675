import { ArrowRight, ArrowLeft, Loader2, CreditCard, CheckCircle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApplicationData } from "./types";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}

export function PaymentSection({ data, onChange, onNext, onBack, saving }: Props) {
  const isPaid = data.payment_status === 'paid';
  const isWaived = data.fee_amount === 0;

  const handleMarkPaid = () => {
    onChange({ payment_status: 'paid' });
    // Auto-advance will happen via onNext
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">Application Fee</h2>

      {isWaived ? (
        <div className="text-center py-8">
          <CheckCircle className="h-12 w-12 text-primary mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No application fee required</p>
          <p className="text-xs text-muted-foreground mt-1">This programme has zero application fee.</p>
        </div>
      ) : isPaid ? (
        <div className="text-center py-8">
          <CheckCircle className="h-12 w-12 text-primary mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Application fee paid</p>
          <p className="text-xs text-muted-foreground mt-1">You can proceed to the next step.</p>
        </div>
      ) : (
        <div className="text-center py-8 space-y-4">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mx-auto">
            <CreditCard className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">₹{data.fee_amount.toLocaleString('en-IN')}</p>
            <p className="text-sm text-muted-foreground">Application Processing Fee</p>
          </div>

          {data.course_selections.length > 1 && (
            <div className="text-xs text-muted-foreground max-w-sm mx-auto space-y-1">
              {data.course_selections.map((cs, i) => (
                <div key={i} className="flex justify-between px-4">
                  <span>{cs.course_name}</span>
                  <span className="font-medium">₹{(data.fee_amount / data.course_selections.length).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Online payment integration coming soon — please contact admissions or pay at the campus.
          </p>
          <Button onClick={handleMarkPaid} disabled={saving} variant="outline" className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <Shield className="h-4 w-4" /> Mark as Paid (Staff Use)
          </Button>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!isPaid && !isWaived} className="gap-2">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
