// Public candidate offer-acceptance page — `/careers/offer/:token`.
//
// The token is the only credential. On mount we read the offer letter through
// the anon-callable `get_offer_by_token` RPC; while it is still `pending` the
// candidate may accept or decline through `redeem_offer_acceptance`. No auth,
// no app chrome — this is the link HR emails/messages to a candidate.

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, FileText, XCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import uniosLogo from "@/assets/unios-logo.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PageLoader } from "@/components/ui/page-loader";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  acceptanceBadge,
  canRespond,
  type AcceptanceStatus,
  type OfferByToken,
} from "@/lib/offerAcceptance";

type View = "loading" | "ready" | "invalid";
type Outcome = "accepted" | "declined";

const STATUS_LABEL: Record<AcceptanceStatus, string> = {
  pending: "Awaiting your response",
  accepted: "Accepted",
  declined: "Declined",
};

function labelFor(status: AcceptanceStatus | string | undefined): string {
  return STATUS_LABEL[status as AcceptanceStatus] ?? "Response recorded";
}

/** Pull a human message out of a PostgrestError/Error/unknown throw. */
function messageOf(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export default function OfferAcceptance() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [view, setView] = useState<View>("loading");
  const [offer, setOffer] = useState<OfferByToken | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOffer = useCallback(async (): Promise<OfferByToken | null> => {
    if (!token) return null;
    const { data, error: rpcError } = await supabase.rpc(
      "get_offer_by_token" as never,
      { _token: token } as never,
    );
    if (rpcError) throw rpcError;
    const rows = (data ?? []) as unknown as OfferByToken[];
    return rows[0] ?? null;
  }, [token]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const row = await loadOffer();
        if (!active) return;
        if (!row) {
          setView("invalid");
          return;
        }
        setOffer(row);
        setView("ready");
      } catch (e) {
        if (!active) return;
        setError(messageOf(e, "Could not load this offer."));
        setView("invalid");
      }
    })();
    return () => {
      active = false;
    };
  }, [loadOffer]);

  const handleRespond = async (accept: boolean) => {
    if (!token || !offer) return;
    setSubmitting(accept ? "accept" : "decline");
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "redeem_offer_acceptance" as never,
        { _token: token, _accept: accept, _note: note.trim() ? note.trim() : null } as never,
      );
      if (rpcError) throw rpcError;

      const result: Outcome =
        (typeof data === "string" ? data : null) === "declined" || !accept
          ? "declined"
          : "accepted";
      setOutcome(result);
      setOffer((prev) => (prev ? { ...prev, acceptance_status: result } : prev));
      toast({
        title: result === "accepted" ? "Offer accepted" : "Offer declined",
        description:
          result === "accepted"
            ? "HR will follow up with joining details."
            : "HR has been notified of your decision.",
      });
    } catch (e) {
      const message = messageOf(e, "Something went wrong. Please try again.");
      setError(message);
      toast({ title: "Could not record your response", description: message, variant: "destructive" });
      // The server may have moved on (already responded / no longer available).
      // Re-read so the page shows the recorded state instead of stale buttons.
      try {
        const row = await loadOffer();
        if (row) setOffer(row);
      } catch {
        /* keep the error already surfaced */
      }
    } finally {
      setSubmitting(null);
    }
  };

  const currentStatus = outcome ?? offer?.acceptance_status;
  const respondable = canRespond(offer) && !outcome;

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl animate-fade-in">
        <img src={uniosLogo} alt="UniOs" className="mx-auto mb-6 h-10" />

        {view === "loading" && (
          <Card className="overflow-hidden">
            <CardContent className="pt-6">
              <PageLoader label="Loading your offer…" />
            </CardContent>
          </Card>
        )}

        {view === "invalid" && (
          <Card className="overflow-hidden">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <AlertCircle className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-base font-semibold text-foreground">
                This offer link is invalid or has expired
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {error || "Please check the link in your offer letter, or reach out to the HR team."}
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link to="/careers">Back to careers</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {view === "ready" && offer && (
          <Card className="overflow-hidden">
            <CardHeader className="gap-3 border-b bg-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" /> Offer of employment
                  </p>
                  <CardTitle className="text-xl leading-snug sm:text-2xl">
                    {offer.subject || "Your offer from UniOs"}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Dear {offer.applicant_name},
                  </p>
                </div>
                <Badge className={cn("shrink-0", acceptanceBadge(currentStatus ?? "pending"))}>
                  {labelFor(currentStatus)}
                </Badge>
              </div>

              {(offer.job_opening_title || offer.desired_role || offer.reference_no) && (
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  {(offer.job_opening_title || offer.desired_role) && (
                    <div className="flex gap-1">
                      <dt className="font-medium text-foreground/70">Role:</dt>
                      <dd>{offer.job_opening_title || offer.desired_role}</dd>
                    </div>
                  )}
                  {offer.reference_no && (
                    <div className="flex gap-1">
                      <dt className="font-medium text-foreground/70">Reference:</dt>
                      <dd className="font-mono">{offer.reference_no}</dd>
                    </div>
                  )}
                </dl>
              )}
            </CardHeader>

            <CardContent className="space-y-6 pt-6">
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                {offer.body || "The offer details have not been attached to this letter yet."}
              </div>

              {respondable ? (
                <div className="space-y-4 border-t pt-5">
                  <div className="space-y-1.5">
                    <label htmlFor="offer-note" className="text-sm font-medium text-foreground">
                      Add a note <span className="font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <Textarea
                      id="offer-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Anything HR should know — preferred joining date, questions…"
                      rows={3}
                      maxLength={1000}
                      disabled={submitting !== null}
                    />
                  </div>

                  {error && (
                    <p className="flex items-start gap-2 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </p>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      className="flex-1"
                      disabled={submitting !== null}
                      onClick={() => handleRespond(true)}
                    >
                      {submitting === "accept" ? "Accepting…" : "Accept offer"}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 text-destructive hover:text-destructive"
                      disabled={submitting !== null}
                      onClick={() => handleRespond(false)}
                    >
                      {submitting === "decline" ? "Declining…" : "Decline offer"}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Accepting records your agreement. HR will follow up with joining details.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 border-t pt-5">
                  {error && (
                    <p className="flex items-start gap-2 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </p>
                  )}
                  <div
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-4",
                      currentStatus === "accepted"
                        ? "border-success/30 bg-success/5"
                        : "border-border bg-muted/40",
                    )}
                  >
                    {currentStatus === "accepted" ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                    ) : (
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-foreground">
                        {currentStatus === "accepted"
                          ? "Offer accepted — HR will follow up with joining details"
                          : currentStatus === "declined"
                            ? "Offer declined"
                            : "Your response has been recorded"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {currentStatus === "accepted"
                          ? "Thank you for confirming. Our team will be in touch shortly."
                          : "Thank you for letting us know. We wish you the very best."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Having trouble? Contact the HR team and quote your reference number.
        </p>
      </div>
    </div>
  );
}
