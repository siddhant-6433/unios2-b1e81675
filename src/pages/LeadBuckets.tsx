import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import { useToast } from "@/hooks/use-toast";
import { School, GraduationCap, Search, Loader2, UserPlus, CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface BucketLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  course_name: string | null;
  campus_name: string | null;
  created_at: string;
  lead_score: number;
  lead_temperature: string;
  bucket: "school" | "college";
}

interface Counsellor {
  id: string;
  display_name: string;
}

const SOURCE_LABELS: Record<string, string> = {
  website: "Website", meta_ads: "Meta Ads", google_ads: "Google Ads",
  justdial: "JustDial", shiksha: "Shiksha", collegehai: "CollegeHai",
  collegedunia: "CollegeDunia", walk_in: "Walk-in", referral: "Referral",
  education_fair: "Education Fair", consultant: "Consultant", other: "Other",
};

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted",
};

function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return "****";
  return "••••••" + phone.slice(-4);
}

export default function LeadBuckets() {
  const { user, role, profile } = useAuth();
  const { selectedCampusId } = useCampus();
  const { toast } = useToast();

  const [activeBucket, setActiveBucket] = useState<"school" | "college">("college");
  const [leads, setLeads] = useState<BucketLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bucket counts
  const [schoolCount, setSchoolCount] = useState(0);
  const [collegeCount, setCollegeCount] = useState(0);

  // Self-assign dialog
  const [showAssign, setShowAssign] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Admin: assign to specific counsellor
  const isSuperAdmin = role === "super_admin";
  const isAdminRole = role === "super_admin" || role === "admission_head" || role === "campus_admin" || role === "principal";
  const [counsellors, setCounsellors] = useState<Counsellor[]>([]);
  const [selectedCounsellor, setSelectedCounsellor] = useState<string>("");

  const fetchCounts = async () => {
    // Show ALL unassigned leads — don't filter by campus since many leads have no campus
    const [sRes, cRes] = await Promise.all([
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("bucket", "school"),
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("bucket", "college"),
    ]);
    setSchoolCount(sRes.count ?? 0);
    setCollegeCount(cRes.count ?? 0);
  };

  const fetchLeads = async () => {
    setLoading(true);
    // Don't filter by campus — counsellors need to see all unassigned leads
    const { data, error } = await supabase
      .from("unassigned_leads_bucket" as any)
      .select("*")
      .eq("bucket", activeBucket)
      .order("created_at", { ascending: false });
    if (error) console.error("Lead buckets fetch error:", error);
    setLeads((data || []) as any);
    setSelectedIds(new Set());
    setLoading(false);
  };

  useEffect(() => { fetchCounts(); }, [selectedCampusId]);
  useEffect(() => { fetchLeads(); }, [activeBucket, selectedCampusId]);

  useEffect(() => {
    if (!isAdminRole) return;
    (async () => {
      // Get counsellor user_ids, then fetch their profiles
      // leads.counsellor_id FK → profiles.id, so dropdown values must be profiles.id
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["counsellor", "admission_head"]);
      if (!roles || roles.length === 0) { setCounsellors([]); return; }
      const userIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("user_id", userIds);
      setCounsellors(
        (profiles || []).map((p: any) => ({
          id: p.id, // profiles.id — matches leads.counsellor_id FK
          display_name: p.display_name || "Unknown",
        }))
      );
    })();
  }, [isAdminRole]);

  const filtered = leads.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.name.toLowerCase().includes(q) || (l.course_name || "").toLowerCase().includes(q);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((l) => l.id)));
    }
  };

  const handleAssign = async () => {
    // counsellor_id FK references profiles.id, NOT auth.users.id
    // For self-assign: use profile.id. For admin-assign: selectedCounsellor is already profile.id
    const assignTo = isAdminRole ? selectedCounsellor : profile?.id;
    if (!assignTo) return;

    setAssigning(true);
    const ids = Array.from(selectedIds);

    // Use claim_leads RPC — counsellors can't UPDATE via direct query due to RLS
    // (can_view_lead returns false for unassigned leads). RPC uses SECURITY DEFINER.
    const { data, error } = await supabase.rpc("claim_leads" as any, {
      _lead_ids: ids,
      _assign_to: assignTo,
    });

    if (error) {
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
    } else {
      const result = Array.isArray(data) ? data[0] : data;
      const assignedCount = result?.assigned_count ?? ids.length;
      const failedCount = result?.failed_count ?? 0;
      if (assignedCount === 0) {
        toast({
          title: "No leads assigned",
          description: "These leads may already be assigned to another counsellor.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Leads assigned",
          description: failedCount > 0
            ? `${assignedCount} assigned, ${failedCount} already claimed.`
            : `${assignedCount} lead${assignedCount > 1 ? "s" : ""} assigned successfully.`,
        });
      }
    }
    setAssigning(false);
    setShowAssign(false);
    setSelectedCounsellor("");
    await fetchLeads();
    await fetchCounts();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Lead Buckets</h1>
        <p className="text-sm text-muted-foreground mt-1">Pick up unassigned leads from school or college buckets</p>
      </div>

      {/* Bucket toggle */}
      <div className="flex gap-4">
        {(["school", "college"] as const).map((bucket) => (
          <Card
            key={bucket}
            className={`flex-1 cursor-pointer transition-all hover:shadow-sm ${activeBucket === bucket ? "ring-2 ring-primary/40 bg-primary/5" : "border-border/60"}`}
            onClick={() => setActiveBucket(bucket)}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bucket === "school" ? "bg-pastel-yellow" : "bg-pastel-blue"}`}>
                {bucket === "school" ? <School className="h-6 w-6 text-foreground/70" /> : <GraduationCap className="h-6 w-6 text-foreground/70" />}
              </div>
              <div className="flex-1">
                <p className="text-lg font-bold text-foreground capitalize">{bucket} Leads</p>
                <p className="text-sm text-muted-foreground">Unassigned {bucket} leads</p>
              </div>
              <span className="text-2xl font-bold text-foreground">{bucket === "school" ? schoolCount : collegeCount}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick pick batches */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground mr-1">Quick pick:</span>
          {[5, 10, 15, 20, 30, 50].map((n) => (
            <Button
              key={n}
              variant={selectedIds.size === n ? "default" : "outline"}
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={filtered.length < n}
              onClick={() => {
                const ids = new Set(filtered.slice(0, n).map((l) => l.id));
                setSelectedIds(ids);
              }}
            >
              {n} leads
            </Button>
          ))}
          {selectedIds.size > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" className="gap-2" onClick={() => {
              if (isAdminRole) { setShowAssign(true); } else { handleAssign(); }
            }}>
              <UserPlus className="h-4 w-4" />
              {isAdminRole ? "Assign to Counsellor" : "Assign to Me"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name or course..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <CheckCircle className="h-5 w-5 mr-2" />
          No unassigned {activeBucket} leads
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left w-10">
                  <Checkbox
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Lead</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Campus</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Stage</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr
                  key={lead.id}
                  className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${selectedIds.has(lead.id) ? "bg-primary/5" : ""}`}
                >
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selectedIds.has(lead.id)}
                      onCheckedChange={() => toggleSelect(lead.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{lead.name}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {maskPhone(lead.phone)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-[10px]">
                      {SOURCE_LABELS[lead.source] || lead.source}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.course_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.campus_name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px]">
                      {STAGE_LABELS[lead.stage] || lead.stage}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(lead.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Assign dialog */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Leads to Counsellor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} will be assigned to the selected counsellor.
            </p>
            <select
              value={selectedCounsellor}
              onChange={(e) => setSelectedCounsellor(e.target.value)}
              className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="">Select a counsellor...</option>
              {counsellors.map((c) => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssign(false)}>Cancel</Button>
            <Button
              onClick={handleAssign}
              disabled={assigning || !selectedCounsellor}
              className="gap-2"
            >
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
