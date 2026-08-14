import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, Fingerprint, Users, Palmtree, Search } from "lucide-react";

// HR self-service. This is the entire app for the non_teaching role, and the
// "my own record" view for everyone else — hence permission hr:self, which is
// deliberately NOT hr:view (that unlocks everyone's leave and attendance).

interface AttendanceRow { id: string; date: string; punch_in: string | null; punch_out: string | null; }
interface LeaveRow {
  id: string; leave_type: string; start_date: string; end_date: string;
  days: number; reason: string | null; status: string;
}
interface BalanceRow { leave_type: string; total_days: number; used_days: number; year: number; }
interface Holiday { id: string; name: string; holiday_date: string; kind: string; }
interface DirectoryRow {
  user_id: string; display_name: string | null; designation: string | null;
  department: string | null; campus: string | null; work_email: string | null;
}

const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid"];

const MyHr = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [directory, setDirectory] = useState<DirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirFilter, setDirFilter] = useState("");

  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState({ leave_type: "casual", start_date: "", end_date: "", reason: "" });

  useEffect(() => { if (user?.id) void load(); }, [user?.id]);

  const load = async () => {
    setLoading(true);
    const year = new Date().getFullYear();
    const [att, lv, bal, hol, dir] = await Promise.all([
      supabase.from("employee_attendance")
        .select("id, date, punch_in, punch_out")
        .eq("user_id", user!.id).order("date", { ascending: false }).limit(30),
      supabase.from("employee_leave_requests")
        .select("id, leave_type, start_date, end_date, days, reason, status")
        .eq("user_id", user!.id).order("start_date", { ascending: false }),
      supabase.from("employee_leave_balances")
        .select("leave_type, total_days, used_days, year")
        .eq("user_id", user!.id).eq("year", year),
      supabase.from("holidays")
        .select("id, name, holiday_date, kind")
        .gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`)
        .order("holiday_date"),
      supabase.rpc("hr_staff_directory"),
    ]);

    setAttendance((att.data as AttendanceRow[]) || []);
    setLeave((lv.data as LeaveRow[]) || []);
    setBalances((bal.data as BalanceRow[]) || []);
    setHolidays((hol.data as Holiday[]) || []);
    setDirectory((dir.data as DirectoryRow[]) || []);
    setLoading(false);
  };

  // Inclusive day count — a one-day leave is 1 day, not 0.
  const draftDays = useMemo(() => {
    if (!draft.start_date || !draft.end_date) return 0;
    const start = new Date(draft.start_date);
    const end = new Date(draft.end_date);
    if (end < start) return 0;
    return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  }, [draft.start_date, draft.end_date]);

  const applyLeave = async () => {
    if (draftDays < 1) {
      toast({ title: "Pick a valid date range", variant: "destructive" });
      return;
    }
    setApplying(true);
    const { data, error } = await supabase.from("employee_leave_requests").insert({
      user_id: user!.id,
      leave_type: draft.leave_type,
      start_date: draft.start_date,
      end_date: draft.end_date,
      days: draftDays,
      reason: draft.reason.trim() || null,
      status: "pending",
    }).select().single();
    setApplying(false);
    if (error) {
      toast({ title: "Could not apply", description: error.message, variant: "destructive" });
      return;
    }
    setLeave(prev => [data as LeaveRow, ...prev]);
    setDraft({ leave_type: "casual", start_date: "", end_date: "", reason: "" });
    toast({ title: "Leave request submitted" });
  };

  const cancelLeave = async (row: LeaveRow) => {
    const { data, error } = await supabase.from("employee_leave_requests")
      .update({ status: "cancelled" }).eq("id", row.id).select("id");
    if (error || !data?.length) {
      toast({
        title: "Could not cancel",
        description: error?.message || "Only pending requests can be cancelled.",
        variant: "destructive",
      });
      return;
    }
    setLeave(prev => prev.map(r => (r.id === row.id ? { ...r, status: "cancelled" } : r)));
  };

  const visibleDirectory = useMemo(() => {
    if (!dirFilter.trim()) return directory;
    const q = dirFilter.toLowerCase();
    return directory.filter(d =>
      [d.display_name, d.designation, d.department, d.campus].some(v => v?.toLowerCase().includes(q)));
  }, [directory, dirFilter]);

  const upcomingHolidays = holidays.filter(h => h.holiday_date >= new Date().toISOString().slice(0, 10));

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-foreground">My HR</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {profile?.display_name ? `${profile.display_name}'s` : "Your"} attendance, leave, colleagues and holidays
        </p>
      </div>

      <Tabs defaultValue="attendance" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          {[
            ["attendance", "My Attendance"],
            ["leave", "My Leave"],
            ["directory", "Directory"],
            ["holidays", "Holidays"],
          ].map(([v, label]) => (
            <TabsTrigger key={v} value={v}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="attendance" className="mt-6">
          {attendance.length === 0 ? (
            <Empty icon={Fingerprint} text="No attendance recorded yet" />
          ) : (
            <div className="rounded-xl border border-border overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <Th>Date</Th><Th>Punch in</Th><Th>Punch out</Th><Th>Hours</Th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map(a => (
                    <tr key={a.id} className="hover:bg-muted/20">
                      <Td>{new Date(a.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}</Td>
                      <Td>{a.punch_in ? new Date(a.punch_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</Td>
                      <Td>{a.punch_out ? new Date(a.punch_out).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</Td>
                      <Td>
                        {a.punch_in && a.punch_out
                          ? `${((new Date(a.punch_out).getTime() - new Date(a.punch_in).getTime()) / 3_600_000).toFixed(1)}h`
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="leave" className="mt-6 space-y-4">
          {balances.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {balances.map(b => (
                <div key={b.leave_type} className="rounded-xl bg-card card-shadow p-3.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{b.leave_type}</p>
                  <p className="text-lg font-bold text-foreground mt-0.5">{b.total_days - b.used_days}</p>
                  <p className="text-[10px] text-muted-foreground">of {b.total_days} days left</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
            <Field label="Type">
              <select value={draft.leave_type} onChange={e => setDraft({ ...draft, leave_type: e.target.value })}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-ring/20">
                {LEAVE_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </Field>
            <Field label="From">
              <input type="date" value={draft.start_date}
                onChange={e => setDraft({ ...draft, start_date: e.target.value })}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20" />
            </Field>
            <Field label="To">
              <input type="date" value={draft.end_date} min={draft.start_date || undefined}
                onChange={e => setDraft({ ...draft, end_date: e.target.value })}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20" />
            </Field>
            <Field label="Reason">
              <input value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })}
                placeholder="Optional"
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-ring/20" />
            </Field>
            <Button size="sm" className="h-8 text-xs" onClick={applyLeave} disabled={applying || draftDays < 1}>
              Apply{draftDays > 0 ? ` (${draftDays}d)` : ""}
            </Button>
          </div>

          {leave.length === 0 ? (
            <Empty icon={CalendarDays} text="No leave requests yet" />
          ) : (
            <div className="rounded-xl border border-border overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr><Th>Type</Th><Th>Dates</Th><Th>Days</Th><Th>Reason</Th><Th>Status</Th><Th /></tr>
                </thead>
                <tbody>
                  {leave.map(r => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <Td className="capitalize">{r.leave_type}</Td>
                      <Td>{r.start_date} → {r.end_date}</Td>
                      <Td>{r.days}</Td>
                      <Td>{r.reason || "—"}</Td>
                      <Td>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                          r.status === "approved" ? "bg-success/15 text-success" :
                          r.status === "rejected" ? "bg-destructive/15 text-destructive" :
                          r.status === "cancelled" ? "bg-muted text-muted-foreground" :
                          "bg-warning/15 text-warning"
                        }`}>{r.status}</span>
                      </Td>
                      <Td>
                        {r.status === "pending" && (
                          <button onClick={() => cancelLeave(r)}
                            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">
                            Cancel
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="directory" className="mt-6 space-y-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={dirFilter} onChange={e => setDirFilter(e.target.value)}
              placeholder="Search name, designation, department…"
              className="w-full rounded-lg border border-input bg-background py-1.5 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20" />
          </div>
          {visibleDirectory.length === 0 ? (
            <Empty icon={Users} text="No colleagues found" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleDirectory.map(d => (
                <div key={d.user_id} className="rounded-xl bg-card card-shadow p-3.5">
                  <p className="text-sm font-semibold text-foreground truncate">{d.display_name || "—"}</p>
                  {/* Designation, not role — what they're called, not what they can access. */}
                  <p className="text-xs text-muted-foreground truncate">{d.designation || "—"}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1 truncate">
                    {[d.department, d.campus].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="holidays" className="mt-6">
          {upcomingHolidays.length === 0 ? (
            <Empty icon={Palmtree} text="No upcoming holidays listed" />
          ) : (
            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
              {upcomingHolidays.map(h => (
                <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-10 w-10 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                    <span className="text-[9px] uppercase leading-none">
                      {new Date(h.holiday_date).toLocaleDateString("en-IN", { month: "short" })}
                    </span>
                    <span className="text-sm font-bold leading-tight">{new Date(h.holiday_date).getDate()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{h.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{h.kind}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">{children}</th>
);
const Td = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
  <td className={`px-3 py-2 border-b border-border/30 text-foreground ${className}`}>{children}</td>
);
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    {children}
  </div>
);
const Empty = ({ icon: Icon, text }: { icon: typeof Users; text: string }) => (
  <div className="rounded-xl bg-card card-shadow p-12 text-center">
    <Icon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
    <p className="text-sm text-muted-foreground">{text}</p>
  </div>
);

export default MyHr;
