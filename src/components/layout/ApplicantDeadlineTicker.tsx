import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const DEFAULT_FEE_SUBMISSION_DEADLINE = "2026-06-15";
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

function formatDate(dateString: string): string {
  return endOfIstDay(dateString).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

interface ApplicantDeadlineTickerProps {
  audience?: "staff" | "public";
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
