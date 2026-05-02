import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Settings, User, ChevronDown, Trophy, Flame, TrendingUp } from "lucide-react";

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin", campus_admin: "Campus Admin", principal: "Principal",
  faculty: "Faculty", teacher: "Teacher", student: "Student", parent: "Parent",
  counsellor: "Counsellor", accountant: "Accountant", admission_head: "Admission Head",
  data_entry: "Data Entry", office_admin: "Office Administrator", office_assistant: "Office Assistant", hostel_warden: "Hostel Warden",
  consultant: "Consultant", ib_coordinator: "IB Coordinator",
};

interface LeaderboardRow {
  counsellor_id: string;
  counsellor_name: string;
  total_score: number;
  daily_score: number;
  weekly_score: number;
  monthly_score: number;
}

function CounsellorScoreChip({ profileId }: { profileId: string }) {
  const [score, setScore] = useState<LeaderboardRow | null>(null);
  const [allScores, setAllScores] = useState<LeaderboardRow[]>([]);
  const [showRank, setShowRank] = useState(false);
  const rankRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    const { data } = await supabase.rpc("get_counsellor_leaderboard" as any);
    const rows = ((data || []) as LeaderboardRow[]).sort((a, b) => b.total_score - a.total_score);
    setAllScores(rows);
    const me = rows.find(r => r.counsellor_id === profileId);
    setScore(me || { counsellor_id: profileId, counsellor_name: "", total_score: 0, daily_score: 0, weekly_score: 0, monthly_score: 0 });
  };

  useEffect(() => {
    if (!profileId) return;
    fetchData();

    const channel = supabase
      .channel("header-score")
      .on("postgres_changes" as any, {
        event: "INSERT", schema: "public", table: "counsellor_score_events",
      }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profileId]);

  // Close rank popover on outside click
  useEffect(() => {
    if (!showRank) return;
    const handler = (e: MouseEvent) => {
      if (rankRef.current && !rankRef.current.contains(e.target as Node)) setShowRank(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showRank]);

  if (!score) return null;

  const isHot = score.daily_score >= 20;
  const myRank = allScores.findIndex(r => r.counsellor_id === profileId) + 1;

  return (
    <div ref={rankRef} className="relative hidden sm:block">
      <button
        onClick={() => setShowRank(!showRank)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 hover:bg-muted/50 transition-colors"
      >
        {isHot ? (
          <Flame className="h-3.5 w-3.5 text-orange-500 animate-pulse" />
        ) : (
          <Trophy className={`h-3.5 w-3.5 ${score.weekly_score >= 50 ? "text-amber-500" : "text-muted-foreground"}`} />
        )}
        <span className="text-[11px] font-bold text-foreground">{score.total_score}</span>
        {score.daily_score !== 0 && (
          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
            score.daily_score > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}>
            {score.daily_score > 0 ? `+${score.daily_score}` : score.daily_score}
          </span>
        )}
        {myRank > 0 && (
          <span className="text-[9px] text-muted-foreground">#{myRank}</span>
        )}
      </button>

      {showRank && allScores.length > 0 && (
        <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-border bg-card shadow-lg z-50 py-2 overflow-hidden">
          <p className="px-3 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Leaderboard</p>
          <div className="max-h-[280px] overflow-y-auto">
            {allScores.map((r, i) => {
              const isMe = r.counsellor_id === profileId;
              return (
                <div key={r.counsellor_id} className={`flex items-center gap-2.5 px-3 py-1.5 ${isMe ? "bg-primary/10" : "hover:bg-muted/30"}`}>
                  <span className={`w-5 text-right text-[11px] font-bold ${i === 0 ? "text-amber-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-orange-400" : "text-muted-foreground"}`}>
                    {i + 1}
                  </span>
                  <span className={`text-[12px] flex-1 truncate ${isMe ? "font-bold text-primary" : "text-foreground"}`}>
                    {r.counsellor_name || "Unknown"}{isMe ? " (You)" : ""}
                  </span>
                  <span className="text-[11px] font-bold text-foreground tabular-nums">{r.total_score}</span>
                  {r.daily_score !== 0 && (
                    <span className={`text-[9px] font-bold ${r.daily_score > 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {r.daily_score > 0 ? `+${r.daily_score}` : r.daily_score}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function HeaderProfile() {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const displayName = profile?.display_name || "User";
  const roleLabel = role ? (roleLabels[role] || role) : "User";
  const initials = displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  const isCounsellor = role === "counsellor";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      {isCounsellor && profile?.id && <CounsellorScoreChip profileId={profile.id} />}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-muted transition-colors"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {initials}
        </div>
        <div className="hidden sm:flex flex-col items-start">
          <span className="text-[12px] font-semibold text-foreground leading-tight truncate max-w-[100px]">{displayName}</span>
          <span className="text-[10px] text-muted-foreground leading-tight">{roleLabel}</span>
        </div>
        <ChevronDown className="h-3 w-3 text-muted-foreground hidden sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-border bg-card shadow-lg z-50 py-1.5 overflow-hidden">
          {/* User info */}
          <div className="px-4 py-2.5 border-b border-border/50">
            <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
            <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
          </div>

          {/* Menu items */}
          <button
            onClick={() => { navigate("/settings"); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <Settings className="h-4 w-4 text-muted-foreground" />
            Settings
          </button>
          <button
            onClick={() => { signOut(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
