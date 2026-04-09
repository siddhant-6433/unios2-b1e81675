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

type StudentTypeFilter = "day_scholar" | "day_boarder" | "boarder";

/** Beacon school codes have boarding/transport options */
const isSchoolCourse = (code: string) => /^(BSAV|BSA|MIR)-/.test(code);

export function FeeStructureViewer({ courseId, compact = false, showFilter = false, newAdmissionOnly = false }: Props) {
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCourse, setFilterCourse] = useState(courseId || "all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [studentType, setStudentType] = useState<StudentTypeFilter>("day_scholar");
  const [transportZone, setTransportZone] = useState<"none" | "zone_1" | "zone_2" | "zone_3">("none");
  const [boardingType, setBoardingType] = useState<"none" | "non_ac" | "ac_central" | "ac_individual">("none");

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

  /** Whether any visible structure is a school course (needs student type filter) */
  const hasSchoolCourse = useMemo(() =>
    filtered.some(s => isSchoolCourse(s.course_code)),
  [filtered]);

  /** Split fee items into sections for school courses */
  const splitSchoolFeeItems = (items: FeeItem[], courseCode: string): {
    oneTime: FeeItem[]; tuition: FeeItem[]; boarding: FeeItem[]; transport: FeeItem[]; other: FeeItem[];
  } => {
    if (!isSchoolCourse(courseCode)) return { oneTime: [], tuition: [], boarding: [], transport: [], other: items };

    const oneTime: FeeItem[] = [];
    const tuition: FeeItem[] = [];
    const boarding: FeeItem[] = [];
    const transport: FeeItem[] = [];
    const other: FeeItem[] = [];

    for (const item of items) {
      // Transport → separate section
      if (item.category === "transport") {
        transport.push(item);
        continue;
      }

      // Enrollment (one-time): registration, admission, security deposit
      if (item.category === "enrollment") {
        // Security deposit is boarder-only
        if (item.code === "NB-SEC" || item.code === "MR-SEC") {
          if (studentType === "boarder") oneTime.push(item);
          continue;
        }
        oneTime.push(item);
        continue;
      }

      // Hostel / boarding
      if (item.category === "hostel") {
        if (studentType === "day_scholar") continue;
        if (studentType === "day_boarder") {
          if (item.code === "NB-DBA") boarding.push(item);
          continue;
        }
        if (studentType === "boarder") {
          if (item.code === "NB-DBA") continue;
          boarding.push(item);
          continue;
        }
        continue;
      }

      // Tuition
      if (item.category === "tuition") {
        tuition.push(item);
        continue;
      }

      // Everything else (lab, library, other, etc.)
      other.push(item);
    }
    return { oneTime, tuition, boarding, transport, other };
  };

  if (loading) return <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  if (structures.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No fee structure available{courseId ? " for this course" : ""}</p>;
  }

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  // Collect year-wise data from metadata (year_1, year_2, ... keys or years/year_wise array)
  const getYearData = (meta: any): { year: number; fee: number; discount: number; discountCondition: string; installmentCount: number; paymentNote: string }[] => {
    if (!meta) return [];
    const result: typeof retType = [];
    type retType = { year: number; fee: number; discount: number; discountCondition: string; installmentCount: number; paymentNote: string }[];

    // Check year_1, year_2, ... keys
    for (let i = 1; i <= 8; i++) {
      const y = meta[`year_${i}`];
      if (y && typeof y === "object") {
        result.push({
          year: i,
          fee: Number(y.fee || y.amount || 0),
          discount: Number(y.discount || 0),
          discountCondition: y.discount_condition || "",
          installmentCount: Number(y.installment_count || 0),
          paymentNote: y.payment_note || "",
        });
      }
    }

    // Fallback: years/year_wise array
    if (result.length === 0) {
      const years = meta.years || meta.year_wise;
      if (Array.isArray(years)) {
        years.forEach((y: any, i: number) => {
          if (y.fee || y.amount) {
            result.push({
              year: i + 1,
              fee: Number(y.fee || y.amount || 0),
              discount: Number(y.discount || 0),
              discountCondition: y.discount_condition || "",
              installmentCount: Number(y.installment_count || y.installments || 0),
              paymentNote: y.payment_note || "",
            });
          }
        });
      }
    }
    return result;
  };

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

    // Top-level discount info
    if (meta.discount_conditions || meta.early_bird_discount) {
      const disc = meta.discount_conditions || meta.early_bird_discount;
      if (typeof disc === "string") highlights.push({ label: "Discount", value: disc });
    }

    const yearData = getYearData(meta);
    const hasAnyDiscount = yearData.some(y => y.discount > 0);

    if (highlights.length === 0 && yearData.length === 0) return null;

    return (
      <div className="border-t border-amber-200/30">
        {/* General highlights */}
        {highlights.length > 0 && (
          <div className="px-3 py-2 bg-amber-50/50 dark:bg-amber-950/10">
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
        )}

        {/* Year-wise breakdown with discount */}
        {yearData.length > 0 && (() => {
          // Derive installment label from data (e.g. "Payable in 2 Installments")
          const commonInstCount = yearData[0]?.installmentCount;
          const allSameInst = commonInstCount > 0 && yearData.every(y => y.installmentCount === commonInstCount);
          const feeColLabel = allSameInst
            ? `Annual Fee (Payable in ${commonInstCount} Installments)`
            : "Annual Fee";

          return (
            <div className="px-3 py-2 bg-muted/20">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase mb-1.5">Year-wise Breakdown</p>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium pb-1">Year</th>
                    <th className="text-right font-medium pb-1">{feeColLabel}</th>
                    {hasAnyDiscount && (
                      <>
                        <th className="text-right font-medium pb-1">Waiver</th>
                        <th className="text-right font-medium pb-1">After Waiver</th>
                      </>
                    )}
                    {!allSameInst && (
                      <th className="text-right font-medium pb-1">Installments</th>
                    )}
                    {hasAnyDiscount && (
                      <th className="text-left font-medium pb-1 pl-3">Waiver Condition</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {yearData.map(y => {
                    // Build waiver condition label
                    let waiverLabel = "";
                    if (y.discount > 0) {
                      // Extract date from condition like "Full fee by 10 Jun 2026" or "Full fee on or before 10 Jul 2027"
                      const dateMatch = y.discountCondition.match(/(?:by|before)\s+(.+)/i);
                      const dateStr = dateMatch?.[1]?.trim();
                      if (y.year === 1) {
                        waiverLabel = dateStr
                          ? `On Full Annual Fee Payment by ${dateStr} / At time of Admission`
                          : "On Full Annual Fee Payment at time of Admission";
                      } else {
                        waiverLabel = dateStr
                          ? `On Full Annual Fee Payment by ${dateStr}`
                          : "On Full Annual Fee Payment";
                      }
                    }

                    return (
                      <tr key={y.year} className="border-t border-border/30">
                        <td className="py-1.5 font-medium text-foreground">Year {y.year}</td>
                        <td className="py-1.5 text-right text-foreground">{fmt(y.fee)}</td>
                        {hasAnyDiscount && (
                          <>
                            <td className="py-1.5 text-right">
                              {y.discount > 0 ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">-{fmt(y.discount)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right font-semibold text-primary">
                              {y.discount > 0 ? fmt(y.fee - y.discount) : fmt(y.fee)}
                            </td>
                          </>
                        )}
                        {!allSameInst && (
                          <td className="py-1.5 text-right text-muted-foreground">
                            {y.installmentCount > 0 ? `${y.installmentCount}x` : "—"}
                          </td>
                        )}
                        {hasAnyDiscount && (
                          <td className="py-1.5 text-left pl-3 text-[10px] text-muted-foreground">
                            {waiverLabel || "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {hasAnyDiscount && (
                  <tfoot>
                    <tr className="border-t border-border/50">
                      <td className="pt-1.5 font-semibold text-foreground">Total</td>
                      <td className="pt-1.5 text-right text-foreground">{fmt(yearData.reduce((s, y) => s + y.fee, 0))}</td>
                      <td className="pt-1.5 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                        -{fmt(yearData.reduce((s, y) => s + y.discount, 0))}
                      </td>
                      <td className="pt-1.5 text-right font-bold text-primary">
                        {fmt(yearData.reduce((s, y) => s + y.fee - y.discount, 0))}
                      </td>
                      {!allSameInst && <td></td>}
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          );
        })()}
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

      {/* Student type filter for school courses */}
      {hasSchoolCourse && (
        <div className="flex items-center gap-1 rounded-lg border border-input p-0.5 w-fit">
          {([
            { value: "day_scholar" as const, label: "Day Scholar" },
            { value: "day_boarder" as const, label: "Day Boarder" },
            { value: "boarder" as const, label: "Boarder" },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => setStudentType(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${studentType === opt.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {filtered.map((fs) => {
        const isExpanded = expandedId === fs.id;
        const yearData = getYearData(fs.metadata);
        const totalDiscount = yearData.reduce((s, y) => s + y.discount, 0);
        const totalAfterDiscount = totalDiscount > 0
          ? yearData.reduce((s, y) => s + y.fee - y.discount, 0)
          : 0;

        // For school courses, compute filtered total for the header (oneTime + tuition + other)
        const isSchool = isSchoolCourse(fs.course_code);
        const headerTotal = isSchool
          ? (() => {
              const s = splitSchoolFeeItems(fs.items, fs.course_code);
              return [...s.oneTime, ...s.tuition, ...s.other].reduce((sum, i) => sum + i.amount, 0);
            })()
          : fs.total;

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
                <div className="text-right">
                  {totalDiscount > 0 ? (
                    <>
                      <span className="text-xs text-muted-foreground line-through mr-1.5">{fmt(fs.total)}</span>
                      <span className="text-sm font-bold text-primary">{fmt(totalAfterDiscount)}</span>
                      <span className="block text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Save {fmt(totalDiscount)} on annual payment</span>
                    </>
                  ) : (
                    <span className="text-sm font-bold text-primary">{fmt(headerTotal)}</span>
                  )}
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>

            {/* Expanded */}
            {isExpanded && (() => {
              const isSchool = isSchoolCourse(fs.course_code);
              const sections = isSchool
                ? splitSchoolFeeItems(fs.items, fs.course_code)
                : { oneTime: [] as FeeItem[], tuition: [] as FeeItem[], boarding: [] as FeeItem[], transport: [] as FeeItem[], other: fs.items };

              const renderItemRows = (items: FeeItem[]) =>
                items.map((item, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2 text-foreground">{item.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.term}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{fmt(item.amount)}</td>
                  </tr>
                ));

              const renderSection = (label: string, items: FeeItem[], bgClass: string) => {
                if (items.length === 0) return null;
                const total = items.reduce((s, i) => s + i.amount, 0);
                return (
                  <div className="border-t border-border">
                    <div className={`px-3 py-1.5 ${bgClass}`}>
                      <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">{label}</p>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Fee</th>
                          <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Term</th>
                          <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody>{renderItemRows(items)}</tbody>
                    </table>
                    <div className="px-3 py-1.5 bg-muted/20 border-t border-border/40 flex items-center justify-end">
                      <span className="text-[11px] font-semibold text-foreground">{fmt(total)}</span>
                    </div>
                  </div>
                );
              };

              return (
                <div className="border-t border-border">
                  {/* Metadata highlights (boarding, discounts, year-wise) */}
                  {renderMetadata(fs.metadata)}

                  {isSchool ? (
                    <>
                      {/* 1. One-Time Fees */}
                      {renderSection("One-Time Fees", sections.oneTime, "bg-pastel-green/30")}

                      {/* 2. Tuition Fee */}
                      {renderSection("Tuition Fee", sections.tuition, "bg-pastel-blue/30")}

                      {/* 3. Boarding Fee */}
                      {/* Day boarder: NB-DBA shown directly */}
                      {studentType === "day_boarder" && sections.boarding.length > 0 &&
                        renderSection("Day Boarding Fee", sections.boarding, "bg-pastel-mint/30")
                      }
                      {/* Boarder: selector for Non-AC / AC C Block / AC B Block */}
                      {studentType === "boarder" && sections.boarding.length > 0 && (() => {
                        const boardingMap: Record<string, { label: string; key: "non_ac" | "ac_central" | "ac_individual"; items: FeeItem[] }> = {
                          non_ac: { label: "Non-AC", key: "non_ac", items: [] },
                          ac_central: { label: "AC C Block", key: "ac_central", items: [] },
                          ac_individual: { label: "AC B Block", key: "ac_individual", items: [] },
                        };
                        for (const b of sections.boarding) {
                          if (b.code.endsWith("NAC") || b.code === "NB-NAC") boardingMap.non_ac.items.push(b);
                          else if (b.code.endsWith("CBA") || b.code === "NB-CBA") boardingMap.ac_central.items.push(b);
                          else if (b.code.endsWith("IBA") || b.code === "NB-IBA") boardingMap.ac_individual.items.push(b);
                          else if (b.code.endsWith("B5")) boardingMap.non_ac.items.push(b);
                          else if (b.code.endsWith("B7")) boardingMap.ac_central.items.push(b);
                        }
                        const types = Object.values(boardingMap).filter(z => z.items.length > 0);
                        const selectedItems = boardingType !== "none" ? (boardingMap[boardingType]?.items || []) : [];
                        const selectedTotal = selectedItems.reduce((s, i) => s + i.amount, 0);

                        return (
                          <div className="border-t border-border">
                            <div className="px-3 py-2 bg-pastel-mint/30 space-y-2">
                              <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Boarding Fee</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  onClick={() => setBoardingType("none")}
                                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${boardingType === "none" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
                                >Select type</button>
                                {types.map(z => {
                                  const perQ = z.items[0]?.amount || 0;
                                  return (
                                    <button
                                      key={z.key}
                                      onClick={() => setBoardingType(z.key)}
                                      className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${boardingType === z.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
                                    >
                                      {z.label} · {fmt(perQ)}/q
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            {boardingType !== "none" && selectedItems.length > 0 && (
                              <>
                                <table className="w-full text-xs">
                                  <thead><tr className="bg-muted/30">
                                    <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Fee</th>
                                    <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Term</th>
                                    <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Amount</th>
                                  </tr></thead>
                                  <tbody>{renderItemRows(selectedItems)}</tbody>
                                </table>
                                <div className="px-3 py-1.5 bg-pastel-mint/20 border-t border-border/40 flex items-center justify-end">
                                  <span className="text-[11px] font-semibold text-foreground">{fmt(selectedTotal)}/year</span>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}

                      {/* Other items (if any) */}
                      {sections.other.length > 0 && renderSection("Other Fees", sections.other, "bg-muted/30")}
                    </>
                  ) : (
                    <>
                      {/* Non-school: single table */}
                      <table className="w-full text-xs">
                        <thead><tr className="bg-muted/50">
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Fee</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Term</th>
                          <th className="px-3 py-2 text-right font-semibold text-muted-foreground uppercase">Amount</th>
                        </tr></thead>
                        <tbody>{renderItemRows(sections.other)}</tbody>
                      </table>
                      <div className="px-3 py-2 bg-muted/30 border-t border-border flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">{sections.other.length} fee items · {fs.session_name}</span>
                        <span className="text-xs font-bold text-primary">{fmt(fs.total)}</span>
                      </div>
                    </>
                  )}

                  {/* Transport section (separate with zone selector) */}
                  {sections.transport.length > 0 && (() => {
                    // Group transport items by zone code suffix (TR1, TR2, TR3)
                    const zoneMap: Record<string, { label: string; key: "zone_1" | "zone_2" | "zone_3"; items: FeeItem[] }> = {
                      zone_1: { label: "Zone 1", key: "zone_1", items: [] },
                      zone_2: { label: "Zone 2", key: "zone_2", items: [] },
                      zone_3: { label: "Zone 3", key: "zone_3", items: [] },
                    };
                    for (const t of sections.transport) {
                      if (t.code.endsWith("TR1")) zoneMap.zone_1.items.push(t);
                      else if (t.code.endsWith("TR2")) zoneMap.zone_2.items.push(t);
                      else if (t.code.endsWith("TR3")) zoneMap.zone_3.items.push(t);
                    }
                    const zones = Object.values(zoneMap).filter(z => z.items.length > 0);
                    const selectedZoneItems = transportZone !== "none" ? (zoneMap[transportZone]?.items || []) : [];
                    const selectedZoneTotal = selectedZoneItems.reduce((s, i) => s + i.amount, 0);

                    return (
                      <div className="border-t-2 border-dashed border-border/60">
                        <div className="px-3 py-2 bg-pastel-yellow/30 space-y-2">
                          <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Transport (optional)</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => setTransportZone("none")}
                              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${transportZone === "none" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
                            >Not Required</button>
                            {zones.map(z => {
                              const perQ = z.items[0]?.amount || 0;
                              return (
                                <button
                                  key={z.key}
                                  onClick={() => setTransportZone(z.key)}
                                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${transportZone === z.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
                                >
                                  {z.label} · {fmt(perQ)}/q
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {transportZone !== "none" && selectedZoneItems.length > 0 && (
                          <>
                            <table className="w-full text-xs">
                              <thead><tr className="bg-muted/30">
                                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Fee</th>
                                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Term</th>
                                <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Amount</th>
                              </tr></thead>
                              <tbody>{renderItemRows(selectedZoneItems)}</tbody>
                            </table>
                            <div className="px-3 py-1.5 bg-pastel-yellow/20 border-t border-border/40 flex items-center justify-end">
                              <span className="text-[11px] font-semibold text-foreground">{fmt(selectedZoneTotal)}/year</span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
