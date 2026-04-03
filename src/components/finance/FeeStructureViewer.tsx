import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronUp, Building2 } from "lucide-react";

const categoryBadge: Record<string, string> = {
  tuition: "bg-pastel-blue", lab: "bg-pastel-purple", enrollment: "bg-pastel-green",
  library: "bg-pastel-orange", token: "bg-pastel-mint", hostel: "bg-pastel-yellow",
  transport: "bg-pastel-pink", exam: "bg-pastel-red", late_fee: "bg-pastel-red", other: "bg-muted",
};

interface FeeItem {
  code: string;
  name: string;
  category: string;
  term: string;
  amount: number;
  due_day: number;
}

interface FeeStructure {
  id: string;
  version: string;
  is_active: boolean;
  course_id: string;
  course_name: string;
  course_code: string;
  campus_name: string;
  institution_name: string;
  session_name: string;
  metadata: any;
  items: FeeItem[];
  total: number;
}

interface FilterOption {
  id: string;
  label: string;
  campus: string;
  institution: string;
}

interface Props {
  courseId?: string | null;
  compact?: boolean;
  showFilter?: boolean;
  /** Hide existing_parent versions (for counsellor/consultant new-admission context) */
  newAdmissionOnly?: boolean;
}

export function FeeStructureViewer({ courseId, compact = false, showFilter = false, newAdmissionOnly = false }: Props) {
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCourse, setFilterCourse] = useState(courseId || "all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let query = supabase
        .from("fee_structures")
        .select(`
          id, version, is_active, course_id, metadata,
          courses:course_id(id, name, code,
            departments!inner(name,
              institutions!inner(name, campus_id,
                campuses!inner(name)
              )
            )
          ),
          admission_sessions:session_id(name),
          fee_structure_items(*, fee_codes:fee_code_id(code, name, category))
        `)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (courseId && !showFilter) {
        query = query.eq("course_id", courseId);
      }

      const { data } = await query;

      if (data) {
        const mapped: FeeStructure[] = (data as any[])
          .filter(fs => {
            // Filter out existing_parent versions for new admission context
            if (newAdmissionOnly && fs.version?.toLowerCase().includes("existing_parent")) return false;
            return true;
          })
          .map(fs => {
            const course = fs.courses as any;
            const dept = course?.departments;
            const inst = dept?.institutions;
            const campus = inst?.campuses;

            const items: FeeItem[] = (fs.fee_structure_items || []).map((i: any) => ({
              code: i.fee_codes?.code || "—",
              name: i.fee_codes?.name || "—",
              category: i.fee_codes?.category || "other",
              term: i.term,
              amount: Number(i.amount),
              due_day: i.due_day,
            }));

            return {
              id: fs.id,
              version: fs.version,
              is_active: fs.is_active,
              course_id: fs.course_id,
              course_name: course?.name || "—",
              course_code: course?.code || "",
              campus_name: campus?.name || "—",
              institution_name: inst?.name || "—",
              session_name: (fs.admission_sessions as any)?.name || "—",
              metadata: fs.metadata,
              items,
              total: items.reduce((s, i) => s + i.amount, 0),
            };
          });

        setStructures(mapped);
      }
      setLoading(false);
    })();
  }, [courseId, showFilter, newAdmissionOnly]);

  // Auto-expand single result
  useEffect(() => {
    if (structures.length === 1) setExpandedId(structures[0].id);
    else if (courseId) {
      const match = structures[0];
      if (match) setExpandedId(match.id);
    }
  }, [structures, courseId]);

  // Build filter options grouped by campus → institution → course
  const filterOptions = useMemo(() => {
    const map = new Map<string, FilterOption>();
    structures.forEach(s => {
      if (!map.has(s.course_id)) {
        map.set(s.course_id, {
          id: s.course_id,
          label: s.course_name,
          campus: s.campus_name,
          institution: s.institution_name,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      const campusCmp = a.campus.localeCompare(b.campus);
      if (campusCmp !== 0) return campusCmp;
      return a.label.localeCompare(b.label);
    });
  }, [structures]);

  // Group options by campus for the dropdown
  const campusGroups = useMemo(() => {
    const map = new Map<string, FilterOption[]>();
    filterOptions.forEach(opt => {
      const key = `${opt.campus} — ${opt.institution}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(opt);
    });
    return Array.from(map.entries());
  }, [filterOptions]);

  const filtered = useMemo(() => {
    if (!showFilter || filterCourse === "all") return structures;
    return structures.filter(s => s.course_id === filterCourse);
  }, [structures, filterCourse, showFilter]);

  if (loading) return <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  if (structures.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No fee structure available{courseId ? " for this course" : ""}</p>;
  }

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  // Extract metadata highlights (boarding, discounts, etc.)
  const renderMetadata = (meta: any) => {
    if (!meta) return null;
    const highlights: { label: string; value: string }[] = [];

    if (meta.form_fee) highlights.push({ label: "Form Fee", value: fmt(meta.form_fee) });
    if (meta.uniform_cost) highlights.push({ label: "Uniform", value: fmt(meta.uniform_cost) });
    if (meta.seat_reservation_deposit) highlights.push({ label: "Seat Reservation", value: fmt(meta.seat_reservation_deposit) });
    if (meta.hostel_fee || meta.boarding_fee) highlights.push({ label: "Boarding/Hostel", value: fmt(meta.hostel_fee || meta.boarding_fee) });
    if (meta.transport_fee) highlights.push({ label: "Transport", value: fmt(meta.transport_fee) });
    if (meta.total_fee) highlights.push({ label: "Total Package", value: fmt(meta.total_fee) });

    // Discount info
    if (meta.discount_conditions || meta.early_bird_discount) {
      const disc = meta.discount_conditions || meta.early_bird_discount;
      if (typeof disc === "string") highlights.push({ label: "Discount", value: disc });
    }

    // Year-wise breakdown
    const years = meta.years || meta.year_wise;
    if (Array.isArray(years) && years.length > 0) {
      years.forEach((y: any, i: number) => {
        if (y.fee || y.amount) {
          highlights.push({ label: `Year ${i + 1}`, value: `${fmt(y.fee || y.amount)}${y.installments ? ` (${y.installments} installments)` : ""}` });
        }
      });
    }

    if (highlights.length === 0) return null;

    return (
      <div className="px-3 py-2 bg-amber-50/50 dark:bg-amber-950/10 border-t border-amber-200/30">
        <p className="text-[9px] font-semibold text-amber-800 dark:text-amber-400 uppercase mb-1">Fee Details</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          {highlights.map((h, i) => (
            <div key={i} className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-muted-foreground">{h.label}</span>
              <span className="text-[10px] font-medium text-foreground">{h.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Version label formatting
  const versionLabel = (v: string) => {
    if (v?.includes("existing_parent")) return "Existing Parent";
    if (v?.includes("new_admission")) return "New Admission";
    return v || "Standard";
  };

  return (
    <div className="space-y-3">
      {showFilter && campusGroups.length > 0 && (
        <select
          value={filterCourse}
          onChange={(e) => setFilterCourse(e.target.value)}
          className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        >
          <option value="all">All Courses ({structures.length})</option>
          {campusGroups.map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      {filtered.map((fs) => {
        const isExpanded = expandedId === fs.id;

        return (
          <div key={fs.id} className="rounded-xl border border-border/60 overflow-hidden">
            {/* Header */}
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left gap-2"
              onClick={() => setExpandedId(isExpanded ? null : fs.id)}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{fs.course_name}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Building2 className="h-2.5 w-2.5" />
                    {fs.campus_name} · {fs.institution_name}
                  </span>
                  <Badge variant="outline" className="text-[8px] px-1 py-0">{versionLabel(fs.version)}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-bold text-primary">{fmt(fs.total)}</span>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>

            {/* Expanded */}
            {isExpanded && (
              <div className="border-t border-border">
                {/* Metadata highlights (boarding, discounts, year-wise) */}
                {renderMetadata(fs.metadata)}

                {/* Fee items table */}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Fee</th>
                      {!compact && <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Category</th>}
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Term</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fs.items.map((item, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0">
                        <td className="px-3 py-2 text-foreground">
                          {item.name}
                          {compact && <span className="text-muted-foreground ml-1">({item.category})</span>}
                        </td>
                        {!compact && (
                          <td className="px-3 py-2">
                            <Badge className={`text-[9px] font-medium border-0 capitalize ${categoryBadge[item.category] || "bg-muted"}`}>
                              {item.category}
                            </Badge>
                          </td>
                        )}
                        <td className="px-3 py-2 text-muted-foreground">{item.term}</td>
                        <td className="px-3 py-2 text-right font-semibold text-foreground">{fmt(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-muted/30 border-t border-border flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{fs.items.length} fee items · {fs.session_name}</span>
                  <span className="text-xs font-bold text-primary">{fmt(fs.total)}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
