import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText, Eye, Download, CheckCircle, AlertCircle,
  GraduationCap, User, Users, MapPin, BookOpen, Award, Image as ImageIcon,
} from "lucide-react";

export type PreviewDoc = { name: string; url: string };

interface Props {
  app: any;
  docs: PreviewDoc[];
}

/**
 * Read-only preview of a submitted application — used by both
 * /applications/:id (admin view) and the apply portal's "View Submission"
 * tile so staff and students see the same comprehensive layout.
 */
export function ApplicationPreview({ app, docs }: Props) {
  const courses = (app?.course_selections as any[]) || [];
  const photo = docs.find(d => /^(applicant|student)_photo|passport_photo|^photo[-_]/i.test(d.name));
  const otherDocs = docs.filter(d => d !== photo);
  const cs = (app?.completed_sections || {}) as Record<string, boolean>;

  return (
    <div className="space-y-5">
      {/* Section completion */}
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Section Progress</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {Object.entries(cs).map(([key, done]) => (
              <div key={key} className="flex items-center gap-1.5">
                {done ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
                <span className={`capitalize ${done ? "text-foreground" : "text-muted-foreground"}`}>{key.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Photo */}
        <Card className="lg:col-span-1">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <ImageIcon className="h-3 w-3" />Photo
            </p>
            {photo ? (
              <a href={photo.url} target="_blank" rel="noreferrer">
                <img src={photo.url} alt="Photo" className="w-40 h-52 object-cover rounded-lg border border-border" />
              </a>
            ) : (
              <div className="w-40 h-52 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">No photo</div>
            )}
          </CardContent>
        </Card>

        {/* Personal */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <User className="h-3 w-3" />Personal Details
            </p>
            <Row label="Full Name" value={app?.full_name} />
            <Row label="DOB" value={app?.dob} />
            <Row label="Gender" value={app?.gender} />
            <Row label="Category" value={app?.category} />
            <Row label="Nationality" value={app?.nationality} />
            <Row label="Aadhaar" value={app?.aadhaar} />
            <Row label="Phone" value={app?.phone} />
            <Row label="Email" value={app?.email} />
            {app?.apaar_id && <Row label="APAAR ID" value={app.apaar_id} />}
            {app?.pen_number && <Row label="PEN" value={app.pen_number} />}
          </CardContent>
        </Card>
      </div>

      {/* Courses */}
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <GraduationCap className="h-3 w-3" />Course Preferences
          </p>
          {courses.length === 0 ? (
            <p className="text-xs text-muted-foreground">No courses selected</p>
          ) : (
            <div className="space-y-2">
              {courses.map((c: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">#{c.preference_order || i + 1}</span>{" "}
                    <span className="font-medium">{c.course_name}</span>
                  </div>
                  <Badge className="text-[10px] border-0 bg-muted text-muted-foreground">{c.campus_name}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Address */}
      {app?.address && Object.keys(app.address).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <MapPin className="h-3 w-3" />Address
            </p>
            <Row label="Line 1" value={app.address.line1} />
            <Row label="City" value={app.address.city} />
            <Row label="State" value={app.address.state} />
            <Row label="Country" value={app.address.country} />
            <Row label="Pin Code" value={app.address.pin_code} />
          </CardContent>
        </Card>
      )}

      {/* Parents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Users className="h-3 w-3" />Father
            </p>
            <Row label="Name" value={app?.father?.name || `${app?.father?.first_name || ""} ${app?.father?.last_name || ""}`.trim()} />
            <Row label="Phone" value={app?.father?.phone || app?.father?.phone_mobile} />
            <Row label="Email" value={app?.father?.email} />
            <Row label="Occupation" value={app?.father?.occupation || app?.father?.current_position} />
            <Row label="Annual Income" value={app?.father?.annual_income} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Users className="h-3 w-3" />Mother
            </p>
            <Row label="Name" value={app?.mother?.name || `${app?.mother?.first_name || ""} ${app?.mother?.last_name || ""}`.trim()} />
            <Row label="Phone" value={app?.mother?.phone || app?.mother?.phone_mobile} />
            <Row label="Email" value={app?.mother?.email} />
            <Row label="Occupation" value={app?.mother?.occupation || app?.mother?.current_position} />
            <Row label="Annual Income" value={app?.mother?.annual_income} />
          </CardContent>
        </Card>
      </div>

      {/* Academic */}
      {app?.academic_details && Object.keys(app.academic_details).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <BookOpen className="h-3 w-3" />Academic Details
            </p>
            {Object.entries(app.academic_details).map(([level, details]: [string, any]) => {
              if (!details || (Array.isArray(details) && !details.length)) return null;
              return (
                <div key={level} className="mb-3 rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-foreground capitalize mb-2">{level.replace(/_/g, " ")}</p>
                  {Array.isArray(details) ? (
                    details.map((d: any, i: number) => (
                      <div key={i} className="text-[11px] text-muted-foreground mb-1">
                        {Object.entries(d).map(([k, v]) =>
                          v ? <span key={k} className="mr-2">{k}: <span className="text-foreground">{String(v)}</span></span> : null
                        )}
                      </div>
                    ))
                  ) : (
                    Object.entries(details).map(([k, v]) =>
                      v ? <Row key={k} label={k.replace(/_/g, " ")} value={String(v)} /> : null
                    )
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Extracurricular */}
      {app?.extracurricular && Object.values(app.extracurricular).some(Boolean) && (
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Award className="h-3 w-3" />Extracurricular
            </p>
            {Object.entries(app.extracurricular).map(([k, v]) =>
              v ? <Row key={k} label={k.replace(/_/g, " ")} value={String(v)} /> : null
            )}
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <FileText className="h-3 w-3" />Uploaded Documents ({otherDocs.length})
          </p>
          {otherDocs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No documents uploaded</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {otherDocs.map((d, i) => {
                const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(d.name);
                const label = d.name.split("-").slice(0, -1).join("-").replace(/_/g, " ") || d.name;
                return (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      {isImage ? (
                        <img src={d.url} alt={d.name} className="w-9 h-9 rounded object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <p className="font-medium text-foreground capitalize truncate">{label}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={d.url} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary">
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                      <a href={d.url} download className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs border-b border-border/50 last:border-0">
      <span className="text-muted-foreground capitalize">{label}</span>
      <span className="text-foreground text-right font-medium truncate max-w-[60%]">{value}</span>
    </div>
  );
}
