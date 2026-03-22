import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2, MapPin, Layers, Pencil, Check, X, Plus, Loader2,
  ChevronDown, ChevronRight, Users,
} from "lucide-react";

// ── Local interfaces ──────────────────────────────────────────────────────

interface InstitutionGroup {
  id: string;
  name: string;
  code: string;
  description: string | null;
  created_at: string;
}

interface Campus {
  id: string;
  name: string;
  code: string;
}

interface Institution {
  id: string;
  name: string;
  code: string;
  campus_id: string;
}

interface Department {
  id: string;
  institution_id: string;
}

interface Course {
  id: string;
  department_id: string;
}

interface GroupMember {
  id: string;
  group_id: string;
  institution_id: string;
  institution: {
    id: string;
    name: string;
    code: string;
    campus_id: string;
    campus: { id: string; name: string; code: string } | null;
  } | null;
}

type ViewMode = "groups" | "campuses" | "institutions";

// ── Shared style constants ────────────────────────────────────────────────

const inputCls =
  "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const amberBadge =
  "inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";

const blueBadge =
  "inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";

const grayBadge =
  "inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground";

// ── Component ─────────────────────────────────────────────────────────────

export default function FinancialGroupsPanel() {
  const { toast } = useToast();

  // Data
  const [groups, setGroups] = useState<InstitutionGroup[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  // View
  const [view, setView] = useState<ViewMode>("groups");

  // Expand state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedCampuses, setExpandedCampuses] = useState<Set<string>>(new Set());
  const [expandedInstitutions, setExpandedInstitutions] = useState<Set<string>>(new Set());

  // Add group
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: "", code: "", description: "" });

  // Edit group
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<Partial<InstitutionGroup>>({});

  // Manage members
  const [managingMembersFor, setManagingMembersFor] = useState<string | null>(null);

  // ── Fetch ───────────────────────────────────────────────────────────────

  const fetchAll = async () => {
    setLoading(true);
    const [gRes, mRes, cRes, iRes, dRes, coRes] = await Promise.all([
      supabase.from("institution_groups" as any).select("*").order("name"),
      supabase.from("institution_group_members" as any).select(`
        id, group_id, institution_id,
        institutions ( id, name, code, campus_id,
          campuses ( id, name, code )
        )
      `),
      supabase.from("campuses").select("id, name, code").order("name"),
      supabase.from("institutions").select("id, name, code, campus_id").order("name"),
      supabase.from("departments").select("id, institution_id"),
      supabase.from("courses").select("id, department_id"),
    ]);

    if (gRes.data) setGroups(gRes.data as unknown as InstitutionGroup[]);
    if (mRes.data) {
      const mapped = (mRes.data as any[]).map((row: any) => ({
        id: row.id,
        group_id: row.group_id,
        institution_id: row.institution_id,
        institution: row.institutions
          ? {
              id: row.institutions.id,
              name: row.institutions.name,
              code: row.institutions.code,
              campus_id: row.institutions.campus_id,
              campus: row.institutions.campuses ?? null,
            }
          : null,
      }));
      setMembers(mapped);
    }
    if (cRes.data) setCampuses(cRes.data as Campus[]);
    if (iRes.data) setInstitutions(iRes.data as Institution[]);
    if (dRes.data) setDepartments(dRes.data as Department[]);
    if (coRes.data) setCourses(coRes.data as Course[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Helper functions ────────────────────────────────────────────────────

  const institutionCount = (groupId: string) =>
    members.filter((m) => m.group_id === groupId).length;

  const courseCount = (institutionId: string) => {
    const deptIds = departments
      .filter((d) => d.institution_id === institutionId)
      .map((d) => d.id);
    return courses.filter((c) => deptIds.includes(c.department_id)).length;
  };

  const campusCourseCount = (campusId: string) => {
    const instIds = institutions
      .filter((i) => i.campus_id === campusId)
      .map((i) => i.id);
    return instIds.reduce((sum, id) => sum + courseCount(id), 0);
  };

  const groupForInstitution = (institutionId: string): InstitutionGroup | null => {
    const member = members.find((m) => m.institution_id === institutionId);
    if (!member) return null;
    return groups.find((g) => g.id === member.group_id) ?? null;
  };

  // ── Toggle helpers ──────────────────────────────────────────────────────

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setFn(next);
  };

  // ── CRUD ────────────────────────────────────────────────────────────────

  const addGroup = async () => {
    if (!newGroup.name || !newGroup.code) return;
    const { error } = await supabase
      .from("institution_groups" as any)
      .insert({ name: newGroup.name, code: newGroup.code.toUpperCase(), description: newGroup.description || null });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Group added" });
    setAddingGroup(false);
    setNewGroup({ name: "", code: "", description: "" });
    fetchAll();
  };

  const saveGroup = async (id: string) => {
    const { error } = await supabase
      .from("institution_groups" as any)
      .update({ name: groupDraft.name, description: groupDraft.description })
      .eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Group updated" });
    setEditingGroup(null);
    fetchAll();
  };

  const toggleMember = async (groupId: string, institutionId: string) => {
    const existing = members.find(
      (m) => m.group_id === groupId && m.institution_id === institutionId
    );
    if (existing) {
      await supabase.from("institution_group_members" as any).delete().eq("id", existing.id);
    } else {
      await supabase
        .from("institution_group_members" as any)
        .insert({ group_id: groupId, institution_id: institutionId });
    }
    fetchAll();
  };

  // ── Loading state ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderGroupsView = () => (
    <div className="space-y-3">
      {/* Add group button / form */}
      {addingGroup ? (
        <Card className="border border-input">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold text-foreground">New Financial Group</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className={inputCls}
                placeholder="Group name"
                value={newGroup.name}
                onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="Code (e.g. CEDS)"
                value={newGroup.code}
                onChange={(e) => setNewGroup({ ...newGroup, code: e.target.value.toUpperCase() })}
              />
              <input
                className={inputCls}
                placeholder="Description (optional)"
                value={newGroup.description}
                onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={addGroup}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Check className="h-3.5 w-3.5" /> Save Group
              </button>
              <button
                onClick={() => { setAddingGroup(false); setNewGroup({ name: "", code: "", description: "" }); }}
                className="flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <button
          onClick={() => setAddingGroup(true)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-input px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Group
        </button>
      )}

      {groups.map((group) => {
        const isExpanded = expandedGroups.has(group.id);
        const isEditing = editingGroup === group.id;
        const isManaging = managingMembersFor === group.id;
        const groupMembers = members.filter((m) => m.group_id === group.id);

        return (
          <Card key={group.id} className="border border-input overflow-hidden">
            {/* Header row */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => !isEditing && !isManaging && toggle(expandedGroups, setExpandedGroups, group.id)}
            >
              <Layers className="h-4 w-4 text-muted-foreground shrink-0" />

              {isEditing ? (
                <div className="flex items-center gap-2 flex-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    className={inputCls + " flex-1"}
                    value={groupDraft.name ?? ""}
                    onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                    placeholder="Group name"
                  />
                  <input
                    className={inputCls + " flex-1"}
                    value={groupDraft.description ?? ""}
                    onChange={(e) => setGroupDraft({ ...groupDraft, description: e.target.value })}
                    placeholder="Description"
                  />
                  <button
                    onClick={() => saveGroup(group.id)}
                    className="rounded-lg bg-primary/10 p-1.5 text-primary hover:bg-primary/20 transition-colors"
                    title="Save"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingGroup(null)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                    title="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="font-semibold text-sm text-foreground flex-1">{group.name}</span>
                  <span className={blueBadge}>{group.code}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {institutionCount(group.id)} institution{institutionCount(group.id) !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingGroup(group.id);
                      setGroupDraft({ name: group.name, description: group.description ?? "" });
                    }}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Edit group"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setManagingMembersFor(isManaging ? null : group.id);
                      if (!isManaging) setExpandedGroups((prev) => new Set([...prev, group.id]));
                    }}
                    className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                  >
                    Manage Members
                  </button>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </>
              )}
            </div>

            {/* Member management panel */}
            {isManaging && (
              <div className="border-t border-input bg-muted/20 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Select Institutions
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {institutions.map((inst) => {
                    const isMember = members.some(
                      (m) => m.group_id === group.id && m.institution_id === inst.id
                    );
                    const campus = campuses.find((c) => c.id === inst.campus_id);
                    return (
                      <label
                        key={inst.id}
                        className="flex items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isMember}
                          onChange={() => toggleMember(group.id, inst.id)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        <span className="text-sm text-foreground flex-1">{inst.name}</span>
                        <span className={amberBadge}>{inst.code}</span>
                        {campus && (
                          <span className="text-[11px] text-muted-foreground">{campus.code}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <button
                  onClick={() => setManagingMembersFor(null)}
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Done
                </button>
              </div>
            )}

            {/* Expanded member list */}
            {isExpanded && !isManaging && (
              <div className="border-t border-input">
                {groupMembers.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground italic">No institutions in this group.</p>
                ) : (
                  groupMembers.map((m) => {
                    if (!m.institution) return null;
                    const inst = m.institution;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center gap-3 px-4 py-2.5 border-b border-input/50 last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground flex-1">{inst.name}</span>
                        <span className={amberBadge}>{inst.code}</span>
                        {inst.campus && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {inst.campus.name}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {courseCount(inst.id)} courses
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );

  const renderCampusesView = () => (
    <div className="space-y-2">
      {campuses.map((campus) => {
        const isExpanded = expandedCampuses.has(campus.id);
        const campusInstitutions = institutions.filter((i) => i.campus_id === campus.id);
        const totalCourses = campusCourseCount(campus.id);

        return (
          <Card key={campus.id} className="border border-input overflow-hidden">
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => toggle(expandedCampuses, setExpandedCampuses, campus.id)}
            >
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-semibold text-sm text-foreground flex-1">{campus.name}</span>
              <span className={grayBadge}>{campus.code}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {campusInstitutions.length} institution{campusInstitutions.length !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {totalCourses} courses
              </span>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </div>

            {isExpanded && (
              <div className="border-t border-input">
                {campusInstitutions.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground italic">No institutions.</p>
                ) : (
                  campusInstitutions.map((inst) => {
                    const grp = groupForInstitution(inst.id);
                    return (
                      <div
                        key={inst.id}
                        className="flex items-center gap-3 px-4 py-2.5 border-b border-input/50 last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground flex-1">{inst.name}</span>
                        <span className={amberBadge}>{inst.code}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {courseCount(inst.id)} courses
                        </span>
                        {grp ? (
                          <span className={blueBadge}>{grp.code}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">No group</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );

  const renderInstitutionsView = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {institutions.map((inst) => {
        const campus = campuses.find((c) => c.id === inst.campus_id);
        const grp = groupForInstitution(inst.id);
        const cc = courseCount(inst.id);
        return (
          <Card key={inst.id} className="border border-input">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-semibold text-sm text-foreground truncate">{inst.name}</span>
                </div>
                <span className={amberBadge + " shrink-0"}>{inst.code}</span>
              </div>
              {campus && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{campus.name}</span>
                  <span className={grayBadge + " ml-1"}>{campus.code}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{cc} courses</span>
                {grp ? (
                  <span className={blueBadge}>{grp.code}</span>
                ) : (
                  <span className="text-xs text-muted-foreground italic">No Group</span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  // ── Main render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Layers className="h-5 w-5 text-muted-foreground" />
            Financial Groups
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage societies and foundations for financial reporting
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-lg border border-input bg-background overflow-hidden">
          {(["groups", "campuses", "institutions"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0 border-input ${
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {v === "groups" ? "By Group" : v === "campuses" ? "By Campus" : "By Institution"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-card border border-input p-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <Layers className="h-4 w-4 text-blue-700 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Groups</p>
            <p className="text-base font-bold text-foreground">{groups.length}</p>
          </div>
        </div>
        <div className="rounded-xl bg-card border border-input p-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <Building2 className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Institutions</p>
            <p className="text-base font-bold text-foreground">{institutions.length}</p>
          </div>
        </div>
        <div className="rounded-xl bg-card border border-input p-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Assigned</p>
            <p className="text-base font-bold text-foreground">
              {new Set(members.map((m) => m.institution_id)).size}
            </p>
          </div>
        </div>
      </div>

      {/* Active view */}
      {view === "groups" && renderGroupsView()}
      {view === "campuses" && renderCampusesView()}
      {view === "institutions" && renderInstitutionsView()}
    </div>
  );
}
