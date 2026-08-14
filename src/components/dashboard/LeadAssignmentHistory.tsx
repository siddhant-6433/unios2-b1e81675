import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Check, ChevronDown, Filter, History, RefreshCw, UserCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type LeadAssignmentHistoryRow = {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_stage: string | null;
  lead_stage_at_assignment: string | null;
  course_name: string | null;
  campus_name: string | null;
  assigned_to: string;
  assigned_to_name: string | null;
  assigned_by_profile_id: string | null;
  assigned_by_name: string | null;
  previous_counsellor_name: string | null;
  assignment_source: "self_picked" | "assigned" | "ai_priority" | string;
  bucket_name: string | null;
  latest_call_disposition: string | null;
  latest_call_response: string | null;
  latest_call_at: string | null;
  created_at: string;
};

type LeadAssignmentHistoryFilters = {
  assignedToIds: string[];
  assignedByValues: string[];
  sources: string[];
  bucketNames: string[];
  leadStages: string[];
  callDispositions: string[];
  fromDate: string;
  toDate: string;
};

type LeadAssignmentHistoryRpcClient = {
  rpc(
    fn: "get_lead_assignment_history",
    args: {
      _limit: number;
      _assigned_to: string | null;
      _assigned_to_ids: string[] | null;
      _assigned_by_profile_ids: string[] | null;
      _include_system_assigned_by: boolean;
      _sources: string[] | null;
      _bucket_names: string[] | null;
      _lead_stages: string[] | null;
      _call_dispositions: string[] | null;
      _from_date: string | null;
      _to_date: string | null;
    }
  ): Promise<{ data: LeadAssignmentHistoryRow[] | null; error: { message: string } | null }>;
};

type LeadAssignmentHistoryTableClient = {
  from(table: "lead_assignment_history"): {
    select(columns: "assigned_by_profile_id"): {
      range(
        from: number,
        to: number
      ): Promise<{
        data: { assigned_by_profile_id: string | null }[] | null;
        error: { message: string } | null;
      }>;
    };
  };
};

type FilterOption = {
  value: string;
  label: string;
};

type CounsellorOption = {
  id: string;
  name: string;
};

const EMPTY_FILTERS: LeadAssignmentHistoryFilters = {
  assignedToIds: [],
  assignedByValues: [],
  sources: [],
  bucketNames: [],
  leadStages: [],
  callDispositions: [],
  fromDate: "",
  toDate: "",
};

const SOURCE_OPTIONS: FilterOption[] = [
  { value: "self_picked", label: "Self picked" },
  { value: "assigned", label: "Assigned" },
  { value: "ai_priority", label: "AI priority assigned" },
];

const BUCKET_OPTIONS: FilterOption[] = [
  { value: "College Leads", label: "College Leads" },
  { value: "CBSE School Leads", label: "CBSE School Leads" },
  { value: "Mirai IB Leads", label: "Mirai IB Leads" },
];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid",
  application_submitted: "Submitted",
  ai_called: "AI Called",
  counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled",
  interview: "Interview",
  offer_sent: "Offer Sent",
  token_paid: "Token Paid",
  pre_admitted: "Pre-Admitted",
  admitted: "Admitted",
  rejected: "Rejected",
  ineligible: "Ineligible",
  dnc: "Do Not Contact",
  deferred: "Deferred",
  not_interested: "Not Interested",
};

const DISPOSITION_LABELS: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not Interested",
  ineligible: "Ineligible",
  not_answered: "Not Answered",
  no_answer: "No Answer",
  call_back: "Call Back",
  wrong_number: "Wrong Number",
  do_not_contact: "DNC",
  voicemail: "Voicemail",
  busy: "Busy",
  cold: "Cold",
  cancelled: "Cancelled",
};

const STAGE_OPTIONS = Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }));
const DISPOSITION_OPTIONS = Object.entries(DISPOSITION_LABELS).map(([value, label]) => ({ value, label }));
const SYSTEM_ASSIGNER_VALUE = "__system__";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPhone(phone: string | null) {
  if (!phone) return "-";
  return phone;
}

function labelize(value: string | null) {
  if (!value) return "-";
  return STAGE_LABELS[value] || DISPOSITION_LABELS[value] || value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function sourceLabel(row: LeadAssignmentHistoryRow) {
  if (row.assignment_source === "self_picked") {
    return row.bucket_name ? `Self picked from ${row.bucket_name}` : "Self picked";
  }
  if (row.assignment_source === "ai_priority") {
    return "AI assigned priority-interested lead";
  }
  const assigner = row.assigned_by_name || "System";
  return row.bucket_name ? `Assigned by ${assigner} from ${row.bucket_name}` : `Assigned by ${assigner}`;
}

function selectedArray(values: string[]) {
  return values.length > 0 ? values : null;
}

function selectedAssignedByIds(values: string[]) {
  const ids = values.filter(value => value !== SYSTEM_ASSIGNER_VALUE);
  return ids.length > 0 ? ids : null;
}

function includesSystemAssigner(values: string[]) {
  return values.includes(SYSTEM_ASSIGNER_VALUE);
}

function startOfDay(value: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

function dayAfter(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function activeFilterCount(filters: LeadAssignmentHistoryFilters) {
  return (
    filters.assignedToIds.length +
    filters.assignedByValues.length +
    filters.sources.length +
    filters.bucketNames.length +
    filters.leadStages.length +
    filters.callDispositions.length +
    (filters.fromDate ? 1 : 0) +
    (filters.toDate ? 1 : 0)
  );
}

function MultiFilter({
  label,
  options,
  values,
  onChange,
  searchable = false,
}: {
  label: string;
  options: FilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter(v => v !== value) : [...values, value]);
  };

  const selectedLabels = options
    .filter(option => values.includes(option.value))
    .map(option => option.label);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-between gap-2 px-2.5 text-xs">
          <span className="truncate">{label}</span>
          {values.length > 0 ? (
            <Badge variant="secondary" className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
              {values.length}
            </Badge>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          {searchable && <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />}
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {options.map(option => {
                const checked = values.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => toggle(option.value)}
                    className="gap-2"
                  >
                    <Checkbox checked={checked} className="pointer-events-none" />
                    <span className="flex-1 truncate">{option.label}</span>
                    {checked && <Check className="h-3.5 w-3.5 text-primary" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {values.length > 0 && (
          <div className="border-t border-border p-2">
            <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => onChange([])}>
              Clear {selectedLabels.length === 1 ? selectedLabels[0] : `${selectedLabels.length} selected`}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function LeadAssignmentHistory({
  limit = 100,
  compact = false,
}: {
  limit?: number;
  compact?: boolean;
}) {
  const { profile, role } = useAuth();
  const [rows, setRows] = useState<LeadAssignmentHistoryRow[]>([]);
  const [counsellors, setCounsellors] = useState<CounsellorOption[]>([]);
  const [assignedByOptions, setAssignedByOptions] = useState<FilterOption[]>([]);
  const [filters, setFilters] = useState<LeadAssignmentHistoryFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCounsellors = useCallback(async () => {
    if (role === "counsellor" && profile?.id) {
      const { data: ledTeams } = await supabase
        .from("teams")
        .select("id")
        .eq("leader_id", profile.id);

      if (!ledTeams || ledTeams.length === 0) {
        setCounsellors([{ id: profile.id, name: profile.display_name || "Me" }]);
        return;
      }

      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("user_id")
        .in("team_id", ledTeams.map(team => team.id));

      const memberUserIds = [...new Set((teamMembers || []).map(member => member.user_id).filter(Boolean))];
      const { data: memberProfiles } = memberUserIds.length > 0
        ? await supabase
          .from("profiles")
          .select("id, display_name")
          .in("user_id", memberUserIds)
          .eq("login_disabled", false)
        : { data: [] };

      const scopedOptions = new Map<string, string>([[profile.id, profile.display_name || "Me"]]);
      (memberProfiles || []).forEach(memberProfile => {
        scopedOptions.set(memberProfile.id, memberProfile.display_name || "Unknown");
      });
      setCounsellors(
        Array.from(scopedOptions, ([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      return;
    }

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "counsellor");

    const userIds = [...new Set((roleRows || []).map((row: { user_id: string }) => row.user_id).filter(Boolean))];
    if (userIds.length === 0) {
      setCounsellors([]);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("user_id", userIds)
      .eq("login_disabled", false);

    setCounsellors(
      (profiles || [])
        .map(profile => ({ id: profile.id, name: profile.display_name || "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }, [profile, role]);

  const fetchAssignedByOptions = useCallback(async () => {
    const historyTableClient = supabase as unknown as LeadAssignmentHistoryTableClient;
    const { data: historyRows } = await historyTableClient
      .from("lead_assignment_history")
      .select("assigned_by_profile_id")
      .range(0, 9999);

    const assignerIds = [
      ...new Set(
        ((historyRows || []) as { assigned_by_profile_id: string | null }[])
          .map(row => row.assigned_by_profile_id)
          .filter((value): value is string => Boolean(value))
      ),
    ];
    const hasSystemRows = ((historyRows || []) as { assigned_by_profile_id: string | null }[])
      .some(row => row.assigned_by_profile_id === null);

    const options: FilterOption[] = hasSystemRows
      ? [{ value: SYSTEM_ASSIGNER_VALUE, label: "System / historical import" }]
      : [];

    if (assignerIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", assignerIds);

      options.push(
        ...((profiles || []) as { id: string; display_name: string | null }[])
          .map(assigner => ({ value: assigner.id, label: assigner.display_name || "Unknown" }))
          .sort((a, b) => a.label.localeCompare(b.label))
      );
    }

    setAssignedByOptions(options);
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const historyClient = supabase as unknown as LeadAssignmentHistoryRpcClient;
    const { data, error } = await historyClient.rpc("get_lead_assignment_history", {
      _limit: limit,
      _assigned_to: null,
      _assigned_to_ids: selectedArray(filters.assignedToIds),
      _assigned_by_profile_ids: selectedAssignedByIds(filters.assignedByValues),
      _include_system_assigned_by: includesSystemAssigner(filters.assignedByValues),
      _sources: selectedArray(filters.sources),
      _bucket_names: selectedArray(filters.bucketNames),
      _lead_stages: selectedArray(filters.leadStages),
      _call_dispositions: selectedArray(filters.callDispositions),
      _from_date: startOfDay(filters.fromDate),
      _to_date: dayAfter(filters.toDate),
    });
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data || []) as LeadAssignmentHistoryRow[]);
    }
    setLoading(false);
  }, [filters, limit]);

  useEffect(() => {
    fetchCounsellors();
  }, [fetchCounsellors]);

  useEffect(() => {
    fetchAssignedByOptions();
  }, [fetchAssignedByOptions]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const totals = useMemo(() => {
    const selfPicked = rows.filter(r => r.assignment_source === "self_picked").length;
    const aiPriority = rows.filter(r => r.assignment_source === "ai_priority").length;
    return { selfPicked, aiPriority, assigned: rows.length - selfPicked - aiPriority };
  }, [rows]);

  const counsellorOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    counsellors.forEach(counsellor => optionMap.set(counsellor.id, counsellor.name));
    rows.forEach(row => optionMap.set(row.assigned_to, row.assigned_to_name || "Unknown"));
    return Array.from(optionMap, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [counsellors, rows]);

  const activeFilters = activeFilterCount(filters);
  const updateFilter = <K extends keyof LeadAssignmentHistoryFilters>(
    key: K,
    value: LeadAssignmentHistoryFilters[K]
  ) => setFilters(current => ({ ...current, [key]: value }));

  return (
    <Card className="overflow-hidden border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">Lead Assignment History</CardTitle>
            {!loading && (
              <Badge variant="secondary" className="text-[11px]">
                {rows.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!compact && rows.length > 0 && (
              <div className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
                <span>{totals.selfPicked} self picked</span>
                <span>{totals.aiPriority} AI priority</span>
                <span>{totals.assigned} assigned</span>
              </div>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={fetchRows} disabled={loading}>
              {loading ? <ButtonOrb state="working" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </div>
        {!compact && (
          <div className="space-y-3 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 text-xs font-medium text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                Filters
              </div>
              <MultiFilter
                label="Source"
                options={SOURCE_OPTIONS}
                values={filters.sources}
                onChange={values => updateFilter("sources", values)}
              />
              <MultiFilter
                label="Counsellor"
                options={counsellorOptions}
                values={filters.assignedToIds}
                onChange={values => updateFilter("assignedToIds", values)}
                searchable
              />
              <MultiFilter
                label="Assigned by"
                options={assignedByOptions}
                values={filters.assignedByValues}
                onChange={values => updateFilter("assignedByValues", values)}
                searchable
              />
              <MultiFilter
                label="Bucket"
                options={BUCKET_OPTIONS}
                values={filters.bucketNames}
                onChange={values => updateFilter("bucketNames", values)}
              />
              <MultiFilter
                label="Status"
                options={STAGE_OPTIONS}
                values={filters.leadStages}
                onChange={values => updateFilter("leadStages", values)}
                searchable
              />
              <MultiFilter
                label="Disposition"
                options={DISPOSITION_OPTIONS}
                values={filters.callDispositions}
                onChange={values => updateFilter("callDispositions", values)}
                searchable
              />
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={filters.fromDate}
                  onChange={event => updateFilter("fromDate", event.target.value)}
                  className={cn("h-8 w-[142px] text-xs", filters.fromDate && "border-primary/50")}
                  aria-label="From date"
                />
                <Input
                  type="date"
                  value={filters.toDate}
                  onChange={event => updateFilter("toDate", event.target.value)}
                  className={cn("h-8 w-[142px] text-xs", filters.toDate && "border-primary/50")}
                  aria-label="To date"
                />
              </div>
              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setFilters(EMPTY_FILTERS)}>
                  <X className="h-3.5 w-3.5" />
                  Clear {activeFilters}
                </Button>
              )}
            </div>
            {activeFilters > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {filters.sources.map(value => (
                  <Badge key={`source-${value}`} variant="secondary" className="gap-1 text-[11px]">
                    {SOURCE_OPTIONS.find(option => option.value === value)?.label || labelize(value)}
                    <button type="button" onClick={() => updateFilter("sources", filters.sources.filter(v => v !== value))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {filters.assignedToIds.map(value => (
                  <Badge key={`counsellor-${value}`} variant="secondary" className="gap-1 text-[11px]">
                    {counsellorOptions.find(option => option.value === value)?.label || "Counsellor"}
                    <button type="button" onClick={() => updateFilter("assignedToIds", filters.assignedToIds.filter(v => v !== value))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {filters.assignedByValues.map(value => (
                  <Badge key={`assigned-by-${value}`} variant="secondary" className="gap-1 text-[11px]">
                    by {assignedByOptions.find(option => option.value === value)?.label || "Unknown"}
                    <button type="button" onClick={() => updateFilter("assignedByValues", filters.assignedByValues.filter(v => v !== value))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {filters.bucketNames.map(value => (
                  <Badge key={`bucket-${value}`} variant="secondary" className="gap-1 text-[11px]">
                    {value}
                    <button type="button" onClick={() => updateFilter("bucketNames", filters.bucketNames.filter(v => v !== value))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {filters.leadStages.map(value => (
                  <Badge key={`stage-${value}`} variant="secondary" className="gap-1 text-[11px]">
                    {labelize(value)}
                    <button type="button" onClick={() => updateFilter("leadStages", filters.leadStages.filter(v => v !== value))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {filters.callDispositions.map(value => (
                  <Badge key={`disposition-${value}`} variant="secondary" className="gap-1 text-[11px]">
                    {labelize(value)}
                    <button type="button" onClick={() => updateFilter("callDispositions", filters.callDispositions.filter(v => v !== value))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {filters.fromDate && (
                  <Badge variant="secondary" className="gap-1 text-[11px]">
                    From {filters.fromDate}
                    <button type="button" onClick={() => updateFilter("fromDate", "")}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {filters.toDate && (
                  <Badge variant="secondary" className="gap-1 text-[11px]">
                    To {filters.toDate}
                    <button type="button" onClick={() => updateFilter("toDate", "")}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex h-36 items-center justify-center">
            <OrbLoader state="searching" />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-destructive">{error}</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <UserCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {activeFilters > 0 ? "No assignment history matches the selected filters" : "No assignment history yet"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Assigned</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Lead</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Counsellor</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Source</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Call Disposition</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-border/40 transition-colors hover:bg-muted/25">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/admissions/${row.lead_id}`} className="font-medium text-foreground hover:text-primary">
                        {row.lead_name || "Unknown lead"}
                      </Link>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatPhone(row.lead_phone)} {" | "} {row.course_name || "No course"}{row.campus_name ? ` | ${row.campus_name}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-foreground">{row.assigned_to_name || "Unknown"}</p>
                      {row.previous_counsellor_name && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">from {row.previous_counsellor_name}</p>
                      )}
                    </td>
                    <td className="min-w-[180px] px-4 py-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        {row.assignment_source === "ai_priority" && <Bot className="h-3.5 w-3.5 text-warning-foreground" />}
                        <span>{sourceLabel(row)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="whitespace-nowrap text-[11px]">
                        {labelize(row.lead_stage)}
                      </Badge>
                      {row.lead_stage_at_assignment && row.lead_stage_at_assignment !== row.lead_stage && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          was {labelize(row.lead_stage_at_assignment)}
                        </p>
                      )}
                    </td>
                    <td className="min-w-[220px] px-4 py-3">
                      {row.latest_call_disposition || row.latest_call_response ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            {row.latest_call_disposition && (
                              <Badge className="border-0 bg-info/10 text-[11px] text-info-foreground">
                                {labelize(row.latest_call_disposition)}
                              </Badge>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                              {formatDateTime(row.latest_call_at)}
                            </span>
                          </div>
                          {row.latest_call_response && (
                            <p className="mt-1 line-clamp-2 max-w-md text-[11px] text-muted-foreground">
                              {row.latest_call_response}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">No call response yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
