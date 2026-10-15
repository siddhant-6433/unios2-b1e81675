import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AcademicError, AcademicField, AcademicPanel, academicInput, readableAcademicError } from "@/components/beacon/AcademicFields";
import { Button } from "@/components/ui/button";

type Props = { configuration: any; disabled: boolean };
type EventRow = { id: string; institution_id: string; session_id: string; title: string; event_type: string; starts_on: string; ends_on: string; notes: string | null; no_school: boolean; blocks_exams: boolean; status: string };
const TYPES = ["holiday", "vacation", "school_event", "activity", "ptm", "result_day", "other"];

export function SchoolCalendarManager({ configuration, disabled }: Props) {
  const [institutionId, setInstitutionId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("holiday");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [notes, setNotes] = useState("");
  const [noSchool, setNoSchool] = useState(true);
  const [blocksExams, setBlocksExams] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const institutions = useMemo(() => Array.from(new Map(configuration.courses.map((c: any) => [c.institution_id, { id: c.institution_id, name: c.institution_name }])).values()) as Array<{id:string;name:string}>, [configuration.courses]);
  useEffect(() => { if (!institutionId && institutions[0]) setInstitutionId(institutions[0].id); if (!sessionId && configuration.sessions[0]) setSessionId(configuration.sessions[0].id); }, [institutions, configuration.sessions, institutionId, sessionId]);
  const load = useCallback(async () => {
    if (!institutionId || !sessionId) return;
    const { data, error: queryError } = await (supabase as any).from("school_calendar_events").select("*").eq("institution_id", institutionId).eq("session_id", sessionId).order("starts_on");
    if (queryError) setError(readableAcademicError(queryError)); else setEvents((data ?? []) as EventRow[]);
  }, [institutionId, sessionId]);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    if (!title.trim() || !startsOn || !endsOn || endsOn < startsOn) return;
    setBusy(true); setError(null);
    const { error: saveError } = await (supabase as any).from("school_calendar_events").insert({ institution_id: institutionId, session_id: sessionId, title: title.trim(), event_type: eventType, starts_on: startsOn, ends_on: endsOn, notes: notes.trim() || null, no_school: noSchool, blocks_exams: noSchool && blocksExams, created_by: (await supabase.auth.getUser()).data.user?.id });
    setBusy(false);
    if (saveError) { setError(readableAcademicError(saveError)); return; }
    setTitle(""); setNotes(""); await load();
  };
  const setStatus = async (event: EventRow, status: string) => {
    setBusy(true); setError(null);
    const { error: updateError } = await (supabase as any).from("school_calendar_events").update({ status, ...(status === "published" ? { published_by: (await supabase.auth.getUser()).data.user?.id, published_at: new Date().toISOString() } : {}) }).eq("id", event.id);
    setBusy(false); if (updateError) setError(readableAcademicError(updateError)); else await load();
  };
  return <div className="space-y-4"><AcademicError message={error}/><AcademicPanel title="Student calendar and almanac" description="Plan school holidays, vacations, events, activities, PTMs and result days for each campus and session. Published no-school dates block datesheet finalisation when they overlap an exam.">
    <div className="grid gap-3 sm:grid-cols-2"><AcademicField label="Campus / institution"><select className={academicInput} value={institutionId} onChange={e=>setInstitutionId(e.target.value)}>{institutions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></AcademicField><AcademicField label="Academic session"><select className={academicInput} value={sessionId} onChange={e=>setSessionId(e.target.value)}>{configuration.sessions.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></AcademicField></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><AcademicField label="Event title"><input className={academicInput} value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Diwali break"/></AcademicField><AcademicField label="Type"><select className={academicInput} value={eventType} onChange={e=>setEventType(e.target.value)}>{TYPES.map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></AcademicField><AcademicField label="Starts"><input type="date" className={academicInput} value={startsOn} onChange={e=>setStartsOn(e.target.value)}/></AcademicField><AcademicField label="Ends"><input type="date" className={academicInput} value={endsOn} onChange={e=>setEndsOn(e.target.value)}/></AcademicField><AcademicField label="Notes"><input className={academicInput} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional details for families"/></AcademicField><div className="flex flex-col justify-center gap-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={noSchool} onChange={e=>{setNoSchool(e.target.checked);if(!e.target.checked)setBlocksExams(false)}}/>No classes for students</label><label className="flex items-center gap-2"><input type="checkbox" checked={blocksExams} disabled={!noSchool} onChange={e=>setBlocksExams(e.target.checked)}/>Block exam datesheets</label></div></div>
    <Button disabled={disabled||busy||!institutionId||!sessionId||!title.trim()||!startsOn||!endsOn||endsOn<startsOn} onClick={()=>void create()}>Add to calendar</Button>
  </AcademicPanel><AcademicPanel title="Calendar entries" description="Draft entries remain staff-only. Publish an entry to show it in the student and family portal.">
    {!events.length?<p className="text-sm text-muted-foreground">No calendar entries for this session.</p>:<div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Dates</th><th className="p-2">Event</th><th className="p-2">Type</th><th className="p-2">Impact</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead><tbody>{events.map(e=><tr key={e.id} className="border-t"><td className="p-2">{e.starts_on}{e.ends_on!==e.starts_on?` – ${e.ends_on}`:""}</td><td className="p-2 font-medium">{e.title}{e.notes&&<p className="text-xs text-muted-foreground">{e.notes}</p>}</td><td className="p-2 capitalize">{e.event_type.replaceAll("_"," ")}</td><td className="p-2">{e.no_school?"No school":"School open"}{e.blocks_exams?" · blocks exams":""}</td><td className="p-2 capitalize">{e.status}</td><td className="p-2">{e.status==="draft"?<Button size="sm" disabled={disabled||busy} onClick={()=>void setStatus(e,"published")}>Publish</Button>:e.status==="published"?<Button size="sm" variant="outline" disabled={disabled||busy} onClick={()=>void setStatus(e,"cancelled")}>Cancel</Button>:"—"}</td></tr>)}</tbody></table></div>}
  </AcademicPanel></div>;
}
