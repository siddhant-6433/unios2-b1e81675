import {supabase} from '@/integrations/supabase/client';
import type {Json} from '@/integrations/supabase/types';
import type {CbseAction,CbseConfiguration,CbseDownloadPayload,CbseReleaseOverview,CbseWorkspace,FamilyReport} from './cbseExams';
// RPCs are added by the matching migration; typed result contracts avoid an untyped DB facade.
type RpcName='cbse_configuration'|'cbse_exam_workspace'|'cbse_action'|'cbse_save_co_scholastic_grades'|'cbse_family_reports'|'cbse_download_payload'|'cbse_set_class_teacher'|'cbse_release_overview'|'cbse_datesheet_save'|'cbse_datesheet_update'|'cbse_datesheet_finalize'|'cbse_datesheet_get'|'cbse_datesheet_list'|'cbse_family_datesheets'|'cbse_datesheet_recipients'|'cbse_request_paper_unlock'|'cbse_unlock_requests_pending'|'cbse_review_paper_unlock';
type RpcArgs=Record<string,Json|undefined>;
type RpcResult={data:Json|null;error:{message:string}|null};
// Keep the call parenthesised as a member expression (never extracted into a
// variable) so the supabase client binding survives; the cast only widens the
// generated RPC-name union to include the CBSE functions.
type RpcSignature=(name:RpcName,args:RpcArgs)=>PromiseLike<RpcResult>;
const rpcCall=(name:RpcName,args:RpcArgs):PromiseLike<RpcResult>=>(supabase.rpc as unknown as RpcSignature)(name,args);
async function rpc<T>(name:RpcName,args:RpcArgs={}):Promise<{data:T|null;error:string|null}>{
  const {data,error}=await rpcCall(name,args);return {data:data as T|null,error:error?.message??null};
}
export const fetchCbseConfiguration=()=>rpc<CbseConfiguration>('cbse_configuration');
export const fetchCbseWorkspace=(examId:string)=>rpc<CbseWorkspace>('cbse_exam_workspace',{_exam_id:examId});
export const performCbseAction=(examId:string|null,action:CbseAction,version:number|null,payload:object={})=>action==='co_scholastic_grades'
  ?rpc<{id:string;version:number}>('cbse_save_co_scholastic_grades',{_exam_id:examId,_expected_version:version,_rows:JSON.parse(JSON.stringify((payload as {rows?:unknown[]}).rows??[])) as Json})
  :rpc<{id:string;version:number}>('cbse_action',{_exam_id:examId,_action:action,_expected_version:version,_payload:JSON.parse(JSON.stringify(payload)) as Json});
export const setCbseClassTeacher=(examId:string,teacherUserId:string,version:number,remarks:string)=>rpc<{id:string;version:number}>('cbse_set_class_teacher',{_exam_id:examId,_teacher_user_id:teacherUserId,_expected_version:version,_remarks:remarks});
export const fetchCbseReleaseOverview=(courseId:string,sessionId:string)=>rpc<CbseReleaseOverview>('cbse_release_overview',{_course_id:courseId,_session_id:sessionId});
export const fetchFamilyCbseReports=(studentId:string)=>rpc<FamilyReport[]>('cbse_family_reports',{_student_id:studentId});
export const fetchCbseDownloadPayload=(reportId:string)=>rpc<CbseDownloadPayload>('cbse_download_payload',{_report_id:reportId});
export type CbseDateSheet={id:string;institution_id:string;session_id:string;title:string;category:'unit_test'|'half_yearly'|'final';sequence:number;reporting_ends_on:string;status:'draft'|'finalized'|'released';created_at:string;released_at:string|null;classes:{course_id:string;course_name:string;course_code:string;section:string|null;exam_id:string|null;papers:{subject_id:string;subject_name:string;exam_on:string;starts_at:string|null;ends_at:string|null;venue:string|null}[]}[]};
export const saveCbseDateSheet=(payload:object)=>rpc<{id:string}>('cbse_datesheet_save',{_payload:JSON.parse(JSON.stringify(payload)) as Json});
export const updateCbseDateSheet=(id:string,payload:object)=>rpc<CbseDateSheet>('cbse_datesheet_update',{_datesheet_id:id,_payload:JSON.parse(JSON.stringify(payload)) as Json});
export const fetchCbseDateSheet=(id:string)=>rpc<CbseDateSheet>('cbse_datesheet_get',{_datesheet_id:id});
export const listCbseDateSheets=(sessionId:string|null)=>rpc<CbseDateSheet[]>('cbse_datesheet_list',{_session_id:sessionId});
export const finalizeCbseDateSheet=(id:string,release=false)=>rpc<CbseDateSheet>('cbse_datesheet_finalize',{_datesheet_id:id,_release:release});
export const fetchFamilyCbseDateSheets=(studentId:string)=>rpc<CbseDateSheet[]>('cbse_family_datesheets',{_student_id:studentId});
export const fetchCbseDateSheetRecipients=(id:string)=>rpc<{phone:string}[]>('cbse_datesheet_recipients',{_datesheet_id:id});
export type CbseUnlockRequest={id:string;exam_id:string;exam_name:string;paper_name:string;class_name:string;section:string|null;teacher:string;reason:string;requested_at:string};
export const requestCbsePaperUnlock=(paperId:string,reason:string)=>rpc<string>('cbse_request_paper_unlock',{_paper_id:paperId,_reason:reason});
export const fetchCbseUnlockRequests=()=>rpc<CbseUnlockRequest[]>('cbse_unlock_requests_pending');
export const reviewCbsePaperUnlock=(requestId:string,decision:'approved'|'rejected',remarks:string)=>rpc<null>('cbse_review_paper_unlock',{_request_id:requestId,_decision:decision,_remarks:remarks});
