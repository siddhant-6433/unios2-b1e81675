import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { AcademicError, AcademicField, AcademicPanel, academicInput, readableAcademicError } from "@/components/beacon/AcademicFields";
import { PolicyEditor, type AcademicAction } from "@/components/beacon/PolicyEditor";
import { ExamEditor } from "@/components/beacon/ExamEditor";
import { ExamWorkspace } from "@/components/beacon/ExamWorkspace";
import { BEACON_ACADEMICS_ENABLED } from "@/lib/beaconAcademicsFeature";
import { CBSE_CATEGORY_LABELS, CBSE_EXAM_STATUS_LABELS, type CbseConfiguration, type CbseExam, type CbseWorkspace } from "@/lib/cbseExams";
import { fetchCbseConfiguration, fetchCbseWorkspace, performCbseAction, setCbseClassTeacher } from "@/lib/cbseExamsClient";

export default function BeaconAcademics() {
  const {isImpersonating,user}=useAuth();
  const [configuration,setConfiguration]=useState<CbseConfiguration|null>(null);
  const [workspace,setWorkspace]=useState<CbseWorkspace|null>(null);
  const [examId,setExamId]=useState("");
  const [tab,setTab]=useState<"exams"|"policies"|"create">("exams");
  const [assessmentKey,setAssessmentKey]=useState("");
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const request=useRef(0);
  const mutating=useRef(false);
  const loadConfiguration=useCallback(async()=>{const result=await fetchCbseConfiguration();if(result.error)throw new Error(result.error);setConfiguration(result.data);},[]);
  useEffect(()=>{if(!BEACON_ACADEMICS_ENABLED)return;let active=true;setConfiguration(null);setWorkspace(null);setLoading(true);void fetchCbseConfiguration().then(result=>{if(!active)return;if(result.error)setError(result.error);else setConfiguration(result.data);}).catch(e=>{if(active)setError(readableAcademicError(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[user?.id,refresh]);
  useEffect(()=>{const token=++request.current;setWorkspace(null);if(!BEACON_ACADEMICS_ENABLED||!examId)return;setLoading(true);setError(null);void fetchCbseWorkspace(examId).then(result=>{if(token!==request.current)return;if(result.error)setError(result.error);else setWorkspace(result.data);}).catch(e=>{if(token===request.current)setError(readableAcademicError(e));}).finally(()=>{if(token===request.current)setLoading(false);});return()=>{request.current++;};},[examId,refresh,user?.id]);
  const act:AcademicAction=async(action,payload)=>{
    if(isImpersonating||mutating.current)return false;
    mutating.current=true;setBusy(true);setError(null);
    const global=["create_policy","approve_policy","create_exam"].includes(action);
    try{const result=await performCbseAction(global?null:workspace?.exam.id||null,action,global?null:workspace?.exam.version??null,payload);if(result.error)throw new Error(result.error);await loadConfiguration();if(action==="create_exam"&&result.data){setTab("exams");setExamId(result.data.id);}else if(!global&&workspace){const fresh=await fetchCbseWorkspace(workspace.exam.id);if(fresh.error)throw new Error(fresh.error);setWorkspace(fresh.data);}return true;}catch(e){setError(readableAcademicError(e));return false;}finally{mutating.current=false;setBusy(false);}
  };
  const changeClassTeacher=async(teacherUserId:string,remarks:string):Promise<boolean>=>{
    if(isImpersonating||mutating.current||!workspace)return false;
    mutating.current=true;setBusy(true);setError(null);
    try{const result=await setCbseClassTeacher(workspace.exam.id,teacherUserId,workspace.exam.version,remarks);if(result.error)throw new Error(result.error);const fresh=await fetchCbseWorkspace(workspace.exam.id);if(fresh.error)throw new Error(fresh.error);setWorkspace(fresh.data);await loadConfiguration();return true;}catch(e){setError(readableAcademicError(e));return false;}finally{mutating.current=false;setBusy(false);}
  };
  const examKey=(e:CbseExam)=>`${e.category}:${e.sequence}`;
  const examOptionLabel=(e:CbseExam)=>`${CBSE_CATEGORY_LABELS[e.category]}${e.category==="unit_test"||e.category==="pre_board"?` ${e.sequence}`:""}`;
  const selectedExam=configuration?.exams.find(e=>e.id===examId);
  const activeAssessment=selectedExam?examKey(selectedExam):assessmentKey;
  const assessmentOptions=configuration?Array.from(new Map(configuration.exams.map(e=>[examKey(e),examOptionLabel(e)])).entries()).sort((a,b)=>a[1].localeCompare(b[1])):[];
  const assessmentExams=configuration?configuration.exams.filter(e=>examKey(e)===activeAssessment):[];
  if(!BEACON_ACADEMICS_ENABLED)return <div className="p-6"><AcademicPanel title="Assessments - CBSE"><p className="text-sm text-muted-foreground">Academic reporting is not enabled for this installation. Contact your administrator.</p></AcademicPanel></div>;
  const disabled=busy||isImpersonating;
  return <main className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5"><header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold">Assessments - CBSE</h1><p className="text-sm text-muted-foreground mt-1">School performance reports · Avantika and Arthala · Classes I–XII</p></div><Button variant="outline" disabled={busy||loading} onClick={()=>setRefresh(n=>n+1)}>Refresh</Button></header>
    {isImpersonating&&<div role="status" className="border rounded-lg p-3 text-sm">Academic changes are disabled while impersonating. Return to your own account to edit.</div>}
    <AcademicError message={error}/>{busy&&<p role="status" className="text-sm">Saving changes…</p>}
    {configuration&&<><nav aria-label="Academic reporting" className="flex flex-wrap gap-2"><Button variant={tab==="exams"?"default":"outline"} disabled={busy} onClick={()=>setTab("exams")}>Exams and reports</Button>{configuration.capabilities.manage&&<><Button variant={tab==="create"?"default":"outline"} disabled={busy} onClick={()=>setTab("create")}>Create exam</Button><Button variant={tab==="policies"?"default":"outline"} disabled={busy} onClick={()=>setTab("policies")}>Assessment policies</Button></>}</nav>
    {tab==="policies"&&<PolicyEditor configuration={configuration} disabled={disabled} canApprove={configuration.capabilities.review} onAction={act}/>}
    {tab==="create"&&<ExamEditor configuration={configuration} disabled={disabled} onAction={act}/>}
    {tab==="exams"&&<><div className="grid gap-3 sm:grid-cols-2"><AcademicField label="Assessment"><select aria-label="Assessment" className={academicInput} disabled={busy} value={activeAssessment} onChange={e=>{const k=e.target.value;setAssessmentKey(k);const first=configuration.exams.find(x=>examKey(x)===k);setExamId(first?first.id:"");}}><option value="">Choose an assessment</option>{assessmentOptions.map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></AcademicField><AcademicField label="Class and section"><select aria-label="Class and section" className={academicInput} disabled={busy||!activeAssessment} value={examId} onChange={e=>setExamId(e.target.value)}><option value="">Choose a class</option>{assessmentExams.map(e=><option key={e.id} value={e.id}>{configuration.courses.find(c=>c.id===e.course_id)?.name||e.course_id} · {e.section||"Whole class"} · {CBSE_EXAM_STATUS_LABELS[e.status]}</option>)}</select></AcademicField></div>{!configuration.exams.length&&<AcademicPanel title="No assessments yet"><p className="text-sm text-muted-foreground">An academic administrator can configure an assessment policy and create the first exam.</p></AcademicPanel>}{workspace&&<ExamWorkspace key={`${workspace.exam.id}:${workspace.exam.version}`} workspace={workspace} configuration={configuration} disabled={disabled} onAction={act} onChangeClassTeacher={changeClassTeacher} onOpenExam={id=>setExamId(id)}/>}</>}
    </>}{loading&&<p role="status" className="text-sm text-muted-foreground">Loading academic reports…</p>}
  </main>;
}
