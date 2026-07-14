/**
 * Pace large WhatsApp marketing campaigns under Meta's unique-user / 24h tiers.
 * Assigns each recipient an eligible_at so the worker only claims due rows.
 */

export type CampaignSendMode = "immediate" | "paced";

export type PacePlan = {
  sendMode: CampaignSendMode;
  dailyUniqueCap: number | null;
  waveCount: number;
  startAt: Date;
  /** One ISO timestamp per recipient index (same order as recipient list). */
  eligibleAtByIndex: string[];
  /** Human preview lines for the create UI. */
  preview: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default daily cap when ops enable pacing (Meta tier often 2k after scale path). */
export const DEFAULT_DAILY_UNIQUE_CAP = 2000;

/**
 * Build eligible_at timestamps: first `dailyCap` recipients at startAt,
 * next wave startAt+1d, etc. Immediate non-paced → all startAt.
 */
export function buildCampaignPacePlan(opts: {
  recipientCount: number;
  sendMode: CampaignSendMode;
  dailyUniqueCap?: number | null;
  startAt?: Date | string | null;
}): PacePlan {
  const count = Math.max(0, Math.floor(opts.recipientCount));
  const startAt = opts.startAt ? new Date(opts.startAt) : new Date();
  if (Number.isNaN(startAt.getTime())) {
    throw new Error("Invalid campaign start time.");
  }

  if (opts.sendMode !== "paced" || count === 0) {
    const iso = startAt.toISOString();
    return {
      sendMode: "immediate",
      dailyUniqueCap: null,
      waveCount: count > 0 ? 1 : 0,
      startAt,
      eligibleAtByIndex: Array.from({ length: count }, () => iso),
      preview:
        count === 0
          ? "No recipients."
          : `Send all ${count.toLocaleString("en-IN")} as soon as the worker runs.`,
    };
  }

  const cap = Math.max(1, Math.floor(Number(opts.dailyUniqueCap) || DEFAULT_DAILY_UNIQUE_CAP));
  const waveCount = Math.ceil(count / cap);
  const eligibleAtByIndex = Array.from({ length: count }, (_, i) => {
    const wave = Math.floor(i / cap);
    return new Date(startAt.getTime() + wave * DAY_MS).toISOString();
  });

  const lastWaveAt = new Date(startAt.getTime() + (waveCount - 1) * DAY_MS);
  const preview =
    `${count.toLocaleString("en-IN")} recipients · max ${cap.toLocaleString("en-IN")}/day ` +
    `→ ${waveCount} wave${waveCount === 1 ? "" : "s"} · last wave ~${lastWaveAt.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}. ` +
    `Same-day split does not raise Meta's rolling 24h unique-user limit — waves are spaced ~24h apart.`;

  return {
    sendMode: "paced",
    dailyUniqueCap: cap,
    waveCount,
    startAt,
    eligibleAtByIndex,
    preview,
  };
}
