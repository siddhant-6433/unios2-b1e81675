import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle } from "lucide-react";

interface SeatRow {
  course_id: string;
  course_name: string;
  course_code: string;
  department_name: string;
  campus_name: string;
  institution_type: string;
  total_seats: number;
  admitted: number;
  available: number;
  pipeline_leads: number;
}

export function SeatMatrix() {
  const [rows, setRows] = useState<SeatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [campusFilter, setCampusFilter] = useState("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("seat_matrix" as any)
        .select("*")
        .order("campus_name")
        .order("course_name");
      if (data) setRows(data as any);
      setLoading(false);
    })();
  }, []);

  const collegeRows = rows.filter((r) => r.institution_type !== "school");
  const schoolRows = rows.filter((r) => r.institution_type === "school");

  const campuses = [...new Set(collegeRows.map((r) => r.campus_name))];
  const filteredCollege = campusFilter === "all" ? collegeRows : collegeRows.filter((r) => r.campus_name === campusFilter);
  const filteredSchool = campusFilter === "all" ? schoolRows : schoolRows.filter((r) => r.campus_name === campusFilter);

  const totals = filteredCollege.reduce(
    (acc, r) => ({
      seats: acc.seats + r.total_seats,
      admitted: acc.admitted + r.admitted,
      available: acc.available + r.available,
      pipeline: acc.pipeline + r.pipeline_leads,
    }),
    { seats: 0, admitted: 0, available: 0, pipeline: 0 }
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const fillPct = (admitted: number, total: number) => (total > 0 ? Math.round((admitted / total) * 100) : 0);
  const fillColor = (pct: number) =>
    pct >= 95 ? "bg-destructive/50" : pct >= 80 ? "bg-warning/50" : pct >= 50 ? "bg-primary" : "bg-primary/60";
  const fillBadge = (pct: number) =>
    pct >= 95
      ? "bg-destructive/10 text-destructive dark:bg-destructive/80/30 dark:text-destructive/80"
      : pct >= 80
        ? "bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning"
        : "bg-success/10 text-success dark:bg-success/80/30 dark:text-success";

  const schoolAdmitted = schoolRows.reduce((s, r) => s + r.admitted, 0);

  return (
    <div className="space-y-4">
      {/* Summary cards — college seats only */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card
          className="border-border/60 shadow-none hover:elevation-mid hover:-translate-y-1 transition-all duration-280 ease-standard animate-rs-slide-up"
          style={{ animationDelay: "0ms" }}
        >
          <CardContent className="p-4 text-center">
            <p className="text-xs font-medium text-muted-foreground">College Seats</p>
            <p className="text-2xl font-bold text-foreground mt-2 tabular-nums">{totals.seats}</p>
          </CardContent>
        </Card>
        <Card
          className="border-border/60 shadow-none hover:elevation-mid hover:-translate-y-1 transition-all duration-280 ease-standard animate-rs-slide-up"
          style={{ animationDelay: "60ms" }}
        >
          <CardContent className="p-4 text-center">
            <p className="text-xs font-medium text-muted-foreground">College Admitted</p>
            <p className="text-2xl font-bold text-primary mt-2 tabular-nums">{totals.admitted}</p>
          </CardContent>
        </Card>
        <Card
          className="border-border/60 shadow-none hover:elevation-mid hover:-translate-y-1 transition-all duration-280 ease-standard animate-rs-slide-up"
          style={{ animationDelay: "120ms" }}
        >
          <CardContent className="p-4 text-center">
            <p className="text-xs font-medium text-muted-foreground">Available</p>
            <p className="text-2xl font-bold text-success mt-2 tabular-nums">{totals.available}</p>
          </CardContent>
        </Card>
        <Card
          className="border-border/60 shadow-none hover:elevation-mid hover:-translate-y-1 transition-all duration-280 ease-standard animate-rs-slide-up"
          style={{ animationDelay: "180ms" }}
        >
          <CardContent className="p-4 text-center">
            <p className="text-xs font-medium text-muted-foreground">In Pipeline</p>
            <p className="text-2xl font-bold text-warning-foreground mt-2 tabular-nums">{totals.pipeline}</p>
          </CardContent>
        </Card>
        {schoolRows.length > 0 && (
          <Card
            className="border-border/60 shadow-none border-primary/20 dark:border-primary/50 hover:elevation-mid hover:-translate-y-1 transition-all duration-280 ease-standard animate-rs-slide-up"
            style={{ animationDelay: "240ms" }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-xs font-medium text-muted-foreground">School Enrolled</p>
              <p className="text-2xl font-bold text-primary mt-2 tabular-nums">{schoolAdmitted}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Campus filter (college campuses only) */}
      {campuses.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setCampusFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${campusFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            All Campuses
          </button>
          {campuses.map((c) => (
            <button
              key={c}
              onClick={() => setCampusFilter(c)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${campusFilter === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* College Seat Matrix */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campus</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Intake</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Admitted</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Available</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pipeline</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide min-w-[140px]">Fill %</th>
              </tr>
            </thead>
            <tbody>
              {filteredCollege.map((row) => {
                const pct = fillPct(row.admitted, row.total_seats);
                return (
                  <tr key={row.course_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{row.course_name}</div>
                      <div className="text-xs text-muted-foreground">{row.course_code} · {row.department_name}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.campus_name}</td>
                    <td className="px-4 py-3 text-center font-semibold text-foreground">{row.total_seats || "—"}</td>
                    <td className="px-4 py-3 text-center font-semibold text-primary">{row.admitted}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${row.available <= 5 && row.total_seats > 0 ? "text-destructive" : "text-success"}`}>
                        {row.total_seats > 0 ? row.available : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{row.pipeline_leads}</td>
                    <td className="px-4 py-3">
                      {row.total_seats > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${fillColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <Badge className={`text-[10px] font-semibold border-0 min-w-[40px] justify-center ${fillBadge(pct)}`}>
                            {pct}%
                          </Badge>
                          {pct >= 95 && <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No intake set</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredCollege.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No college courses found</td>
                </tr>
              )}
            </tbody>
            {filteredCollege.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3 text-foreground">Total ({filteredCollege.length} courses)</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-center text-foreground">{totals.seats}</td>
                  <td className="px-4 py-3 text-center text-primary">{totals.admitted}</td>
                  <td className="px-4 py-3 text-center text-success">{totals.available}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{totals.pipeline}</td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] font-semibold border-0 ${fillBadge(fillPct(totals.admitted, totals.seats))}`}>
                      {fillPct(totals.admitted, totals.seats)}% overall
                    </Badge>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      {/* School Admissions — separate section */}
      {filteredSchool.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">School Admissions</h3>
            <Badge className="bg-primary/10 text-primary dark:bg-primary/80/30 dark:text-primary/50 border-0 text-[10px]">
              {filteredSchool.reduce((s, r) => s + r.admitted, 0)} enrolled
            </Badge>
          </div>
          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-primary/5/50 dark:bg-primary/90/10">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Programme / Grade</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campus</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Enrolled</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchool.map((row) => (
                    <tr key={row.course_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{row.course_name}</div>
                        <div className="text-xs text-muted-foreground">{row.department_name}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.campus_name}</td>
                      <td className="px-4 py-3 text-center font-semibold text-primary">{row.admitted}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{row.pipeline_leads}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="px-4 py-3 text-foreground">Total ({filteredSchool.length} programmes)</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-center text-primary">
                      {filteredSchool.reduce((s, r) => s + r.admitted, 0)}
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {filteredSchool.reduce((s, r) => s + r.pipeline_leads, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
