/**
 * Human-readable campaign state for the Marketing table.
 *
 * The raw worker statuses are ambiguous in the UI: a paced campaign sits at
 * `pending` between daily waves for hours, which looked exactly like a campaign
 * stranded by a lost finalisation write. Both rendered a bare "pending" badge
 * with no next-wave time and no queue depth. This distinguishes them using the
 * recipient queue itself rather than the campaign row's status.
 */

export type CampaignHealthInput = {
  status: string;
  nextAttemptAt: string | null;
  workerError: string | null;
  /** Recipients still to send (any eligible_at). */
  pendingRecipients: number;
  /** Pending AND already eligible — a worker should be sending these now. */
  dueNow: number;
  /** When the next paced wave unlocks. */
  nextEligibleAt: string | null;
};

export type CampaignHealth = {
  label: string;
  detail: string | null;
  tone: string;
};

/** How long a claimed campaign may sit locked before we call it stalled. */
export const STALL_AFTER_MS = 15 * 60 * 1000;

/** Short wave timestamp: "today 15:21", "tomorrow 09:51", or "04 Sep 09:51". */
export const fmtWave = (value: string | null) => {
  if (!value) return "-";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "-";
  const time = at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const dayDiff = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()) / 86400000,
  );
  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `tomorrow ${time}`;
  return `${at.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ${time}`;
};


export const campaignHealth = (
  campaign: CampaignHealthInput,
  now: number = Date.now(),
): CampaignHealth => {
  const { status, pendingRecipients, dueNow, nextEligibleAt } = campaign;

  if (status === "completed") return { label: "Completed", detail: null, tone: "bg-success/10 text-success" };
  if (status === "terminated") return { label: "Terminated", detail: null, tone: "bg-zinc-200 text-zinc-700" };
  if (status === "paused") return { label: "Paused", detail: `${pendingRecipients.toLocaleString("en-IN")} left`, tone: "bg-slate-100 text-slate-700" };
  if (status === "failed") return { label: "Failed", detail: campaign.workerError, tone: "bg-destructive/10 text-destructive" };

  if (status === "sending") {
    const lockedAt = new Date(campaign.nextAttemptAt || 0).getTime();
    // A worker holds the campaign for ~30s per batch. Still "sending" long after
    // that, with nothing due, means the finalise write was lost.
    if (pendingRecipients === 0) {
      return { label: "Wrapping up", detail: "finishing final counts", tone: "bg-info/10 text-info-foreground" };
    }
    if (Number.isFinite(lockedAt) && lockedAt > 0 && now - lockedAt > STALL_AFTER_MS) {
      return { label: "Stalled", detail: "no worker progress in 15+ min", tone: "bg-destructive/10 text-destructive" };
    }
    return { label: "Sending now", detail: `${pendingRecipients.toLocaleString("en-IN")} left`, tone: "bg-info/10 text-info-foreground" };
  }

  // status === "pending"
  if (pendingRecipients === 0) {
    return { label: "Wrapping up", detail: "finishing final counts", tone: "bg-info/10 text-info-foreground" };
  }
  if (dueNow > 0) {
    return { label: "Sending now", detail: `${dueNow.toLocaleString("en-IN")} due`, tone: "bg-info/10 text-info-foreground" };
  }
  if (nextEligibleAt) {
    return {
      label: "Paced",
      detail: `${pendingRecipients.toLocaleString("en-IN")} queued \u00b7 next ${fmtWave(nextEligibleAt)}`,
      tone: "bg-sky-100 text-sky-700",
    };
  }
  // Compare against the injected `now`, not Date.now() — a wall-clock read here
  // makes this branch untestable and drift-prone.
  const attemptAt = campaign.nextAttemptAt ? new Date(campaign.nextAttemptAt).getTime() : NaN;
  if (Number.isFinite(attemptAt) && attemptAt > now) {
    return { label: "Scheduled", detail: fmtWave(campaign.nextAttemptAt), tone: "bg-sky-100 text-sky-700" };
  }
  return { label: "Waiting to start", detail: `${pendingRecipients.toLocaleString("en-IN")} queued`, tone: "bg-sky-100 text-sky-700" };
};
