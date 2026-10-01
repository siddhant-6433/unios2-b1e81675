// HR Job Openings — the requisition console.
//
// The HR-side view of job_openings: a filtered table of every requisition, a
// create/edit dialog with the full record, and the two lifecycle actions that
// matter — Publish (status='open' + stamp posted_at) and Close (status='closed').
// The public careers page reads only open rows whose closes_at has not passed
// (see the "Public reads open job openings" RLS policy), so drafts and closed
// requisitions never leave this console.
//
// Reference tables (designations/departments/campuses) are read whole and
// joined client-side, since they are small and we already need them for the
// form's dropdowns.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/ui/state-fields";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Briefcase, Copy, ExternalLink, Loader2, Pencil, Plus, Search, Send, Trash2, XCircle,
} from "lucide-react";
import {
  EMPLOYMENT_TYPES,
  JOB_OPENING_FILTERS,
  employmentTypeLabel,
  experienceLabel,
  isOpen,
  openingStatusBadge,
  openingStatusLabel,
  publicOpeningUrl,
  salaryLabel,
  slugify,
  type JobOpening,
  type JobOpeningFilter,
  type JobOpeningStatus,
} from "@/lib/jobOpenings";

interface DesignationOption {
  id: string;
  name: string;
  is_active: boolean;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface CampusOption {
  id: string;
  name: string;
}

const EMPTY_FORM = {
  title: "",
  slug: "",
  designation_id: "",
  department_id: "",
  campus_id: "",
  description: "",
  employment_type: "Full Time" as string,
  experience_min_years: "",
  experience_max_years: "",
  salary_min: "",
  salary_max: "",
  salary_visible: false,
  location: "",
  openings_count: "1",
  naukri_url: "",
  closes_at: "",
};

type OpeningForm = typeof EMPTY_FORM;

const fmtDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const numStr = (value: number | string | null | undefined) =>
  value === null || value === undefined || value === "" ? "" : String(value);

export function JobOpeningsPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can("hr", "recruitment_edit");

  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [designations, setDesignations] = useState<DesignationOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [campuses, setCampuses] = useState<CampusOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<JobOpeningFilter>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<JobOpening | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState<OpeningForm>({ ...EMPTY_FORM });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [openingRes, designationRes, departmentRes, campusRes] = await Promise.all([
      (supabase.from("job_openings" as never) as never)
        .select("*")
        .order("posted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      (supabase.from("designations" as never) as never)
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name"),
      (supabase.from("departments" as never) as never).select("id, name").order("name"),
      (supabase.from("campuses" as never) as never).select("id, name").order("name"),
    ]);

    if (openingRes.error) {
      toast({ title: "Could not load job openings", description: openingRes.error.message, variant: "destructive" });
    }
    setOpenings((openingRes.data as JobOpening[]) ?? []);
    setDesignations((designationRes.data as DesignationOption[]) ?? []);
    setDepartments((departmentRes.data as DepartmentOption[]) ?? []);
    setCampuses((campusRes.data as CampusOption[]) ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const designationMap = useMemo(
    () => new Map(designations.map((d) => [d.id, d.name])),
    [designations],
  );
  const departmentMap = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );
  const campusMap = useMemo(
    () => new Map(campuses.map((c) => [c.id, c.name])),
    [campuses],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return openings.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!q) return true;
      return [
        o.title,
        o.slug,
        o.location,
        o.employment_type,
        o.designation_id ? designationMap.get(o.designation_id) : "",
        o.department_id ? departmentMap.get(o.department_id) : "",
        o.campus_id ? campusMap.get(o.campus_id) : "",
      ].some((value) => (value ?? "").toLowerCase().includes(q));
    });
  }, [openings, statusFilter, search, designationMap, departmentMap, campusMap]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: openings.length };
    for (const status of ["draft", "open", "closed"]) counts[status] = 0;
    for (const opening of openings) counts[opening.status] = (counts[opening.status] ?? 0) + 1;
    return counts;
  }, [openings]);

  const openCreate = () => {
    setEditing(null);
    setSlugTouched(false);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (opening: JobOpening) => {
    setEditing(opening);
    setSlugTouched(true);
    setForm({
      title: opening.title,
      slug: opening.slug,
      designation_id: opening.designation_id ?? "",
      department_id: opening.department_id ?? "",
      campus_id: opening.campus_id ?? "",
      description: opening.description ?? "",
      employment_type: opening.employment_type || "Full Time",
      experience_min_years: numStr(opening.experience_min_years),
      experience_max_years: numStr(opening.experience_max_years),
      salary_min: numStr(opening.salary_min),
      salary_max: numStr(opening.salary_max),
      salary_visible: opening.salary_visible,
      location: opening.location ?? "",
      openings_count: numStr(opening.openings_count) || "1",
      naukri_url: opening.naukri_url ?? "",
      closes_at: opening.closes_at ? opening.closes_at.slice(0, 10) : "",
    });
    setDialogOpen(true);
  };

  const handleTitleChange = (title: string) =>
    setForm((current) => ({
      ...current,
      title,
      slug: slugTouched ? current.slug : slugify(title),
    }));

  const handleSlugChange = (slug: string) => {
    setSlugTouched(true);
    setForm((current) => ({ ...current, slug }));
  };

  const copyPublicUrl = async (slug: string) => {
    const url = publicOpeningUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch {
      toast({ title: "Could not copy the link", variant: "destructive" });
    }
  };

  const saveOpening = async () => {
    const slug = (form.slug.trim() || slugify(form.title)).toLowerCase();
    if (!form.title.trim() || !slug) {
      toast({ title: "Title and slug are required", variant: "destructive" });
      return;
    }
    setBusyId("save");
    const payload = {
      title: form.title.trim(),
      slug,
      designation_id: form.designation_id || null,
      department_id: form.department_id || null,
      campus_id: form.campus_id || null,
      description: form.description.trim() || null,
      employment_type: form.employment_type || "Full Time",
      experience_min_years: form.experience_min_years === "" ? null : Number(form.experience_min_years),
      experience_max_years: form.experience_max_years === "" ? null : Number(form.experience_max_years),
      salary_min: form.salary_min === "" ? null : Number(form.salary_min),
      salary_max: form.salary_max === "" ? null : Number(form.salary_max),
      salary_visible: form.salary_visible,
      location: form.location.trim() || null,
      openings_count: form.openings_count === "" ? 1 : Number(form.openings_count),
      naukri_url: form.naukri_url.trim() || null,
      closes_at: form.closes_at ? new Date(`${form.closes_at}T23:59:59`).toISOString() : null,
    };
    const result = editing
      ? await (supabase.from("job_openings" as never) as never).update(payload as never).eq("id", editing.id)
      : await (supabase.from("job_openings" as never) as never).insert(payload as never);
    setBusyId(null);
    if (result.error) {
      toast({ title: "Could not save the opening", description: result.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Opening updated" : "Opening created" });
    setDialogOpen(false);
    await fetchAll();
  };

  const changeStatus = async (opening: JobOpening, status: JobOpeningStatus) => {
    setBusyId(opening.id);
    const patch: Record<string, unknown> = { status };
    if (status === "open") patch.posted_at = new Date().toISOString();
    const { error } = await (supabase.from("job_openings" as never) as never).update(patch as never).eq("id", opening.id);
    setBusyId(null);
    if (error) {
      toast({ title: "Could not update the opening", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "open" ? "Opening published" : "Opening closed" });
    await fetchAll();
  };

  const deleteOpening = async (opening: JobOpening) => {
    if (!window.confirm(`Delete “${opening.title}”? Its public link will stop working.`)) return;
    setBusyId(opening.id);
    const { error } = await (supabase.from("job_openings" as never) as never).delete().eq("id", opening.id);
    setBusyId(null);
    if (error) {
      toast({ title: "Could not delete the opening", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Opening deleted" });
    await fetchAll();
  };

  if (loading) return <PageLoader />;

  const designationOptions = designations.map((d) => ({ value: d.id, label: d.name }));
  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));
  const campusOptions = campuses.map((c) => ({ value: c.id, label: c.name }));
  const employmentOptions = EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }));
  const previewSlug = form.slug.trim() || slugify(form.title);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-input bg-card p-1">
          {JOB_OPENING_FILTERS.map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium capitalize transition-colors ${
                statusFilter === filter
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {filter === "all" ? "All" : openingStatusLabel(filter)}
              <span className={`text-[10px] ${statusFilter === filter ? "text-primary-foreground/80" : "text-muted-foreground/70"}`}>
                {statusCounts[filter] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, slug, department…"
              className="h-9 w-[240px] pl-8 text-sm"
            />
          </div>
          {canManage && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> New opening
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Briefcase className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No job openings match this filter.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[1080px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Public slug</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Department</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campus</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Openings</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Posted / Closes</th>
                {canManage && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((opening) => (
                <tr key={opening.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 max-w-[260px]">
                    <div className="font-medium text-foreground truncate">{opening.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[
                        opening.designation_id ? designationMap.get(opening.designation_id) : null,
                        experienceLabel(opening.experience_min_years, opening.experience_max_years),
                        salaryLabel(opening.salary_min, opening.salary_max, opening.salary_visible),
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-muted-foreground truncate" title={publicOpeningUrl(opening.slug)}>
                        /{opening.slug}
                      </span>
                      <button
                        onClick={() => copyPublicUrl(opening.slug)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Copy public link"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <a
                        href={publicOpeningUrl(opening.slug)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Open public link"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {opening.department_id ? departmentMap.get(opening.department_id) ?? "—" : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {opening.campus_id ? campusMap.get(opening.campus_id) ?? "—" : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{employmentTypeLabel(opening.employment_type)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{numStr(opening.openings_count) || "0"}</td>
                  <td className="px-4 py-3">
                    <Badge className={openingStatusBadge(opening.status)} title={isOpen(opening) ? "Live on the careers page" : undefined}>
                      {openingStatusLabel(opening.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    <div>Posted {fmtDate(opening.posted_at)}</div>
                    <div>Closes {fmtDate(opening.closes_at)}</div>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {opening.status !== "open" && (
                          <button
                            onClick={() => changeStatus(opening, "open")}
                            disabled={busyId === opening.id}
                            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {busyId === opening.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Publish
                          </button>
                        )}
                        {opening.status === "open" && (
                          <button
                            onClick={() => changeStatus(opening, "closed")}
                            disabled={busyId === opening.id}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {busyId === opening.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Close
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(opening)}
                          className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteOpening(opening)}
                          disabled={busyId === opening.id}
                          className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit opening */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit job opening" : "New job opening"}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Editing “${editing.title}”. Publishing makes it live on the careers page.`
                : "Draft a requisition, then publish it when it is ready for the careers page."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">
              Title
              <Input
                value={form.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. Assistant Professor — Nursing"
                className="mt-1 h-9 text-sm"
              />
            </label>

            <div>
              <label className="block text-xs text-muted-foreground">Public slug</label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  value={form.slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="auto-generated-from-the-title"
                  className="h-9 text-sm font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={() => copyPublicUrl(previewSlug)}
                  disabled={!previewSlug}
                >
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground truncate">{publicOpeningUrl(previewSlug)}</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SelectField
                label="Designation"
                value={form.designation_id}
                onValueChange={(value) => setForm({ ...form, designation_id: value })}
                options={designationOptions}
                placeholder="Unassigned"
              />
              <SelectField
                label="Department"
                value={form.department_id}
                onValueChange={(value) => setForm({ ...form, department_id: value })}
                options={departmentOptions}
                placeholder="Unassigned"
              />
              <SelectField
                label="Campus"
                value={form.campus_id}
                onValueChange={(value) => setForm({ ...form, campus_id: value })}
                options={campusOptions}
                placeholder="Any campus"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SelectField
                label="Employment type"
                value={form.employment_type}
                onValueChange={(value) => setForm({ ...form, employment_type: value })}
                options={employmentOptions}
                allowEmpty={false}
              />
              <label className="block text-xs text-muted-foreground">
                Openings
                <Input
                  type="number"
                  min={1}
                  value={form.openings_count}
                  onChange={(e) => setForm({ ...form, openings_count: e.target.value })}
                  className="mt-1 h-9 text-sm"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Location
                <Input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Greater Noida"
                  className="mt-1 h-9 text-sm"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Min experience (years)
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={form.experience_min_years}
                  onChange={(e) => setForm({ ...form, experience_min_years: e.target.value })}
                  className="mt-1 h-9 text-sm"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Max experience (years)
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={form.experience_max_years}
                  onChange={(e) => setForm({ ...form, experience_max_years: e.target.value })}
                  className="mt-1 h-9 text-sm"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="block text-xs text-muted-foreground">
                Salary min (₹)
                <Input
                  type="number"
                  min={0}
                  step="1000"
                  value={form.salary_min}
                  onChange={(e) => setForm({ ...form, salary_min: e.target.value })}
                  className="mt-1 h-9 text-sm"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Salary max (₹)
                <Input
                  type="number"
                  min={0}
                  step="1000"
                  value={form.salary_max}
                  onChange={(e) => setForm({ ...form, salary_max: e.target.value })}
                  className="mt-1 h-9 text-sm"
                />
              </label>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <span className="text-xs text-muted-foreground">Show salary publicly</span>
                <Switch
                  checked={form.salary_visible}
                  onCheckedChange={(checked) => setForm({ ...form, salary_visible: checked })}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Public pay band:{" "}
              <span className="text-foreground">
                {salaryLabel(form.salary_min, form.salary_max, form.salary_visible)}
              </span>
            </p>

            <label className="block text-xs text-muted-foreground">
              Naukri URL
              <Input
                value={form.naukri_url}
                onChange={(e) => setForm({ ...form, naukri_url: e.target.value })}
                placeholder="https://www.naukri.com/job-listings-…"
                className="mt-1 h-9 text-sm"
              />
            </label>

            <label className="block text-xs text-muted-foreground">
              Closes on
              <Input
                type="date"
                value={form.closes_at}
                onChange={(e) => setForm({ ...form, closes_at: e.target.value })}
                className="mt-1 h-9 text-sm"
              />
            </label>

            <label className="block text-xs text-muted-foreground">
              Description
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
                placeholder="Responsibilities, qualifications, application process…"
                className="mt-1 text-sm"
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busyId === "save"}>
              Cancel
            </Button>
            <Button onClick={saveOpening} disabled={busyId === "save"}>
              {busyId === "save" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {editing ? "Save changes" : "Create opening"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default JobOpeningsPanel;
