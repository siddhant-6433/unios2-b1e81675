import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plus, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp,
  Heart, Megaphone, Scale, Rocket, Leaf, Users, ClipboardList,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Batch {
  id: string;
  name: string;
}

interface ActionEntry {
  id: string;
  student_id: string;
  title: string;
  description: string | null;
  action_type: string;
  status: string;
  evidence_url: string | null;
  linked_unit: string | null;
  created_at: string;
  students: { name: string; admission_no: string | null } | null;
}

interface ServiceEntry {
  id: string;
  student_id: string;
  title: string;
  description: string | null;
  activity_type: string | null;
  supervisor_name: string | null;
  supervisor_comment: string | null;
  hours: number | null;
  learning_outcomes: string[];
  reflections: string[];
  status: string;
  created_at: string;
  students: { name: string; admission_no: string | null } | null;
}

const ACTION_TYPES = [
  { value: "participation", label: "Participation", icon: Users },
  { value: "advocacy", label: "Advocacy", icon: Megaphone },
  { value: "social_justice", label: "Social Justice", icon: Scale },
  { value: "social_entrepreneurship", label: "Social Entrepreneurship", icon: Rocket },
  { value: "lifestyle_choice", label: "Lifestyle Choice", icon: Leaf },
];

const ACTION_TYPE_COLORS: Record<string, string> = {
  participation: "bg-pastel-blue text-foreground/70",
  advocacy: "bg-pastel-purple text-foreground/70",
  social_justice: "bg-pastel-yellow text-foreground/70",
  social_entrepreneurship: "bg-pastel-green text-foreground/70",
  lifestyle_choice: "bg-pastel-mint text-foreground/70",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-pastel-blue text-foreground/70",
  approved: "bg-pastel-green text-foreground/70",
  rejected: "bg-pastel-red text-foreground/70",
};

const MYP_LEARNING_OUTCOMES = [
  "Become more aware of your own strengths and areas for growth",
  "Undertake challenges that develop new skills",
  "Discuss, evaluate, and plan student-initiated activities",
  "Persevere in action",
  "Work collaboratively with others",
  "Develop international-mindedness through global engagement, multilingualism, and intercultural understanding",
  "Consider the ethical implications of your actions",
];

const INPUT_CLASS = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// ── Component ────────────────────────────────────────────────────────────────

const ActionService = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [actionBatchId, setActionBatchId] = useState<string>("");
  const [serviceBatchId, setServiceBatchId] = useState<string>("");
  const [batchStudents, setBatchStudents] = useState<{ id: string; name: string }[]>([]);
  const [serviceBatchStudents, setServiceBatchStudents] = useState<{ id: string; name: string }[]>([]);

  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [loadingActions, setLoadingActions] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);

  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);

  // Add Action dialog
  const [showAddAction, setShowAddAction] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [actionStudentId, setActionStudentId] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionType, setActionType] = useState("participation");
  const [actionEvidenceUrl, setActionEvidenceUrl] = useState("");
  const [actionLinkedUnit, setActionLinkedUnit] = useState("");

  // Add Service dialog
  const [showAddService, setShowAddService] = useState(false);
  const [savingService, setSavingService] = useState(false);
  const [serviceStudentId, setServiceStudentId] = useState("");
  const [serviceTitle, setServiceTitle] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [serviceActivityType, setServiceActivityType] = useState("");
  const [serviceSupervisor, setServiceSupervisor] = useState("");
  const [serviceHours, setServiceHours] = useState("");

  // ── Fetch batches ──────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("batches").select("id, name").order("name");
      if (data && data.length) {
        setBatches(data);
        setActionBatchId(data[0].id);
        setServiceBatchId(data[0].id);
      } else {
        setLoadingActions(false);
        setLoadingServices(false);
      }
    })();
  }, []);

  // ── Fetch students for action batch ────────────────────────────────────────

  useEffect(() => {
    if (!actionBatchId) return;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id, name")
        .eq("batch_id", actionBatchId)
        .eq("status", "active")
        .order("name");
      setBatchStudents(data || []);
    })();
  }, [actionBatchId]);

  // ── Fetch students for service batch ───────────────────────────────────────

  useEffect(() => {
    if (!serviceBatchId) return;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id, name")
        .eq("batch_id", serviceBatchId)
        .eq("status", "active")
        .order("name");
      setServiceBatchStudents(data || []);
    })();
  }, [serviceBatchId]);

  // ── Fetch actions ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!actionBatchId) return;
    (async () => {
      setLoadingActions(true);
      // Get student ids in batch first
      const { data: studs } = await supabase
        .from("students")
        .select("id")
        .eq("batch_id", actionBatchId)
        .eq("status", "active");
      const ids = (studs || []).map((s) => s.id);
      if (!ids.length) {
        setActions([]);
        setLoadingActions(false);
        return;
      }
      const { data } = await (supabase as any)
        .from("ib_action_journal")
        .select("*, students(name, admission_no)")
        .in("student_id", ids)
        .order("created_at", { ascending: false });
      setActions(data || []);
      setLoadingActions(false);
    })();
  }, [actionBatchId]);

  // ── Fetch services ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!serviceBatchId) return;
    (async () => {
      setLoadingServices(true);
      const { data: studs } = await supabase
        .from("students")
        .select("id")
        .eq("batch_id", serviceBatchId)
        .eq("status", "active");
      const ids = (studs || []).map((s) => s.id);
      if (!ids.length) {
        setServices([]);
        setLoadingServices(false);
        return;
      }
      const { data } = await (supabase as any)
        .from("ib_service_as_action")
        .select("*, students(name, admission_no)")
        .in("student_id", ids)
        .order("created_at", { ascending: false });
      setServices(data || []);
      setLoadingServices(false);
    })();
  }, [serviceBatchId]);

  // ── Add Action ─────────────────────────────────────────────────────────────

  const handleAddAction = async () => {
    if (!actionStudentId || !actionTitle) {
      toast({ title: "Student and title are required", variant: "destructive" });
      return;
    }
    setSavingAction(true);
    const { error } = await (supabase as any).from("ib_action_journal").insert({
      student_id: actionStudentId,
      title: actionTitle,
      description: actionDescription,
      action_type: actionType,
      evidence_url: actionEvidenceUrl || null,
      linked_unit: actionLinkedUnit || null,
      status: "draft",
      created_by: user?.id,
    });
    setSavingAction(false);
    if (error) {
      toast({ title: "Failed to add action", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Action entry added" });
      setShowAddAction(false);
      resetActionForm();
      setActionBatchId((prev) => { const v = prev; setActionBatchId(""); setTimeout(() => setActionBatchId(v), 0); return prev; });
    }
  };

  const resetActionForm = () => {
    setActionStudentId("");
    setActionTitle("");
    setActionDescription("");
    setActionType("participation");
    setActionEvidenceUrl("");
    setActionLinkedUnit("");
  };

  // ── Add Service ────────────────────────────────────────────────────────────

  const handleAddService = async () => {
    if (!serviceStudentId || !serviceTitle) {
      toast({ title: "Student and title are required", variant: "destructive" });
      return;
    }
    setSavingService(true);
    const { error } = await (supabase as any).from("ib_service_as_action").insert({
      student_id: serviceStudentId,
      title: serviceTitle,
      description: serviceDescription,
      activity_type: serviceActivityType || null,
      supervisor_name: serviceSupervisor || null,
      hours: serviceHours ? parseFloat(serviceHours) : null,
      learning_outcomes: [],
      reflections: [],
      status: "draft",
      created_by: user?.id,
    });
    setSavingService(false);
    if (error) {
      toast({ title: "Failed to add service", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Service entry added" });
      setShowAddService(false);
      resetServiceForm();
      setServiceBatchId((prev) => { const v = prev; setServiceBatchId(""); setTimeout(() => setServiceBatchId(v), 0); return prev; });
    }
  };

  const resetServiceForm = () => {
    setServiceStudentId("");
    setServiceTitle("");
    setServiceDescription("");
    setServiceActivityType("");
    setServiceSupervisor("");
    setServiceHours("");
  };

  // ── Approve/Reject Action ──────────────────────────────────────────────────

  const updateActionStatus = async (id: string, status: string) => {
    const { error } = await (supabase as any)
      .from("ib_action_journal")
      .update({ status })
      .eq("id", id);
    if (error) {
      toast({ title: "Failed to update status", variant: "destructive" });
    } else {
      setActions((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
      toast({ title: `Action ${status}` });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Action & Service</h1>
        <p className="text-sm text-muted-foreground mt-1">PYP Action Journal & MYP Service as Action</p>
      </div>

      <Tabs defaultValue="action">
        <TabsList className="rounded-xl">
          <TabsTrigger value="action" className="rounded-lg gap-1.5">
            <Heart className="h-3.5 w-3.5" /> PYP Action
          </TabsTrigger>
          <TabsTrigger value="service" className="rounded-lg gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" /> MYP Service
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* PYP Action Tab                                                    */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="action">
          <div className="space-y-4 mt-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <Select value={actionBatchId} onValueChange={setActionBatchId}>
                <SelectTrigger className="w-full sm:w-64 rounded-xl">
                  <SelectValue placeholder="Select batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => setShowAddAction(true)} className="rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Add Action
              </Button>
            </div>

            {loadingActions ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : actions.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Heart className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>No action entries yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {actions.map((a) => {
                  const typeInfo = ACTION_TYPES.find((t) => t.value === a.action_type);
                  const TypeIcon = typeInfo?.icon || Heart;
                  return (
                    <Card key={a.id} className="rounded-xl border-border bg-card">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${ACTION_TYPE_COLORS[a.action_type] || "bg-muted"}`}>
                            <TypeIcon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-medium text-foreground">{a.title}</h4>
                              <Badge className={`text-xs rounded-lg ${ACTION_TYPE_COLORS[a.action_type] || ""}`}>
                                {typeInfo?.label || a.action_type}
                              </Badge>
                              <Badge className={`text-xs rounded-lg ${STATUS_COLORS[a.status] || ""}`}>
                                {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {a.students?.name || "Unknown student"}
                              {a.students?.admission_no && ` (${a.students.admission_no})`}
                            </p>
                            {a.description && (
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{a.description}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground">
                              {new Date(a.created_at).toLocaleDateString()}
                            </span>
                            {a.status === "submitted" && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => updateActionStatus(a.id, "approved")}
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => updateActionStatus(a.id, "rejected")}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* MYP Service Tab                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="service">
          <div className="space-y-4 mt-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <Select value={serviceBatchId} onValueChange={setServiceBatchId}>
                <SelectTrigger className="w-full sm:w-64 rounded-xl">
                  <SelectValue placeholder="Select batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => setShowAddService(true)} className="rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Add Service
              </Button>
            </div>

            {loadingServices ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : services.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>No service entries yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {services.map((s) => {
                  const achievedCount = (s.learning_outcomes || []).length;
                  const isExpanded = expandedServiceId === s.id;
                  return (
                    <Card
                      key={s.id}
                      className="rounded-xl border-border bg-card cursor-pointer hover:shadow-sm transition-shadow"
                      onClick={() => setExpandedServiceId(isExpanded ? null : s.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-pastel-green text-foreground/70">
                            <ClipboardList className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-medium text-foreground">{s.title}</h4>
                              {s.activity_type && (
                                <Badge variant="outline" className="text-xs rounded-lg">{s.activity_type}</Badge>
                              )}
                              <Badge className={`text-xs rounded-lg ${STATUS_COLORS[s.status] || ""}`}>
                                {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {s.students?.name || "Unknown student"}
                              {s.hours != null && <span className="ml-2">&middot; {s.hours}h</span>}
                              <span className="ml-2">&middot; {achievedCount}/7 outcomes</span>
                            </p>

                            {/* Progress bar */}
                            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden w-32">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${(achievedCount / 7) * 100}%` }}
                              />
                            </div>

                            {isExpanded && (
                              <div className="mt-4 space-y-4 border-t border-border pt-4">
                                {s.description && (
                                  <p className="text-sm text-foreground whitespace-pre-wrap">{s.description}</p>
                                )}

                                {/* Learning outcomes checklist */}
                                <div>
                                  <h5 className="text-sm font-medium text-foreground mb-2">Learning Outcomes</h5>
                                  <div className="space-y-1.5">
                                    {MYP_LEARNING_OUTCOMES.map((outcome, idx) => {
                                      const achieved = (s.learning_outcomes || []).includes(String(idx));
                                      return (
                                        <div key={idx} className="flex items-start gap-2">
                                          <div className={`h-4 w-4 rounded-sm border flex items-center justify-center shrink-0 mt-0.5 ${achieved ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                                            {achieved && <CheckCircle className="h-3 w-3" />}
                                          </div>
                                          <span className={`text-sm ${achieved ? "text-foreground" : "text-muted-foreground"}`}>
                                            {outcome}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Reflections */}
                                {(s.reflections || []).length > 0 && (
                                  <div>
                                    <h5 className="text-sm font-medium text-foreground mb-2">Reflections</h5>
                                    <div className="space-y-2">
                                      {s.reflections.map((r, idx) => (
                                        <div key={idx} className="bg-muted/50 rounded-lg p-3">
                                          <p className="text-sm text-foreground">{r}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Supervisor comment */}
                                {s.supervisor_comment && (
                                  <div className="bg-muted/50 rounded-lg p-3">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">
                                      Supervisor: {s.supervisor_name || "N/A"}
                                    </p>
                                    <p className="text-sm text-foreground">{s.supervisor_comment}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-xs text-muted-foreground">
                              {new Date(s.created_at).toLocaleDateString()}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Add Action Dialog ───────────────────────────────────────────────── */}
      <Dialog open={showAddAction} onOpenChange={setShowAddAction}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>Add Action Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Student</label>
              <Select value={actionStudentId} onValueChange={setActionStudentId}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select student" /></SelectTrigger>
                <SelectContent>
                  {batchStudents.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Title</label>
              <input className={INPUT_CLASS} value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} placeholder="Action title" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Description</label>
              <textarea className={`${INPUT_CLASS} min-h-[80px] resize-y`} value={actionDescription} onChange={(e) => setActionDescription(e.target.value)} placeholder="Describe this action..." />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Action Type</label>
              <Select value={actionType} onValueChange={setActionType}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Evidence URL</label>
              <input className={INPUT_CLASS} value={actionEvidenceUrl} onChange={(e) => setActionEvidenceUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Linked Unit</label>
              <input className={INPUT_CLASS} value={actionLinkedUnit} onChange={(e) => setActionLinkedUnit(e.target.value)} placeholder="Unit of inquiry name" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowAddAction(false)}>Cancel</Button>
            <Button className="rounded-xl gap-2" onClick={handleAddAction} disabled={savingAction}>
              {savingAction && <Loader2 className="h-4 w-4 animate-spin" />} Save Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Service Dialog ──────────────────────────────────────────────── */}
      <Dialog open={showAddService} onOpenChange={setShowAddService}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>Add Service Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Student</label>
              <Select value={serviceStudentId} onValueChange={setServiceStudentId}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select student" /></SelectTrigger>
                <SelectContent>
                  {serviceBatchStudents.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Title</label>
              <input className={INPUT_CLASS} value={serviceTitle} onChange={(e) => setServiceTitle(e.target.value)} placeholder="Service title" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Description</label>
              <textarea className={`${INPUT_CLASS} min-h-[80px] resize-y`} value={serviceDescription} onChange={(e) => setServiceDescription(e.target.value)} placeholder="Describe this service activity..." />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Activity Type</label>
              <input className={INPUT_CLASS} value={serviceActivityType} onChange={(e) => setServiceActivityType(e.target.value)} placeholder="e.g. Community service, Environmental..." />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Supervisor Name</label>
              <input className={INPUT_CLASS} value={serviceSupervisor} onChange={(e) => setServiceSupervisor(e.target.value)} placeholder="Supervisor name" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Hours</label>
              <input className={INPUT_CLASS} type="number" min="0" step="0.5" value={serviceHours} onChange={(e) => setServiceHours(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowAddService(false)}>Cancel</Button>
            <Button className="rounded-xl gap-2" onClick={handleAddService} disabled={savingService}>
              {savingService && <Loader2 className="h-4 w-4 animate-spin" />} Save Service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ActionService;
