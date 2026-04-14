import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Users, Gift, Plus, Loader2, CheckCircle, Clock, UserPlus, Send, IndianRupee,
} from "lucide-react";

interface Referral {
  id: string;
  referred_name: string;
  referred_phone: string;
  referred_email: string | null;
  relationship: string | null;
  status: string;
  reward_type: string | null;
  reward_amount: number | null;
  created_at: string;
  courses?: { name: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending", lead_created: "Lead Created", applied: "Applied",
  admitted: "Admitted", reward_applied: "Reward Applied", expired: "Expired",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700", lead_created: "bg-blue-100 text-blue-700",
  applied: "bg-violet-100 text-violet-700", admitted: "bg-emerald-100 text-emerald-700",
  reward_applied: "bg-green-100 text-green-700", expired: "bg-muted text-muted-foreground",
};

const StudentReferrals = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);

  // Form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("friend");

  // Courses for dropdown
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [courseId, setCourseId] = useState("");

  useEffect(() => {
    (async () => {
      if (!user?.id) return;

      // Find student record for this user
      const { data: student } = await supabase
        .from("students")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (student) setStudentId(student.id);

      // Fetch referrals
      const { data: refs } = await supabase
        .from("student_referrals" as any)
        .select("*, courses:referred_course_id(name)")
        .eq("referrer_user_id", user.id)
        .order("created_at", { ascending: false });
      if (refs) setReferrals(refs as any);

      // Fetch courses for dropdown
      const { data: courseList } = await supabase
        .from("courses")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (courseList) setCourses(courseList);

      setLoading(false);
    })();
  }, [user?.id]);

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim() || !studentId) return;
    setSaving(true);

    const normalizedPhone = phone.replace(/\D/g, "");
    const fullPhone = normalizedPhone.length === 10 ? `+91${normalizedPhone}` : `+${normalizedPhone}`;

    const { error } = await supabase.from("student_referrals" as any).insert({
      referrer_student_id: studentId,
      referrer_user_id: user?.id,
      referred_name: name.trim(),
      referred_phone: fullPhone,
      referred_email: email.trim() || null,
      referred_course_id: courseId || null,
      relationship,
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Referral submitted!", description: `${name.trim()} has been added as your referral.` });
      setShowCreate(false);
      setName(""); setPhone(""); setEmail(""); setCourseId("");
      // Refresh
      const { data } = await supabase
        .from("student_referrals" as any)
        .select("*, courses:referred_course_id(name)")
        .eq("referrer_user_id", user?.id)
        .order("created_at", { ascending: false });
      if (data) setReferrals(data as any);
    }
    setSaving(false);
  };

  // Stats
  const totalReferrals = referrals.length;
  const admittedCount = referrals.filter((r) => ["admitted", "reward_applied"].includes(r.status)).length;
  const totalReward = referrals
    .filter((r) => r.reward_amount && r.status === "reward_applied")
    .reduce((s, r) => s + (r.reward_amount || 0), 0);

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Refer & Earn</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Refer friends & family for admission and earn fee waivers
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <UserPlus className="h-4 w-4" /> Refer Someone
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pastel-blue">
              <Users className="h-6 w-6 text-foreground/70" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{totalReferrals}</p>
              <p className="text-xs text-muted-foreground">Total Referrals</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pastel-green">
              <CheckCircle className="h-6 w-6 text-foreground/70" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{admittedCount}</p>
              <p className="text-xs text-muted-foreground">Successful Admissions</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pastel-purple">
              <Gift className="h-6 w-6 text-foreground/70" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">₹{totalReward.toLocaleString("en-IN")}</p>
              <p className="text-xs text-muted-foreground">Total Rewards Earned</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* How it works */}
      <Card className="border-border/60 shadow-none bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">How it works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[
              { step: "1", title: "Refer", desc: "Submit your friend's details" },
              { step: "2", title: "They Apply", desc: "Your friend gets contacted & applies" },
              { step: "3", title: "Admission", desc: "Once admitted, you earn rewards" },
              { step: "4", title: "Fee Waiver", desc: "Reward applied to your fees" },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                  {s.step}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Referral list */}
      {referrals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No referrals yet. Start referring to earn fee waivers!</p>
        </div>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Referred Person</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Course</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Relationship</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Reward</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{r.referred_name}</p>
                      <p className="text-[10px] text-muted-foreground">{r.referred_phone}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {(r.courses as any)?.name || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">
                      {r.relationship || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] border-0 ${STATUS_COLORS[r.status] || "bg-muted"}`}>
                        {STATUS_LABELS[r.status] || r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs">
                      {r.reward_amount ? (
                        <span className="text-emerald-600 font-semibold">₹{r.reward_amount.toLocaleString("en-IN")}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              Refer a Friend
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" className={inputCls} type="tel" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email (optional)</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className={inputCls} type="email" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course Interest</label>
              <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={inputCls}>
                <option value="">Select course (optional)</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Relationship</label>
              <select value={relationship} onChange={(e) => setRelationship(e.target.value)} className={inputCls}>
                <option value="friend">Friend</option>
                <option value="relative">Relative</option>
                <option value="classmate">Classmate</option>
                <option value="neighbor">Neighbor</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!name.trim() || !phone.trim() || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Referral
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StudentReferrals;
