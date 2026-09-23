import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileCheck2, FileClock, FileText, FileX2, Search, Users } from "lucide-react";

import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import { supabase } from "@/integrations/supabase/client";
import { exportRowsPdf } from "@/lib/pdfExport";
import { fetchReportStudentArchiveStatuses } from "@/lib/reportStudentArchiveStatus";
import { exportRowsXlsx } from "@/lib/xlsxExport";
import {
  candidateDocumentExportRows,
  candidateDocumentKpis,
  candidateIdentifier,
  candidateDocumentPdfRows,
  filterCandidateDocumentRows,
  pendencyLabel,
  stageLabel,
  type CandidateDocumentFilters,
  type CandidateDocumentRow,
} from "@/lib/candidateDocumentReport";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";

const emptyFilters = {
  query: "",
  stage: "all",
  upload: "all",
  studentStatus: "active",
  pendency: [],
  grade: "all",
};

const pendencyOptions = [
  { value: "complete", label: "Complete", description: "All required documents are verified." },
  { value: "pending", label: "Pending review", description: "Uploaded and awaiting verification." },
  { value: "missing", label: "Missing", description: "A required document has not been uploaded." },
  { value: "rejected", label: "Rejected", description: "An uploaded document was rejected." },
];

const asRows = (data: unknown): CandidateDocumentRow[] => {
  const rows = (data as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows as CandidateDocumentRow[] : [];
};

const statusVariant = (row: CandidateDocumentRow) => {
  if (row.complete) return "default";
  if (row.rejected_count > 0) return "destructive";
  if (row.missing_count > 0) return "secondary";
  return "outline";
};

const documentStateLabel = (state?: string | null) => state === "pending" ? "Pending review" : state || "Pending review";

const pendencyFilterLabel = (selected: string[]) => {
  if (selected.length === 0) return "All statuses";
  if (selected.length === 1 && selected[0] === "incomplete") return "All except complete";
  return pendencyOptions.filter((option) => selected.includes(option.value)).map((option) => option.label).join(", ");
};

const KpiCard = ({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) => (
  <Card className="rounded-lg">
    <CardContent className="flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold text-foreground">{value.toLocaleString("en-IN")}</p>
      </div>
    </CardContent>
  </Card>
);

export function CandidateDocumentPendencyReport() {
  const { selectedCampusId, selectedCampusName } = useCampus();
  const { role } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<CandidateDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [filters, setFilters] = useState<CandidateDocumentFilters>(emptyFilters);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: { _campus_ids: string[] | null },
      ) => Promise<{ data: unknown; error: { message: string } | null }>)("candidate_document_pendency_report", {
        _campus_ids: selectedCampusId === "all" ? null : [selectedCampusId],
      });
      if (cancelled) return;
      if (error) {
        toast({ title: "Failed to load document report", description: error.message, variant: "destructive" });
        setRows([]);
      } else {
        const reportRows = asRows(data);
        const studentIds = [...new Set(reportRows.map((row) => row.student_id).filter(Boolean) as string[])];
        let statusByStudent;
        try {
          statusByStudent = await fetchReportStudentArchiveStatuses(studentIds);
        } catch (statusError) {
          if (cancelled) return;
          toast({
            title: "Failed to load student status",
            description: statusError instanceof Error ? statusError.message : String(statusError),
            variant: "destructive",
          });
          setRows([]);
          setLoading(false);
          return;
        }
        setRows(reportRows.map((row) => ({
          ...row,
          student_status: row.student_id
            ? (statusByStudent.get(row.student_id) as CandidateDocumentRow["student_status"] | undefined) || "unknown"
            : "not_applicable",
        })));
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedCampusId, toast]);

  const gradeOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.grade || row.course_name).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const filteredRows = useMemo(() => filterCandidateDocumentRows(rows, filters), [rows, filters]);
  const kpis = useMemo(() => candidateDocumentKpis(filteredRows), [filteredRows]);

  useEffect(() => {
    if (filters.grade !== "all" && !gradeOptions.includes(filters.grade)) {
      setFilters((current) => ({ ...current, grade: "all" }));
    }
  }, [filters.grade, gradeOptions]);

  const updateFilter = (key: Exclude<keyof typeof emptyFilters, "pendency">, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleExpanded = (key: string) => {
    setExpanded((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const togglePendency = (value: string) => {
    setFilters((current) => {
      const selected = current.pendency.filter((status) => status !== "incomplete");
      return {
        ...current,
        pendency: selected.includes(value)
          ? selected.filter((status) => status !== value)
          : [...selected, value],
      };
    });
  };

  const handleExport = async () => {
    const exportRows = candidateDocumentExportRows(filteredRows);
    if (exportRows.length === 0) {
      toast({ title: "Nothing to export" });
      return;
    }
    setExporting(true);
    try {
      await exportRowsXlsx(exportRows, "Document Pendency", "candidate-document-pendency", {
        unmask: role === "super_admin",
      });
      toast({ title: "Export ready", description: `${exportRows.length} candidates exported.` });
    } finally {
      setExporting(false);
    }
  };

  const handlePdfExport = async () => {
    const exportRows = candidateDocumentPdfRows(filteredRows);
    if (exportRows.length === 0) {
      toast({ title: "Nothing to export" });
      return;
    }

    const subtitle = [
      selectedCampusName,
      `Students: ${filters.studentStatus === "all" ? "All" : filters.studentStatus}`,
      filters.stage !== "all" ? `Stage: ${stageLabel(filters.stage)}` : null,
      filters.upload !== "all" ? `Upload: ${filters.upload}` : null,
      filters.pendency.length > 0 ? `Status: ${pendencyFilterLabel(filters.pendency)}` : null,
      filters.grade !== "all" ? `Grade / Course: ${filters.grade}` : null,
      filters.query ? `Search: ${filters.query}` : null,
    ].filter(Boolean).join(" · ");

    setExportingPdf(true);
    try {
      await exportRowsPdf(exportRows, "Candidate Document Pendency", "candidate-document-pendency", {
        unmask: role === "super_admin",
        brand: {
          logoSrc: nimtLogo,
          org: "NIMT Educational Institutions",
          contactLine: "9555192192 · admissions@nimt.ac.in · www.nimt.ac.in",
          subtitle,
        },
      });
      toast({ title: "PDF ready", description: `${exportRows.length} candidates exported.` });
    } catch (error) {
      toast({
        title: "PDF export failed",
        description: error instanceof Error ? error.message : "Could not generate the PDF.",
        variant: "destructive",
      });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <KpiCard icon={Users} label="Candidates" value={kpis.total} />
        <KpiCard icon={FileCheck2} label="Upload Yes" value={kpis.uploadedYes} />
        <KpiCard icon={FileX2} label="Upload No" value={kpis.uploadedNo} />
        <KpiCard icon={FileCheck2} label="Complete" value={kpis.complete} />
        <KpiCard icon={FileClock} label="Incomplete" value={kpis.incomplete} />
      </div>

      <Card className="rounded-lg">
        <CardContent className="space-y-3 p-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search candidates"
                className="pl-9"
                placeholder="Search candidates, IDs, files"
                value={filters.query}
                onChange={(event) => updateFilter("query", event.target.value)}
              />
            </div>
            <Select value={filters.stage} onValueChange={(value) => updateFilter("stage", value)}>
              <SelectTrigger aria-label="Candidate stage">
                <SelectValue placeholder="Stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                <SelectItem value="application">Application</SelectItem>
                <SelectItem value="pre_admitted">Pre-admitted</SelectItem>
                <SelectItem value="admitted">Admitted</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.upload} onValueChange={(value) => updateFilter("upload", value)}>
              <SelectTrigger aria-label="Upload status">
                <SelectValue placeholder="Upload" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All uploads</SelectItem>
                <SelectItem value="Yes">Upload Yes</SelectItem>
                <SelectItem value="No">Upload No</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.studentStatus} onValueChange={(value) => updateFilter("studentStatus", value)}>
              <SelectTrigger aria-label="Student status">
                <SelectValue placeholder="Student status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active students</SelectItem>
                <SelectItem value="archived">Archived students</SelectItem>
                <SelectItem value="all">All students</SelectItem>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="justify-between font-normal" aria-label="Document status filter">
                  <span className="truncate">{pendencyFilterLabel(filters.pendency)}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-2">
                <div className="flex items-center justify-between gap-2 border-b px-2 pb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => setFilters((current) => ({ ...current, pendency: ["incomplete"] }))}
                  >
                    All except complete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground"
                    onClick={() => setFilters((current) => ({ ...current, pendency: [] }))}
                  >
                    Clear
                  </Button>
                </div>
                <div className="space-y-1 pt-2">
                  {pendencyOptions.map((option) => (
                    <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted">
                      <Checkbox
                        checked={filters.pendency.includes(option.value)}
                        onCheckedChange={() => togglePendency(option.value)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">{option.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Select value={filters.grade} onValueChange={(value) => updateFilter("grade", value)}>
              <SelectTrigger aria-label="School grade">
                <SelectValue placeholder="Grade / course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All grades/courses</SelectItem>
                {gradeOptions.map((grade) => (
                  <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button onClick={handleExport} disabled={exporting || exportingPdf} className="gap-2" variant="outline">
              {exporting ? <ButtonOrb className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              Excel
            </Button>
            <Button onClick={handlePdfExport} disabled={exporting || exportingPdf} className="gap-2" variant="outline">
              {exportingPdf ? <ButtonOrb state="composing" className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              PDF
            </Button>
          </div>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center">
              <OrbLoader size={64} />
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 whitespace-nowrap" />
                  <TableHead className="min-w-44 whitespace-nowrap">Candidate</TableHead>
                  <TableHead className="min-w-36 whitespace-nowrap">Campus</TableHead>
                  <TableHead className="min-w-32 whitespace-nowrap">Grade / Course</TableHead>
                  <TableHead className="whitespace-nowrap">Student Status</TableHead>
                  <TableHead className="whitespace-nowrap">Stage</TableHead>
                  <TableHead className="whitespace-nowrap">Upload</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="min-w-48 whitespace-nowrap">Files</TableHead>
                  <TableHead className="min-w-56 whitespace-nowrap">Outstanding Documents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                      No candidates match these filters.
                    </TableCell>
                  </TableRow>
                ) : filteredRows.map((row) => {
                  const isExpanded = expanded.includes(row.candidate_key);
                  return (
                    <Fragment key={row.candidate_key}>
                      <TableRow>
                        <TableCell>
                          <Button
                            aria-label={`Toggle documents for ${row.name}`}
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => toggleExpanded(row.candidate_key)}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">{row.name}</div>
                          <div className="text-xs text-muted-foreground">{candidateIdentifier(row)}</div>
                        </TableCell>
                        <TableCell className="whitespace-normal">{row.campus_name || "Unassigned"}</TableCell>
                        <TableCell className="whitespace-normal">{row.grade || row.course_name || "—"}</TableCell>
                        <TableCell>
                          {row.student_status === "archived" ? (
                            <Badge variant="secondary">Archived</Badge>
                          ) : row.student_id ? (
                            row.student_status === "active" ? <Badge variant="outline">Active</Badge> : "Unknown"
                          ) : "—"}
                        </TableCell>
                        <TableCell>{stageLabel(row.candidate_stage)}</TableCell>
                        <TableCell>
                          <Badge variant={row.document_upload === "Yes" ? "default" : "secondary"}>
                            {row.document_upload}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(row)}>{pendencyLabel(row)}</Badge>
                        </TableCell>
                        <TableCell className="max-w-64 whitespace-normal break-words" title={row.uploaded_file_names.join(", ")}>
                          {row.uploaded_file_names.length ? row.uploaded_file_names.join(", ") : "—"}
                        </TableCell>
                        <TableCell className="max-w-64 whitespace-normal break-words" title={row.pending_documents.join(", ")}>
                          {row.pending_documents.length ? row.pending_documents.join(", ") : "—"}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell />
                          <TableCell colSpan={9} className="bg-muted/30">
                            <div className="grid gap-2 md:grid-cols-2">
                              {row.documents.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No document detail available.</p>
                              ) : row.documents.map((doc, index) => (
                                <div key={`${doc.key || doc.label || index}-${index}`} className="rounded-md border bg-background p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">{doc.label || doc.key || "Document"}</p>
                                      <p className="truncate text-xs text-muted-foreground">{doc.file_name || "No file uploaded"}</p>
                                    </div>
                                    <Badge variant={doc.state === "verified" || doc.state === "uploaded" ? "default" : "outline"}>
                                      {documentStateLabel(doc.state || doc.status)}
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
