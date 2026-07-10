import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Save } from "lucide-react";
import {
  getScholarshipsForCourse,
  findMeritRow,
  findEntranceRow,
  ENTRANCE_SLABS,
  RENEWAL_POLICY_NOTE,
  type EntranceSlab,
} from "@nimt/scholarship-slabs";

interface Props {
  leadId: string;
  courseId: string;
  /** Existing values from the lead row */
  initialQualifyingPercent: number | null;
  initialEntranceScores: Record<string, number> | null;
  onSaved?: () => void;
}

interface CourseContext {
  name: string;
  code: string;
  slug: string | null;
  baseFee: number | null;
  baseFeeSource: "fee_structure_metadata" | "fee_per_year" | null;
}

/** Map an EntranceSlab back to its key in ENTRANCE_SLABS (e.g. "cat-mba"). */
function examKeyFor(slab: EntranceSlab): string | null {
  for (const [k, s] of Object.entries(ENTRANCE_SLABS)) {
    if (s === slab) return k;
  }
  // Fallback: match by exam + fullName when references differ
  for (const [k, s] of Object.entries(ENTRANCE_SLABS)) {
    if (s.exam === slab.exam && s.fullName === slab.fullName) return k;
  }
  return null;
}

export function ScholarshipCalculator({
  leadId,
  courseId,
  initialQualifyingPercent,
  initialEntranceScores,
  onSaved,
}: Props) {
  const { toast } = useToast();

  const [ctx, setCtx] = useState<CourseContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(true);

  const [qualifyingPercent, setQualifyingPercent] = useState<string>(
    initialQualifyingPercent != null ? String(initialQualifyingPercent) : ""
  );
  const [scores, setScores] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (initialEntranceScores && typeof initialEntranceScores === "object") {
      for (const [k, v] of Object.entries(initialEntranceScores)) {
        if (typeof v === "number") out[k] = String(v);
      }
    }
    return out;
  });
  const [saving, setSaving] = useState(false);

  // Fetch course + active fee structure year-1 fee
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCtx(true);
      const { data: course } = await supabase
        .from("courses")
        .select("name, code, webflow_slug, fee_per_year")
        .eq("id", courseId)
        .maybeSingle();

      const { data: fs } = await supabase
        .from("fee_structures")
        .select("metadata")
        .eq("course_id", courseId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let baseFee: number | null = null;
      let source: CourseContext["baseFeeSource"] = null;
      const meta = (fs?.metadata as any) || null;
      if (meta?.year_1?.fee) {
        baseFee = Number(meta.year_1.fee);
        source = "fee_structure_metadata";
      } else if (course?.fee_per_year) {
        baseFee = Number(course.fee_per_year);
        source = "fee_per_year";
      }

      if (!cancelled) {
        setCtx({
          name: course?.name || "",
          code: course?.code || "",
          slug: course?.webflow_slug || null,
          baseFee,
          baseFeeSource: source,
        });
        setLoadingCtx(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const slabs = useMemo(() => {
    if (!ctx) return null;
    return getScholarshipsForCourse(ctx.slug || "", ctx.name, ctx.code);
  }, [ctx]);

  const applicableExams = useMemo(() => {
    if (!slabs?.entrance) return [];
    return slabs.entrance
      .map((slab) => {
        const key = examKeyFor(slab);
        return key ? { key, slab } : null;
      })
      .filter((x): x is { key: string; slab: EntranceSlab } => x !== null);
  }, [slabs]);

  type Option = {
    kind: "merit" | "entrance";
    label: string;
    band: string;
    percent: number;
    scholarship: number;
    netFee: number;
    isWinner: boolean;
  };

  const options = useMemo<Option[]>(() => {
    if (!ctx || !ctx.baseFee || !slabs) return [];

    const qp = qualifyingPercent ? Number(qualifyingPercent) : undefined;
    const scoreMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(scores)) {
      const n = Number(v);
      if (!Number.isNaN(n) && v !== "") scoreMap[k] = n;
    }

    const base = ctx.baseFee;
    const out: Option[] = [];

    // Merit option
    if (slabs.merit && slabs.meritTier && qp != null && !Number.isNaN(qp)) {
      const row = findMeritRow(slabs.meritTier, qp);
      if (row) {
        const scholarship = Math.round((base * row.percentValue) / 100);
        out.push({
          kind: "merit",
          label: `Merit (${slabs.merit.basisLabel})`,
          band: row.band,
          percent: row.percentValue,
          scholarship,
          netFee: base - scholarship,
          isWinner: false,
        });
      }
    }

    // Entrance options (one per applicable exam with a score entered)
    for (const { key, slab } of applicableExams) {
      const score = scoreMap[key];
      if (score == null || Number.isNaN(score)) continue;
      const row = findEntranceRow(key, score);
      if (!row) continue;
      const scholarship = Math.round((base * row.percentValue) / 100);
      out.push({
        kind: "entrance",
        label: `${slab.fullName} ${slab.scoreType === "rank" ? "Rank" : "Percentile"}`,
        band: row.band,
        percent: row.percentValue,
        scholarship,
        netFee: base - scholarship,
        isWinner: false,
      });
    }

    if (out.length === 0) return [];

    // Winner = highest percent; tie → entrance preferred (matches package strategy)
    const winnerIdx = out.reduce((bestIdx, opt, i) => {
      const best = out[bestIdx];
      if (opt.percent > best.percent) return i;
      if (opt.percent === best.percent && opt.kind === "entrance" && best.kind === "merit") return i;
      return bestIdx;
    }, 0);
    out[winnerIdx].isWinner = true;

    return out;
  }, [ctx, slabs, qualifyingPercent, scores, applicableExams]);

  const handleSave = async () => {
    setSaving(true);
    const qp = qualifyingPercent === "" ? null : Number(qualifyingPercent);
    const scoreMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(scores)) {
      const n = Number(v);
      if (!Number.isNaN(n) && v !== "") scoreMap[k] = n;
    }
    const { error } = await supabase
      .from("leads")
      .update({
        qualifying_percent: qp,
        entrance_scores: Object.keys(scoreMap).length > 0 ? scoreMap : null,
      })
      .eq("id", leadId);

    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Scholarship inputs saved" });
    onSaved?.();
  };

  if (loadingCtx) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-4 flex h-16 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!ctx || (!slabs?.merit && (!slabs?.entrance || slabs.entrance.length === 0))) {
    return null;
  }

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const hasInput =
    qualifyingPercent !== "" || Object.values(scores).some((v) => v !== "");

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Scholarship Calculator
          </h3>
          {ctx.baseFee && (
            <span className="text-[10px] text-muted-foreground">
              Year-1 base · {fmt(ctx.baseFee)}
            </span>
          )}
        </div>

        {!ctx.baseFee && (
          <p className="text-[11px] text-warning-foreground dark:text-warning">
            No year-1 base fee found for this course. Add a fee structure or set{" "}
            <code className="text-[10px]">courses.fee_per_year</code> to enable
            the calculator.
          </p>
        )}

        {/* Inputs */}
        <div className="space-y-2">
          {slabs?.merit && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {slabs.merit.basisLabel}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max="100"
                placeholder="e.g. 88"
                value={qualifyingPercent}
                onChange={(e) => setQualifyingPercent(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          {applicableExams.map(({ key, slab }) => (
            <div key={key} className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {slab.fullName} {slab.scoreType === "rank" ? "Rank" : "Percentile"}
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                step={slab.scoreType === "percentile" ? "0.1" : "1"}
                min="0"
                placeholder={
                  slab.scoreType === "rank" ? "e.g. 20000" : "e.g. 75"
                }
                value={scores[key] || ""}
                onChange={(e) =>
                  setScores((s) => ({ ...s, [key]: e.target.value }))
                }
                className="h-8 text-xs"
              />
            </div>
          ))}
        </div>

        {/* Comparison table — merit vs entrance options, winner highlighted */}
        {options.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-2.5 py-1.5 bg-muted/30 border-b border-border/60 flex items-center justify-between">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Scholarship Options
              </p>
              <p className="text-[9px] text-muted-foreground italic">
                Only the highlighted one is offered.
              </p>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground bg-muted/10">
                  <th className="text-left font-medium px-2.5 py-1">Source</th>
                  <th className="text-right font-medium px-2 py-1">%</th>
                  <th className="text-right font-medium px-2 py-1">Scholarship</th>
                  <th className="text-right font-medium px-2.5 py-1">Net Year-1</th>
                </tr>
              </thead>
              <tbody>
                {options.map((opt, i) => (
                  <tr
                    key={`${opt.kind}-${i}`}
                    className={
                      opt.isWinner
                        ? "bg-success/5/60 dark:bg-success/90/20 border-t border-success/20/60 dark:border-success/60/40"
                        : "border-t border-border/40 opacity-70"
                    }
                  >
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground">{opt.label}</span>
                        {opt.isWinner && (
                          <Badge
                            variant="outline"
                            className="text-[8px] px-1 py-0 h-3.5 border-success/30 dark:border-success/50 text-success dark:text-success"
                          >
                            Offered
                          </Badge>
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground">Band: {opt.band}</p>
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-foreground">
                      {opt.percent}%
                    </td>
                    <td className="px-2 py-1.5 text-right text-success dark:text-success font-medium">
                      -{fmt(opt.scholarship)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-bold text-primary">
                      {fmt(opt.netFee)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {ctx.baseFee && (
                <tfoot>
                  <tr className="border-t border-border/60 bg-muted/20">
                    <td className="px-2.5 py-1 text-[10px] text-muted-foreground" colSpan={3}>
                      Base year-1 fee
                    </td>
                    <td className="px-2.5 py-1 text-right text-[10px] text-muted-foreground">
                      {fmt(ctx.baseFee)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : hasInput && ctx.baseFee ? (
          <p className="text-[11px] text-muted-foreground italic">
            Inputs don't qualify for any scholarship slab on this course.
          </p>
        ) : null}

        {/* Save */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] text-muted-foreground italic leading-snug">
            {RENEWAL_POLICY_NOTE}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={saving}
            className="h-7 text-[11px] gap-1 shrink-0"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
