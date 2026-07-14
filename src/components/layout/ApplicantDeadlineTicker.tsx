import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePortal } from "@/components/apply/PortalContext";
import {
  applicationDeadlineHeadline,
  effectiveApplicationDeadline,
  INITIAL_APPLICATION_DEADLINE,
} from "@/lib/deadlineRollover";
import type { PortalId } from "@/components/apply/portalConfig";

const DEFAULT_FEE_SUBMISSION_DEADLINE = INITIAL_APPLICATION_DEADLINE;
const PUBLIC_APPLICATION_DEADLINE = INITIAL_APPLICATION_DEADLINE;
const UP_DELED_DEADLINE = "2026-07-09";

const STAFF_ROLES = new Set([
  "super_admin",
  "campus_admin",
  "principal",
  "admission_head",
  "counsellor",
  "accountant",
  "office_admin",
  "office_assistant",
  "data_entry",
]);

function endOfIstDay(dateString: string): Date {
  return new Date(`${dateString}T23:59:59+05:30`);
}

function daysRemaining(dateString: string): number {
  const ms = endOfIstDay(dateString).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function countdownRemaining(dateString: string, now: number): string {
  const ms = Math.max(0, endOfIstDay(dateString).getTime() - now);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

function ordinal(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function formatLongDate(dateString: string): string {
  const date = endOfIstDay(dateString);
  const day = Number(
    date.toLocaleDateString("en-IN", {
      day: "numeric",
      timeZone: "Asia/Kolkata",
    }),
  );
  const month = date.toLocaleDateString("en-IN", {
    month: "long",
    timeZone: "Asia/Kolkata",
  });
  const year = date.toLocaleDateString("en-IN", {
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return `${ordinal(day)} ${month} ${year}`;
}

function usesUpDeledDeadline(audience: "staff" | "public", portalId: PortalId): boolean {
  return audience === "staff" || portalId === "nimt";
}

interface ApplicantDeadlineTickerProps {
  audience?: "staff" | "public";
}

function PublicApplicationDeadlineHeader({
  audience,
  deadline,
  portalId,
  portalName,
  portalPath,
  portalPrimaryColor,
  showCta,
}: {
  audience: "staff" | "public";
  deadline: string;
  portalId: PortalId;
  portalName: string;
  portalPath: string;
  portalPrimaryColor: string;
  showCta: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const effectiveDeadline = effectiveApplicationDeadline(deadline, now);
  const deadlineLabel = formatLongDate(effectiveDeadline);
  const upDeledDeadlineLabel = formatLongDate(UP_DELED_DEADLINE);
  const showUpDeledDeadline = usesUpDeledDeadline(audience, portalId);
  const countdownDeadline = showUpDeledDeadline ? UP_DELED_DEADLINE : effectiveDeadline;
  const countdown = countdownRemaining(countdownDeadline, now);
  const headline = applicationDeadlineHeadline(portalId, now);
  const scopeLabel = showUpDeledDeadline ? "UP-DELED" : portalName;
  const capsuleText = showUpDeledDeadline ? "Deadline" : "Application deadline";
  const capsuleDeadlineLabel = showUpDeledDeadline ? upDeledDeadlineLabel : deadlineLabel;
  const backgroundColor = audience === "staff" ? "#0b1f4d" : portalPrimaryColor;
  const headlineText = showUpDeledDeadline
    ? `Application Deadline for all other courses: apply by ${deadlineLabel}`
    : `${headline}: apply by ${deadlineLabel}`;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="border-b border-white/10 px-4 py-2 text-white shadow-sm" style={{ backgroundColor }}>
      <div className="mx-auto flex w-full max-w-[112rem] flex-wrap items-center justify-center gap-2 text-center text-xs font-semibold xl:flex-nowrap xl:justify-between xl:text-left">
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 xl:flex-nowrap xl:justify-start">
          <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.14em] text-sky-300 sm:text-xs">
            <span className="h-2 w-2 rounded-full bg-success/50" aria-hidden="true" />
            Admissions 2026-27
          </span>
          <span className="min-w-0 text-sm font-bold text-white sm:text-base xl:truncate">
            {headlineText}
          </span>
        </div>

        <div className="inline-flex min-w-0 flex-wrap items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-white/90 xl:flex-nowrap">
          <span className="shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.14em] text-[#fffc4d] sm:text-xs">
            {scopeLabel}
          </span>
          {showUpDeledDeadline && (
            <span className="hidden whitespace-nowrap sm:inline">
              {capsuleText} <strong className="text-white">{capsuleDeadlineLabel}, 11:59 PM</strong>
            </span>
          )}
          <strong className="shrink-0 whitespace-nowrap rounded-full bg-[#fffc4d] px-2 py-0.5 font-mono text-xs font-black text-black">
            {countdown}
          </strong>
        </div>

        {showCta && (
          <Link
            to={portalPath}
            style={{ color: portalPrimaryColor }}
            className="inline-flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-[#0b1f4d] shadow-sm transition hover:bg-info/10"
          >
            Apply Now
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function ApplicantDeadlineTicker({ audience = "staff" }: ApplicantDeadlineTickerProps) {
  const { role } = useAuth();
  const portal = usePortal();
  const [deadline, setDeadline] = useState(
    audience === "public" ? PUBLIC_APPLICATION_DEADLINE : DEFAULT_FEE_SUBMISSION_DEADLINE,
  );

  const eligible = audience === "public" || Boolean(role && STAFF_ROLES.has(role as string));

  useEffect(() => {
    if (!eligible || audience === "public") return;
    let cancelled = false;

    async function load() {
      const { data, error } = await (supabase as any).rpc("get_applicant_deadlines");
      if (cancelled || error || !data) return;
      const next = (data.fee_submission_deadline as string | undefined) || DEFAULT_FEE_SUBMISSION_DEADLINE;
      setDeadline(next);
    }

    load();
    return () => { cancelled = true; };
  }, [audience, eligible]);

  if (!eligible) return null;

  const displayDeadline = usesUpDeledDeadline(audience, portal.id)
    ? UP_DELED_DEADLINE
    : effectiveApplicationDeadline(deadline);
  const days = daysRemaining(displayDeadline);
  if (days === 0) return null;

  return (
    <PublicApplicationDeadlineHeader
      audience={audience}
      deadline={deadline}
      portalId={portal.id}
      portalName={portal.name}
      portalPath={`/apply/${portal.id}`}
      portalPrimaryColor={portal.primaryColor}
      showCta={audience === "public"}
    />
  );
}
