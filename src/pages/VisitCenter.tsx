// Visit Center — dedicated operational surface for logging visits (incl.
// instant walk-ins) and working post-visit follow-ups. VisitMonitor remains
// the admin/analytics view; this is the day-to-day desk.

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SelectField } from "@/components/ui/state-fields";
import { Button } from "@/components/ui/button";
import { TodayVisitBoard } from "@/components/visits/TodayVisitBoard";
import { PostVisitQueue } from "@/components/visits/PostVisitQueue";
import { OnCampusBoard } from "@/components/visits/OnCampusBoard";
import { WalkInDialog } from "@/components/visits/WalkInDialog";
import { Footprints, Calendar, Clock, DoorOpen } from "lucide-react";

interface Course { id: string; name: string }
interface Campus { id: string; name: string }

type Tab = "today" | "on_campus" | "post_visit";

export default function VisitCenter() {
  const [tab, setTab] = useState<Tab>("today");
  const [campusId, setCampusId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    Promise.all([
      supabase.from("courses").select("id, name").order("name"),
      supabase.from("campuses").select("id, name").order("name"),
    ]).then(([cRes, campRes]) => {
      if (cRes.data) setCourses(cRes.data as Course[]);
      if (campRes.data) setCampuses(campRes.data as Campus[]);
    });
  }, []);

  const bump = () => setRefreshKey((k) => k + 1);

  const TABS: { key: Tab; label: string; icon: typeof Calendar }[] = [
    { key: "today", label: "Today & Upcoming", icon: Calendar },
    { key: "on_campus", label: "On Campus", icon: DoorOpen },
    { key: "post_visit", label: "Post-Visit Queue", icon: Clock },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Visit Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Log walk-ins, check candidates in, and work post-visit follow-ups</p>
        </div>
        <Button onClick={() => setShowWalkIn(true)} className="gap-2">
          <Footprints className="h-4 w-4" /> Record Walk-in
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <SelectField
            value={campusId}
            onValueChange={setCampusId}
            options={[{ value: "", label: "All campuses" }, ...campuses.map((c) => ({ value: c.id, label: c.name }))]}
            label="Campus"
            placeholder="All campuses"
          />
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "today" ? (
        <TodayVisitBoard campusId={campusId || undefined} refreshKey={refreshKey} onChanged={bump} />
      ) : tab === "on_campus" ? (
        <OnCampusBoard campusId={campusId || undefined} refreshKey={refreshKey} onChanged={bump} />
      ) : (
        <PostVisitQueue refreshKey={refreshKey} onChanged={bump} />
      )}

      <WalkInDialog
        open={showWalkIn}
        onOpenChange={setShowWalkIn}
        courses={courses}
        campuses={campuses}
        defaultCampusId={campusId || undefined}
        onRecorded={bump}
      />
    </div>
  );
}
