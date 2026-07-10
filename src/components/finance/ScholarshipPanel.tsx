import { useMemo } from "react";
import {
  getScholarshipsForCourse,
  isCAHETProgramme,
  RENEWAL_POLICY_NOTE,
  type MeritSlab,
  type EntranceSlab,
} from "@nimt/scholarship-slabs";

interface Props {
  slug?: string | null;
  name?: string | null;
  code?: string | null;
}

export function ScholarshipPanel({ slug, name, code }: Props) {
  const data = useMemo(() => {
    if (!slug && !name && !code) return null;
    return getScholarshipsForCourse(slug || "", name || undefined, code || undefined);
  }, [slug, name, code]);

  const cahet = useMemo(
    () => isCAHETProgramme(slug || "", name || undefined, code || undefined),
    [slug, name, code]
  );

  const hasMerit = !!data?.merit;
  const hasEntrance = !!data?.entrance && data.entrance.length > 0;

  if (!hasMerit && !hasEntrance && !cahet) return null;

  return (
    <div className="border-t border-border">
      <div className="px-3 py-1.5 bg-pastel-purple/30">
        <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">
          Scholarships Available
        </p>
      </div>

      {(hasMerit && hasEntrance) && (
        <div className="px-3 py-1.5 bg-warning/5/50 dark:bg-warning/90/10 border-t border-border/40">
          <p className="text-[10px] text-foreground">
            <span className="font-semibold">Either merit or entrance applies</span>
            {" — "}whichever gives the higher scholarship. Not both.
          </p>
        </div>
      )}

      {cahet && (
        <div className="px-3 py-2 text-[11px] text-foreground bg-warning/5/50 dark:bg-warning/90/10 border-t border-border/40">
          Admission via CAHET counselling (ABVMU Lucknow). No separate institute
          entrance exam — slabs below apply once counselling allocates a seat.
        </div>
      )}

      {hasMerit && <MeritTable slab={data!.merit!} />}

      {hasEntrance &&
        data!.entrance!.map((slab, i) => (
          <EntranceTable key={`${slab.exam}-${i}`} slab={slab} />
        ))}

      <div className="px-3 py-2 bg-muted/20 border-t border-border/40">
        <p className="text-[10px] text-muted-foreground italic leading-snug">
          {RENEWAL_POLICY_NOTE}
        </p>
      </div>
    </div>
  );
}

function MeritTable({ slab }: { slab: MeritSlab }) {
  return (
    <div className="px-3 py-2 border-t border-border/30">
      <p className="text-[10px] font-medium text-muted-foreground mb-1.5">
        Merit-based · {slab.basisLabel}
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium pb-1">{slab.basisLabel}</th>
            <th className="text-right font-medium pb-1">Scholarship</th>
            <th className="text-right font-medium pb-1 hidden sm:table-cell">Year-1 Fee</th>
          </tr>
        </thead>
        <tbody>
          {slab.rows.map((row, i) => (
            <tr key={i} className="border-t border-border/30">
              <td className="py-1 text-foreground">{row.band}</td>
              <td className="py-1 text-right font-semibold text-primary">{row.percent}</td>
              <td className="py-1 text-right text-muted-foreground hidden sm:table-cell">
                {row.fee || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntranceTable({ slab }: { slab: EntranceSlab }) {
  return (
    <div className="px-3 py-2 border-t border-border/30">
      <p className="text-[10px] font-medium text-muted-foreground mb-1.5">
        {slab.fullName} · {slab.basisLabel}
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium pb-1">{slab.basisLabel}</th>
            <th className="text-right font-medium pb-1">Scholarship</th>
          </tr>
        </thead>
        <tbody>
          {slab.rows.map((row, i) => (
            <tr key={i} className="border-t border-border/30">
              <td className="py-1 text-foreground">{row.band}</td>
              <td className="py-1 text-right font-semibold text-primary">{row.percent}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
