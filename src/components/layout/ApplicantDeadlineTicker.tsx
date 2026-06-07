import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const DEFAULT_FEE_SUBMISSION_DEADLINE = "2026-06-10";
const PUBLIC_APPLICATION_DEADLINE = "2026-06-10";

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

function formatDate(dateString: string): string {
  return endOfIstDay(dateString).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
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

interface ApplicantDeadlineTickerProps {
  audience?: "staff" | "public";
}

function PublicApplicationDeadlineHeader() {
  const [now, setNow] = useState(Date.now());
  const deadlineLabel = formatLongDate(PUBLIC_APPLICATION_DEADLINE);
  const countdown = countdownRemaining(PUBLIC_APPLICATION_DEADLINE, now);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="border-b border-white/10 bg-[#0b1f4d] px-4 py-2 text-white shadow-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2 text-center text-xs font-semibold sm:justify-between md:flex-nowrap md:text-left">
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 md:flex-nowrap md:justify-start">
          <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-sky-300 sm:text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
            Admissions 2026-27
          </span>
          <span className="text-sm font-bold text-white sm:text-base">
            Round 1 deadline: apply by {deadlineLabel}
          </span>
        </div>

        <div className="inline-flex min-w-0 flex-wrap items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-white/90 md:flex-nowrap">
          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[#fffc4d] sm:text-xs">
            BPT &amp; BMRIT
          </span>
          <span className="hidden sm:inline">
            CAHET registration on ABVMU due <strong className="text-white">{deadlineLabel}, 11:59 PM</strong>
          </span>
          <strong className="rounded-full bg-[#fffc4d] px-2 py-0.5 font-mono text-xs font-black text-black">
            {countdown}
          </strong>
        </div>

        <Link
          to="/apply/nimt"
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-[#0b1f4d] shadow-sm transition hover:bg-blue-100"
        >
          Apply Now
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

export function ApplicantDeadlineTicker({ audience = "staff" }: ApplicantDeadlineTickerProps) {
  const { role } = useAuth();
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

  const days = daysRemaining(deadline);
  if (days === 0) return null;

  if (audience === "public") {
    return <PublicApplicationDeadlineHeader />;
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-950 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-amber-700" />
        <span className="font-semibold">{audience === "public" ? "Application deadline" : "All-course deadline"}</span>
        <span className="text-amber-800">
          {formatDate(deadline)} · {days} {days === 1 ? "day" : "days"} left
        </span>
        {audience === "staff" && role === "super_admin" && (
          <Link to="/settings" className="ml-auto font-medium text-amber-900 underline-offset-2 hover:underline">
            Edit
          </Link>
        )}
      </div>
    </div>
  );
}
