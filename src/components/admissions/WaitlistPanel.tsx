import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowUp, Clock, Check } from "lucide-react";

interface WaitlistEntry {
  id: string;
  lead_id: string;
  position: number;
  status: string;
  created_at: string;
  promoted_at: string | null;
  lead_name?: string;
  lead_phone?: string;
}

interface Props {
  courseId: string;
  campusId?: string;
  courseName: string;
}

export function WaitlistPanel({ courseId, campusId, courseName }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);

  const fetchWaitlist = async () => {
    const { data } = await supabase
      .from("waitlist_entries" as any)
      .select("*, leads:lead_id(name, phone)")
      .eq("course_id", courseId)
      .eq("status", "waiting")
      .order("position");

    if (data) {
      setEntries(
        (data as any[]).map((e) => ({
          ...e,
          lead_name: (e.leads as any)?.name,
          lead_phone: (e.leads as any)?.phone,
        }))
      );
    }
    setLoading(false);
  };

  useEffect(() => { fetchWaitlist(); }, [courseId]);

  const handlePromote = async () => {
    setPromoting(true);
    const { data, error } = await supabase.rpc("promote_from_waitlist" as any, {
      p_course_id: courseId,
      p_campus_id: campusId || null,
    });

    if (error) {
      toast({ title: "Promotion failed", description: error.message, variant: "destructive" });
    } else if (data) {
      toast({ title: "Lead promoted from waitlist" });
    } else {
      toast({ title: "No one in waitlist" });
    }
    setPromoting(false);
    fetchWaitlist();
  };

  if (loading) return <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">No leads waitlisted for {courseName}</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Waitlist — {courseName} ({entries.length})
        </h4>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={handlePromote} disabled={promoting}>
          {promoting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUp className="h-3 w-3" />}
          Promote Next
        </Button>
      </div>

      <div className="space-y-1.5">
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 hover:bg-muted/30 cursor-pointer transition-colors"
            onClick={() => navigate(`/admissions/${e.lead_id}`)}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-[10px] font-bold text-amber-700 dark:text-amber-400">
              {e.position}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-foreground truncate block">{e.lead_name || "Unknown"}</span>
              <span className="text-[10px] text-muted-foreground">{e.lead_phone}</span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
