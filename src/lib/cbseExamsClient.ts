import {supabase} from '@/integrations/supabase/client';
import type {Json} from '@/integrations/supabase/types';
import type {CbseAction,CbseConfiguration,CbseDownloadPayload,CbseReleaseOverview,CbseWorkspace,FamilyReport} from './cbseExams';
// RPCs are added by the matching migration; typed result contracts avoid an untyped DB facade.
type RpcName='cbse_configuration'|'cbse_exam_workspace'|'cbse_action'|'cbse_family_reports'|'cbse_download_payload'|'cbse_set_class_teacher'|'cbse_release_overview';
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
export const performCbseAction=(examId:string|null,action:CbseAction,version:number|null,payload:object={})=>rpc<{id:string;version:number}>('cbse_action',{_exam_id:examId,_action:action,_expected_version:version,_payload:JSON.parse(JSON.stringify(payload)) as Json});
export const setCbseClassTeacher=(examId:string,teacherUserId:string,version:number,remarks:string)=>rpc<{id:string;version:number}>('cbse_set_class_teacher',{_exam_id:examId,_teacher_user_id:teacherUserId,_expected_version:version,_remarks:remarks});
export const fetchCbseReleaseOverview=(courseId:string,sessionId:string)=>rpc<CbseReleaseOverview>('cbse_release_overview',{_course_id:courseId,_session_id:sessionId});
export const fetchFamilyCbseReports=(studentId:string)=>rpc<FamilyReport[]>('cbse_family_reports',{_student_id:studentId});
export const fetchCbseDownloadPayload=(reportId:string)=>rpc<CbseDownloadPayload>('cbse_download_payload',{_report_id:reportId});
