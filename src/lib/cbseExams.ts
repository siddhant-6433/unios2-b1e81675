/** Beacon school assessment contracts. School policies require explicit approval. */
export type CbseCategory = 'unit_test' | 'half_yearly' | 'final' | 'pre_board' | 'annual';
export type CbseExamStatus = 'draft' | 'open' | 'class_review' | 'principal_review' | 'approved' | 'released' | 'cancelled';
export type MarkStatus = 'present' | 'absent' | 'exempt';
export type ComponentRule = { key: string; label: string; max: number; pass_percent: number | null };
export type SubjectRule = { subject_id: string; components: ComponentRule[]; pass_percent: number | null; contributes_to_total?: boolean };
export type PolicyRules = {
  subjects: SubjectRule[]; grade_bands: {min:number;grade:string}[]; rounding: 0|1|2;
  absent_treatment: 'zero'|'exclude'; exempt_treatment: 'exclude';
  additional_subject_treatment: 'all_applicable'; annual_weights: {category:Exclude<CbseCategory,'annual'>;sequence:number;weight:number}[];
  confirmed:boolean; source_url:string;
};
export type CbsePolicy = {id:string;course_id:string;session_id:string;name:string;version:number;status:'draft'|'approved';rules:PolicyRules;approved_by:string|null;approved_at:string|null};
export type CbseExam = {id:string;institution_id:string;course_id:string;session_id:string;section:string|null;name:string;academic_year:string;category:CbseCategory;sequence:number;starts_on:string;ends_on:string;fee_cutoff:string;policy_id:string;class_teacher_user_id:string;status:CbseExamStatus;version:number;revision:number;created_at:string};
export type CbseMark = {status:MarkStatus;scores:Record<string,number|null>;remarks:string|null};
export type CbsePaper = {id:string;exam_id:string;subject_id:string;name:string;code:string;teacher_user_id:string;components:ComponentRule[];locked_at:string|null;can_enter:boolean};
export type FeeEligibility = {status:'clear'|'due'|'unresolved';due:number|null};
export type CbseStudent = {id:string;name:string;admission_no:string|null;section:string|null;applicable_subject_ids:string[];attendance_present:number|null;attendance_working_days:number|null;remarks:string|null;marks:Record<string,CbseMark>;fee:FeeEligibility;report_id:string|null};
export type ReportSubject = {subject_id:string;name:string;code:string;status:MarkStatus;components:{key:string;label:string;max:number;score:number|null}[];obtained:number|null;max:number;percentage:number|null;grade:string|null;passed:boolean|null;contributes_to_total?:boolean};
export type ReportSnapshot = {
  template_version:'beacon-v1';report_id:string;exam_id:string;revision:number;title:string;category:CbseCategory;academic_year:string;
  school:{name:string;code:string;address:string|null;logo_url:string|null;asset_version?:string};
  class_teacher?:{name:string|null;designation:string|null};
  sources?:{exam_id:string;name:string;category:CbseCategory;sequence:number;weight:number}[];
  student:{id:string;name:string;admission_no:string|null;roll_no:string|null;section:string|null;father_name:string|null;mother_name:string|null;dob:string|null;course_name:string};
  subjects:ReportSubject[];summary:{obtained:number;max:number;percentage:number|null;grade:string|null;result:'pass'|'fail'|'absent'|'incomplete'};
  attendance:{present:number;working_days:number};remarks:string;approval:{name:string;designation?:string|null;approved_at:string;remarks:string};
  policy:{id:string;version:number;source_url:string};source_report_ids:string[];fee_cutoff:string;
};
export type CbseReport = {id:string;exam_id:string;student_id:string;revision:number;status:'approved'|'released'|'withdrawn';snapshot:ReportSnapshot;approved_at:string;released_at:string|null;withdrawn_at:string|null};
export type CbseException = {id:string;exam_id:string;student_id:string;revision:number;fee_cutoff:string;status:'pending'|'approved'|'rejected'|'revoked';request_remarks:string;review_remarks:string|null;requested_by:string;reviewed_by:string|null;created_at:string};
export type CbseCapabilities = {manage:boolean;review:boolean;class_teacher:boolean;enter:boolean};
export type CbseWorkspace = {exam:CbseExam;policy:CbsePolicy;papers:CbsePaper[];students:CbseStudent[];reports:CbseReport[];exceptions:CbseException[];audit:{id:number;action:string;actor_id:string;created_at:string;remarks:string|null;details:Record<string,unknown>}[];sources:{source_exam_id:string;name:string;category:CbseCategory;sequence:number;weight:number}[];capabilities:CbseCapabilities};
export type CbseConfiguration = {courses:{id:string;name:string;code:string;institution_id:string;institution_name:string;grade:number}[];sessions:{id:string;name:string}[];subjects:{id:string;course_id:string;name:string;code:string;is_elective:boolean;is_co_scholastic:boolean}[];staff:{user_id:string;name:string}[];policies:CbsePolicy[];exams:CbseExam[];capabilities:{manage:boolean;review:boolean}};
export type FamilyReport = {id:string;exam_id:string;student_id:string;title:string;academic_year:string;category:CbseCategory;revision:number;status:'awaiting_release'|'fee_hold'|'available'|'withdrawn'|'unavailable';fee_due:number|null;fee_cutoff:string;released_at:string|null};
export type CbseReleaseRow = {id:string;name:string;category:CbseCategory;sequence:number;status:CbseExamStatus;revision:number;version:number;students:number;reports_approved:number;reports_released:number;fee_ready:number;exceptions_pending:number};
export type CbseReleaseOverview = {course_id:string;session_id:string;exams:CbseReleaseRow[]};
export type CbseDownloadPayload = {report_id:string;revision:number;eligibility_token:string;snapshot:ReportSnapshot};
export type CbseAction = 'create_policy'|'approve_policy'|'create_exam'|'configure_roster'|'configure_exam'|'open'|'save_marks'|'lock_paper'|'student_details'|'submit_class_review'|'submit_principal_review'|'return_paper'|'approve'|'release'|'reopen'|'request_exception'|'review_exception'|'cancel';
export const CBSE_CATEGORY_LABELS:Record<CbseCategory,string> = {unit_test:'Unit Test',half_yearly:'Half Yearly',final:'Final Examination',pre_board:'Pre-Board',annual:'Combined / Aggregate Report'};
export const CBSE_EXAM_STATUS_LABELS:Record<CbseExamStatus,string> = {draft:'Draft',open:'Marks entry',class_review:'Class-teacher review',principal_review:'Academic review',approved:'Approved',released:'Released',cancelled:'Cancelled'};
export const BEACON_PRE_PRIMARY_CODES=['NUR','LKG','UKG','TOD'];
export function isBeaconCourseCode(code:string|null|undefined):boolean {return /^(BSA|BSAV)-(G(?:[1-9]|1[0-2])|NUR|LKG|UKG|TOD)$/i.test(code||'');}
/** Pre-primary classes report as grade 0; classes I-XII parse their number. */
export function beaconGradeFromCourseCode(code:string|null|undefined):number|null {if(!isBeaconCourseCode(code))return null;const grade=code!.match(/G(\d+)$/i);return grade?Number(grade[1]):0;}
export function examTypeAllowedForGrade(category:CbseCategory,grade:number|null):boolean {return grade!==null && grade>=0 && grade<=12 && (category!=='pre_board'||grade===10||grade===12);}
export function remarksAreComplete(value:string|null|undefined):boolean {return Boolean(value?.trim());}
export function isFeeClear(due:number|null|undefined):boolean {return typeof due==='number'&&Number.isFinite(due)&&due<=0;}
export function roundMarks(value:number,places=2):number {return Math.round((value+Number.EPSILON)*10**places)/10**places;}
export function gradeForPercent(value:number|null,bands:PolicyRules['grade_bands']):string|null {if(value===null||!Number.isFinite(value))return null;return [...bands].sort((a,b)=>b.min-a.min).find(b=>value>=b.min)?.grade??null;}
/** Pure calculation oracle, mirrors authoritative database calculation. Missing is never zero. */
export function evaluatePolicyPaper(rule:SubjectRule,mark:CbseMark|undefined,policy:PolicyRules):{obtained:number|null;max:number;percentage:number|null;grade:string|null;passed:boolean|null;complete:boolean} {
  const max=rule.components.reduce((sum,c)=>sum+c.max,0);
  const empty={obtained:null,max,percentage:null,grade:null,passed:null,complete:false};
  if(!mark)return empty;
  if(mark.status==='exempt'||mark.status==='absent'&&policy.absent_treatment==='exclude')return {...empty,max:0,complete:true};
  if(mark.status==='absent')return {obtained:0,max,percentage:0,grade:gradeForPercent(0,policy.grade_bands),passed:false,complete:true};
  let obtained=0,passed=true;
  for(const component of rule.components){const score=mark.scores[component.key];if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>component.max)return empty;obtained+=score;if(component.pass_percent!==null&&score*100<component.max*component.pass_percent)passed=false;}
  const percentage=roundMarks(obtained*100/max,policy.rounding);
  if(rule.pass_percent!==null&&obtained*100<max*rule.pass_percent)passed=false;
  return {obtained:roundMarks(obtained,policy.rounding),max,percentage,grade:gradeForPercent(percentage,policy.grade_bands),passed,complete:true};
}
