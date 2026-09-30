// @vitest-environment node
//
// In-process SQL tests for the Beacon academic reporting migration. PGlite runs
// the real migration + RPC bodies against a minimal stub of the surrounding
// schema, so the marker/marksheet workflow is exercised end to end: policy
// approval, exam creation, marks entry and locking, class-teacher and principal
// review, release, the fee gate, exceptions, corrections and annual reports.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

vi.setConfig({ testTimeout: 90000, hookTimeout: 180000 });

const MIGRATIONS = [
  "supabase/migrations/20260922180428_beacon_academic_reports.sql",
  "supabase/migrations/20260923141818_seed_beacon_av2_subjects.sql",
  "supabase/migrations/20260923141819_beacon_office_marks_entry.sql",
  "supabase/migrations/20260926121859_beacon_marks_entry_roles_and_open.sql",
  "supabase/migrations/20260929055340_beacon_class_teachers_assign_and_change.sql",
  "supabase/migrations/20260930153158_beacon_report_content_and_bulk_print.sql",
  "supabase/migrations/20260930163537_beacon_aggregate_weights_and_release_overview.sql",
];
const SUBJECTS_SEED = MIGRATIONS[1];

const ID = {
  institution: "00000000-0000-4000-8000-000000000001",
  department: "00000000-0000-4000-8000-000000000002",
  classX: "00000000-0000-4000-8000-000000000010",
  class8: "00000000-0000-4000-8000-000000000008",
  class5: "00000000-0000-4000-8000-000000000005",
  office: "00000000-0000-4000-8000-000000000330",
  session: "00000000-0000-4000-8000-000000000100",
  math: "00000000-0000-4000-8000-000000000201",
  science: "00000000-0000-4000-8000-000000000202",
  english: "00000000-0000-4000-8000-000000000203",
  admin: "00000000-0000-4000-8000-000000000301",
  principal: "00000000-0000-4000-8000-000000000302",
  mathTeacher: "00000000-0000-4000-8000-000000000311",
  scienceTeacher: "00000000-0000-4000-8000-000000000312",
  classTeacher: "00000000-0000-4000-8000-000000000320",
  student1: "00000000-0000-4000-8000-000000000401",
  student2: "00000000-0000-4000-8000-000000000402",
  student3: "00000000-0000-4000-8000-000000000403",
  student1User: "00000000-0000-4000-8000-000000000411",
  parent1: "00000000-0000-4000-8000-000000000421",
  parent2: "00000000-0000-4000-8000-000000000422",
};

const CBSE_SOURCE = "https://cbseacademic.nic.in/curriculum_2027.html";

const gradeBands = [
  { min: 91, grade: "A1" },
  { min: 81, grade: "A2" },
  { min: 71, grade: "B1" },
  { min: 61, grade: "B2" },
  { min: 51, grade: "C1" },
  { min: 41, grade: "C2" },
  { min: 33, grade: "D" },
  { min: 0, grade: "E" },
];

const subject = (subject_id: string) => ({
  subject_id,
  components: [
    { key: "theory", label: "Theory", max: 80, pass_percent: 33 },
    { key: "internal", label: "Internal", max: 20, pass_percent: null },
  ],
  pass_percent: 33,
  contributes_to_total: true,
});

const rules = (weights: { category: string; sequence: number; weight: number }[] = []) => ({
  subjects: [subject(ID.math), subject(ID.science)],
  grade_bands: gradeBands,
  rounding: 2,
  absent_treatment: "zero",
  exempt_treatment: "exclude",
  additional_subject_treatment: "all_applicable",
  annual_weights: weights,
  confirmed: true,
  source_url: CBSE_SOURCE,
});

const class8Rules = {
  subjects: [subject(ID.english)],
  grade_bands: gradeBands,
  rounding: 2,
  absent_treatment: "zero",
  exempt_treatment: "exclude",
  additional_subject_treatment: "all_applicable",
  annual_weights: [],
  confirmed: true,
  source_url: CBSE_SOURCE,
};

type Action = { id: string; version: number };
type SnapshotSubject = { code: string; status: string; obtained: number | null; max: number; percentage: number | null; grade: string | null; passed: boolean | null };
type ReportSnapshot = { revision: number; school: { name: string }; student: { name: string }; subjects: SnapshotSubject[]; summary: { result: string }; source_report_ids: string[] };
type FamilyRow = { id: string; exam_id: string; status: string; revision: number; fee_due: number | null; snapshot?: unknown };
type DownloadPayload = { report_id: string; revision: number; eligibility_token: string; snapshot: ReportSnapshot };
type Configuration = { courses: { code: string; grade: number }[] };
type WorkspaceResult = {
  exam: { id: string; status: string; revision: number; version: number; fee_cutoff: string };
  papers: { id: string; subject_id: string; locked_at: string | null; can_enter: boolean }[];
  students: { id: string; applicable_subject_ids: string[] }[];
  capabilities: { enter: boolean };
};

let db: PGlite;

const asUser = async (userId: string | null) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId ?? ""]);
};

const action = async (examId: string | null, name: string, version: number | null, payload: unknown = {}): Promise<Action> => {
  const result = await db.query<{ r: Action }>(
    "select public.cbse_action($1::uuid,$2::text,$3::integer,$4::jsonb) as r",
    [examId, name, version, JSON.stringify(payload)],
  );
  return result.rows[0].r;
};

const workspace = async (examId: string) => {
  const result = await db.query<{ w: WorkspaceResult }>("select public.cbse_exam_workspace($1::uuid) as w", [examId]);
  return result.rows[0].w;
};

const familyReports = async (studentId: string) => {
  const result = await db.query<{ r: FamilyRow[] }>("select public.cbse_family_reports($1::uuid) as r", [studentId]);
  return result.rows[0].r;
};

const downloadPayload = async (reportId: string) => {
  const result = await db.query<{ r: DownloadPayload }>("select public.cbse_download_payload($1::uuid) as r", [reportId]);
  return result.rows[0].r;
};

const configuration = async () => {
  const result = await db.query<{ c: Configuration }>("select public.cbse_configuration() as c");
  return result.rows[0].c;
};

const rejects = async (run: () => Promise<unknown>, pattern: RegExp) => {
  let message = "";
  try {
    await run();
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toMatch(pattern);
};

async function seed() {
  const migrations = MIGRATIONS.map(file => readFileSync(file, "utf8"));
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth;");
  await db.exec(`
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table profiles(user_id uuid primary key, display_name text, email text, login_disabled boolean not null default false, deleted_at timestamptz, archived_at timestamptz);
create table user_roles(id uuid primary key default gen_random_uuid(), user_id uuid not null, role text not null);
create table user_institution_access(user_id uuid not null, institution_id uuid not null, role text not null, granted_at timestamptz default now(), granted_by uuid, primary key(user_id, institution_id, role));
create table institutions(id uuid primary key, code text, name text, short_code text);
create table departments(id uuid primary key, institution_id uuid not null references institutions(id), code text, name text);
create table courses(id uuid primary key, department_id uuid not null references departments(id), code text, name text);
create table admission_sessions(id uuid primary key, name text, is_active boolean default true, start_date date);
create table subjects(id uuid primary key default gen_random_uuid(), course_id uuid not null references courses(id), name text, code text, term text default 'annual', active boolean default true, is_elective boolean default false, is_co_scholastic boolean default false, display_order integer default 0);
create table subject_allocations(id uuid primary key default gen_random_uuid(), subject_id uuid not null references subjects(id), faculty_user_id uuid not null, active boolean default true, batch_id uuid, session_id uuid, section text, role text default 'teacher');
create table class_teachers(id uuid primary key default gen_random_uuid(), course_id uuid references courses(id), teacher_user_id uuid not null, active boolean default true, batch_id uuid, session_id uuid, section text);
create table students(id uuid primary key, name text not null, admission_no text, class_roll_no text, course_id uuid references courses(id), session_id uuid, section text, father_name text, mother_name text, dob date, login_disabled boolean not null default false, user_id uuid, father_user_id uuid, mother_user_id uuid, guardian_user_id uuid, deleted_at timestamptz, archived_at timestamptz);
create table fee_ledger(id uuid primary key default gen_random_uuid(), student_id uuid not null references students(id), balance numeric, due_date date, total_amount numeric default 0, concession numeric default 0, paid_amount numeric default 0, term text default 'T1', fee_code_id uuid, status text default 'due');
create table employee_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, job_title text, updated_at timestamptz default now());
create table institution_branding(id uuid primary key default gen_random_uuid(), name text, address text, applies_to text[] default '{}', is_default boolean default true, updated_at timestamptz default now());
create table _app_config(key text primary key, value text not null);
create function public.cbse_default_rules(_course uuid) returns jsonb language sql stable as $$
 select jsonb_build_object(
  'subjects', coalesce(jsonb_agg(jsonb_build_object('subject_id',s.id,'pass_percent',case when s.is_co_scholastic then null else 33 end,'contributes_to_total',not s.is_co_scholastic,'components',jsonb_build_array(jsonb_build_object('key','theory','label','Theory','max',80,'pass_percent',33),jsonb_build_object('key','internal','label','Internal assessment','max',20,'pass_percent',null))) order by s.display_order,s.name),'[]'::jsonb),
  'grade_bands','[{"min":91,"grade":"A1"},{"min":81,"grade":"A2"},{"min":71,"grade":"B1"},{"min":61,"grade":"B2"},{"min":51,"grade":"C1"},{"min":41,"grade":"C2"},{"min":33,"grade":"D"},{"min":0,"grade":"E"}]'::jsonb,
  'rounding',2,'absent_treatment','zero','exempt_treatment','exclude','additional_subject_treatment','all_applicable','annual_weights','[]'::jsonb,'confirmed',true,'source_url','https://cbseacademic.nic.in/curriculum_2027.html')
 from subjects s where s.course_id=_course and s.active;
$$;
`);

  const users: [string, string][] = [
    [ID.admin, "Academic Admin"],
    [ID.principal, "Principal Sharma"],
    [ID.mathTeacher, "Maths Teacher"],
    [ID.scienceTeacher, "Science Teacher"],
    [ID.classTeacher, "Class Teacher"],
    [ID.student1User, "Student One"],
    [ID.parent1, "Parent One"],
    [ID.parent2, "Parent Two"],
    [ID.office, "Office Assistant"],
  ];
  for (const [user, name] of users) {
    await db.query("insert into profiles(user_id, display_name, email) values($1,$2,$3)", [user, name, `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`]);
  }

  await db.query("insert into user_roles(user_id, role) values($1,'super_admin')", [ID.admin]);
  await db.query("insert into user_roles(user_id, role) values($1,'principal')", [ID.principal]);
  await db.query("insert into user_roles(user_id, role) values($1,'teacher')", [ID.mathTeacher]);
  await db.query("insert into user_institution_access(user_id, institution_id, role) values($1,$2,'principal')", [ID.principal, ID.institution]);
  await db.query("insert into user_institution_access(user_id, institution_id, role) values($1,$2,'office_assistant')", [ID.office, ID.institution]);

  await db.exec(`
insert into institutions(id, code, name, short_code) values('${ID.institution}','BSAV','NIMT Beacon School','BSAV');
insert into departments(id, institution_id, code, name) values('${ID.department}','${ID.institution}','SCHOOL','School');
insert into courses(id, department_id, code, name) values
 ('${ID.classX}','${ID.department}','BSAV-G10','Class X'),
 ('${ID.class8}','${ID.department}','BSAV-G8','Class VIII'),
 ('${ID.class5}','${ID.department}','BSAV-G5','Class V');
insert into admission_sessions(id, name, is_active, start_date) values('${ID.session}','2026-27',true,date '2026-04-01'),('f0000001-0000-0000-0000-000000000001','2026-27 (production)',true,date '2026-04-01');
insert into subjects(id, course_id, name, code, active, display_order) values
 ('${ID.math}','${ID.classX}','Mathematics','MAT',true,1),
 ('${ID.science}','${ID.classX}','Science','SCI',true,2),
 ('${ID.english}','${ID.class8}','English','ENG',true,1);
insert into subject_allocations(subject_id, faculty_user_id, session_id) values
 ('${ID.math}','${ID.mathTeacher}','${ID.session}'),
 ('${ID.science}','${ID.scienceTeacher}','${ID.session}'),
 ('${ID.english}','${ID.scienceTeacher}','${ID.session}');
insert into class_teachers(course_id, teacher_user_id, session_id) values
 ('${ID.classX}','${ID.classTeacher}','${ID.session}'),
 ('${ID.class8}','${ID.classTeacher}','${ID.session}');
insert into students(id, name, admission_no, class_roll_no, course_id, session_id, father_name, mother_name, dob, user_id, father_user_id) values
 ('${ID.student1}','Aarav Sharma','BSAV-1001','10','${ID.classX}','${ID.session}','Rakesh Sharma','Meena Sharma',date '2011-05-10','${ID.student1User}','${ID.parent1}'),
 ('${ID.student2}','Diya Verma','BSAV-1002','11','${ID.classX}','${ID.session}','Sunil Verma','Kavita Verma',date '2011-08-21',null,'${ID.parent2}'),
 ('${ID.student3}','Ishaan Gupta','BSAV-0801','8A','${ID.class8}','${ID.session}','Anil Gupta','Rita Gupta',date '2013-02-02',null,null);
insert into fee_ledger(student_id, balance, due_date, term) values
 ('${ID.student1}',0,date '2026-08-01','T1'),
 ('${ID.student2}',5000,date '2026-08-01','T1');
insert into institution_branding(name, address, applies_to, is_default, updated_at) values('NIMT Beacon School','Avantika, Ghaziabad',array['BSAV'],true,now());
insert into employee_profiles(user_id, job_title) values('${ID.principal}','Principal'),('${ID.classTeacher}','Class Teacher');
`);

  // Migrations run after the seed data so data-driven migrations (subjects) see it.
  // Enable the flag right after the base migration: later migrations create data
  // through cbse_action, which requires the feature to be enabled.
  for (let i = 0; i < migrations.length; i++) {
    await db.exec(migrations[i]);
    if (i === 0) await db.exec("update _app_config set value='true' where key='beacon_academics_enabled'");
  }
}

async function createPolicy(courseId: string, name: string, policyRules: unknown): Promise<string> {
  await asUser(ID.admin);
  const result = await action(null, "create_policy", null, { course_id: courseId, session_id: ID.session, name, rules: policyRules });
  return result.id;
}

async function approvePolicy(policyId: string) {
  await asUser(ID.principal);
  await action(null, "approve_policy", null, { policy_id: policyId, remarks: "School assessment rules confirmed against the curriculum source." });
}

async function createUnitExam(policyId: string, name: string, options: { category?: string; sequence?: number; courseId?: string; papers?: { subject_id: string; teacher_user_id: string }[]; sources?: string[] } = {}) {
  const papers = options.papers ?? [
    { subject_id: ID.math, teacher_user_id: ID.mathTeacher },
    { subject_id: ID.science, teacher_user_id: ID.scienceTeacher },
  ];
  await asUser(ID.admin);
  const created = await action(null, "create_exam", null, {
    course_id: options.courseId ?? ID.classX,
    session_id: ID.session,
    section: null,
    name,
    academic_year: "2026-27",
    category: options.category ?? "unit_test",
    sequence: options.sequence ?? 1,
    starts_on: "2026-08-01",
    ends_on: "2026-08-05",
    fee_cutoff: "2026-08-01",
    policy_id: policyId,
    class_teacher_user_id: ID.classTeacher,
    papers,
    source_exam_ids: options.sources ?? [],
  });
  return created.id;
}

beforeAll(async () => {
  db = new PGlite();
  await seed();
}, 180000);

describe("Beacon academic RPC migration", () => {
  it("gates every RPC behind the feature flag", async () => {
    await asUser(ID.admin);
    await db.exec("update _app_config set value='false' where key='beacon_academics_enabled'");
    await rejects(() => configuration(), /not enabled/i);
    await rejects(() => action(null, "create_policy", null, { course_id: ID.classX, session_id: ID.session, name: "x", rules: rules() }), /not enabled/i);
    await db.exec("update _app_config set value='true' where key='beacon_academics_enabled'");
    const config = await configuration();
    expect(config.courses.map((course) => course.code)).toEqual(["BSAV-G5", "BSAV-G8", "BSAV-G10"]);
    expect(config.courses.find((course) => course.code === "BSAV-G10").grade).toBe(10);
  });

  it("rejects anonymous callers", async () => {
    await asUser(null);
    await rejects(() => configuration(), /Access denied/i);
  });

  it("runs the full marksheet journey, withholds dues and honours an exception", async () => {
    const policyId = await createPolicy(ID.classX, "Class X assessment 2026-27", rules());
    // A provisional policy cannot be used to create an exam.
    await asUser(ID.admin);
    await rejects(
      () => action(null, "create_exam", null, { course_id: ID.classX, session_id: ID.session, section: null, name: "Draft", academic_year: "2026-27", category: "unit_test", sequence: 9, starts_on: "2026-08-01", ends_on: "2026-08-05", fee_cutoff: "2026-08-01", policy_id: policyId, class_teacher_user_id: ID.classTeacher, papers: [], source_exam_ids: [] }),
      /approved for this class and session/i,
    );
    await approvePolicy(policyId);

    const examId = await createUnitExam(policyId, "Unit Test 1");
    let version = 1;
    await asUser(ID.admin);
    await rejects(() => action(examId, "open", version - 1, {}), /changed in another session/i);
    version = (await action(examId, "open", version, {})).version;

    const ws = await workspace(examId);
    const papers = ws.papers as { id: string; subject_id: string }[];
    const mathPaper = papers.find((paper) => paper.subject_id === ID.math)!;
    const sciencePaper = papers.find((paper) => paper.subject_id === ID.science)!;

    // A teacher cannot enter another subject's paper.
    await asUser(ID.scienceTeacher);
    await rejects(
      () => action(examId, "save_marks", version, { paper_id: mathPaper.id, rows: [{ student_id: ID.student1, status: "present", scores: { theory: 70, internal: 18 } }] }),
      /not assigned to this paper/i,
    );

    // Missing is not zero: a blank component blocks locking, an explicit 0 does not.
    await asUser(ID.mathTeacher);
    version = (await action(examId, "save_marks", version, { paper_id: mathPaper.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 66, internal: 18 } },
      { student_id: ID.student2, status: "present", scores: { theory: 20 } },
    ] })).version;
    await rejects(() => action(examId, "lock_paper", version, { paper_id: mathPaper.id }), /every required component before locking/i);
    version = (await action(examId, "save_marks", version, { paper_id: mathPaper.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 66, internal: 18 } },
      { student_id: ID.student2, status: "present", scores: { theory: 20, internal: 0 } },
    ] })).version;
    version = (await action(examId, "lock_paper", version, { paper_id: mathPaper.id })).version;

    await asUser(ID.scienceTeacher);
    version = (await action(examId, "save_marks", version, { paper_id: sciencePaper.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 72, internal: 20 } },
      { student_id: ID.student2, status: "absent", scores: {} },
    ] })).version;
    version = (await action(examId, "lock_paper", version, { paper_id: sciencePaper.id })).version;

    // Class-teacher review needs attendance and remarks for every student.
    await asUser(ID.classTeacher);
    version = (await action(examId, "student_details", version, { rows: [
      { student_id: ID.student1, attendance_present: 118, attendance_working_days: 124, remarks: "Consistent effort." },
      { student_id: ID.student2, attendance_present: 110, attendance_working_days: 124, remarks: "Needs to improve regularity." },
    ] })).version;
    version = (await action(examId, "submit_class_review", version, {})).version;
    version = (await action(examId, "submit_principal_review", version, { remarks: "Marks and attendance verified." })).version;

    // Only a principal / super admin can approve.
    await asUser(ID.classTeacher);
    await rejects(() => action(examId, "approve", version, { remarks: "Please approve" }), /principal or super admin/i);

    await asUser(ID.principal);
    version = (await action(examId, "approve", version, { remarks: "Approved for release." })).version;
    version = (await action(examId, "release", version, { remarks: "Releasing after fee review." })).version;

    const released = await db.query<{ id: string; student_id: string; snapshot: ReportSnapshot }>(
      "select id, student_id, snapshot from cbse_reports where exam_id=$1 and revision=1 and status='released'",
      [examId],
    );
    const student1 = released.rows.find((row) => row.student_id === ID.student1)!;
    const student2 = released.rows.find((row) => row.student_id === ID.student2)!;

    // Snapshot reflects the CBSE grade bands and the missing-vs-zero rule.
    const maths = student1.snapshot.subjects.find((entry: SnapshotSubject) => entry.code === "MAT");
    expect(maths.obtained).toBe(84);
    expect(maths.max).toBe(100);
    expect(maths.percentage).toBe(84);
    expect(maths.grade).toBe("A2");
    expect(maths.passed).toBe(true);
    const science2 = student2.snapshot.subjects.find((entry: SnapshotSubject) => entry.code === "SCI");
    expect(science2.status).toBe("absent");
    expect(science2.obtained).toBe(0);
    expect(student2.snapshot.summary.result).toBe("fail");
    expect(student1.snapshot.summary.result).toBe("pass");
    expect(student1.snapshot.school.name).toBe("NIMT Beacon School");
    expect(student1.snapshot.class_teacher.name).toBe("Class Teacher");
    expect(student1.snapshot.approval.designation).toBe("Principal");

    // Families see status only; an unrelated staff member is refused.
    await asUser(ID.parent1);
    let reports = await familyReports(ID.student1);
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("available");
    expect(reports[0].revision).toBe(1);
    expect(reports[0]).not.toHaveProperty("snapshot");
    const clearPayload = await downloadPayload(student1.id);
    expect(clearPayload.report_id).toBe(student1.id);
    expect(clearPayload.eligibility_token).toMatch(/^[0-9a-f]{32}$/);
    expect(clearPayload.snapshot.student.name).toBe("Aarav Sharma");

    await asUser(ID.parent2);
    reports = await familyReports(ID.student2);
    expect(reports[0].status).toBe("fee_hold");
    expect(reports[0].fee_due).toBe(5000);
    await rejects(() => downloadPayload(student2.id), /Fee clearance is required/i);

    await asUser(ID.admin);
    await rejects(() => familyReports(ID.student1), /Access denied/i);

    // Principal-approved exception unlocks the withheld report without another release.
    await asUser(ID.classTeacher);
    version = (await action(examId, "request_exception", version, { student_id: ID.student2, remarks: "Sibling concession under review." })).version;
    const pending = await db.query<{ id: string }>("select id from cbse_exceptions where exam_id=$1 and student_id=$2 and status='pending'", [examId, ID.student2]);
    await asUser(ID.admin);
    version = (await action(examId, "review_exception", version, { exception_id: pending.rows[0].id, decision: "approved", remarks: "Approved pending concession." })).version;
    await asUser(ID.parent2);
    reports = await familyReports(ID.student2);
    expect(reports[0].status).toBe("available");
    const exceptionPayload = await downloadPayload(student2.id);
    expect(exceptionPayload.snapshot.revision).toBe(1);
  });

  it("restricts workspaces and marks entry to assigned staff", async () => {
    const policyId = await createPolicy(ID.classX, "Class X access policy", rules());
    await approvePolicy(policyId);
    const examId = await createUnitExam(policyId, "Unit Test 2");

    await asUser(ID.mathTeacher);
    const ws = await workspace(examId);
    expect(ws.exam.id).toBe(examId);
    expect(ws.capabilities.enter).toBe(false); // marks entry is not open yet

    await asUser(ID.parent1);
    await rejects(() => workspace(examId), /Access denied/i);
  });

  it("blocks Pre-Boards outside Classes X and XII by grade", async () => {
    const class8Policy = await createPolicy(ID.class8, "Class VIII assessment", class8Rules);
    await approvePolicy(class8Policy);
    await asUser(ID.admin);
    await rejects(
      () => action(null, "create_exam", null, { course_id: ID.class8, session_id: ID.session, section: null, name: "Pre-Board", academic_year: "2026-27", category: "pre_board", sequence: 1, starts_on: "2026-08-01", ends_on: "2026-08-05", fee_cutoff: "2026-08-01", policy_id: class8Policy, class_teacher_user_id: ID.classTeacher, papers: [{ subject_id: ID.english, teacher_user_id: ID.scienceTeacher }], source_exam_ids: [] }),
      /Pre-Boards apply only to Classes X and XII/i,
    );
  });

  it("configures the draft roster, returns a locked paper and cancels", async () => {
    const policyId = await createPolicy(ID.classX, "Class X draft workflow", rules());
    await approvePolicy(policyId);
    const examId = await createUnitExam(policyId, "Unit Test 4");
    let version = 1;
    await asUser(ID.admin);
    version = (await action(examId, "configure_roster", version, { students: [
      { student_id: ID.student1, applicable_subject_ids: [ID.math] },
      { student_id: ID.student2, applicable_subject_ids: [ID.math, ID.science] },
    ] })).version;
    version = (await action(examId, "configure_exam", version, { fee_cutoff: "2026-08-02" })).version;
    let ws = await workspace(examId);
    expect(ws.exam.status).toBe("draft");
    expect(ws.students.find((student) => student.id === ID.student1)!.applicable_subject_ids).toEqual([ID.math]);

    version = (await action(examId, "open", version, {})).version;
    ws = await workspace(examId);
    expect(ws.exam.fee_cutoff).toBe("2026-08-02");
    // The explicit draft selection survives opening; other students get every paper.
    expect(ws.students.find((student) => student.id === ID.student1)!.applicable_subject_ids).toEqual([ID.math]);
    const mathPaper = ws.papers.find((paper) => paper.subject_id === ID.math)!;

    await asUser(ID.mathTeacher);
    version = (await action(examId, "save_marks", version, { paper_id: mathPaper.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 50, internal: 10 } },
      { student_id: ID.student2, status: "present", scores: { theory: 40, internal: 8 } },
    ] })).version;
    version = (await action(examId, "lock_paper", version, { paper_id: mathPaper.id })).version;
    await asUser(ID.classTeacher);
    version = (await action(examId, "return_paper", version, { paper_id: mathPaper.id, remarks: "Recheck question four." })).version;
    ws = await workspace(examId);
    expect(ws.exam.status).toBe("open");
    expect(ws.papers.find((paper) => paper.id === mathPaper.id)!.locked_at).toBeNull();

    const cancelled = await createUnitExam(policyId, "Unit Test 5");
    await asUser(ID.admin);
    await action(cancelled, "cancel", 1, { remarks: "Scheduling error." });
    const cancelledRow = await db.query<{ status: string }>("select status from cbse_exams where id=$1", [cancelled]);
    expect(cancelledRow.rows[0].status).toBe("cancelled");
    const config = await configuration();
    expect(config.courses.length).toBeGreaterThan(0);
    expect(version).toBeGreaterThan(0);
  });

  it("withdraws corrected reports and dependent annual reports", async () => {
    const unitPolicyId = await createPolicy(ID.classX, "Class X with annual weights", rules([{ category: "unit_test", sequence: 1, weight: 100 }]));
    await approvePolicy(unitPolicyId);

    const unitExam = await createUnitExam(unitPolicyId, "Unit Test 3");
    let version = 1;
    await asUser(ID.admin);
    version = (await action(unitExam, "open", version, {})).version;
    const papers = (await workspace(unitExam)).papers as { id: string; subject_id: string }[];
    await asUser(ID.mathTeacher);
    version = (await action(unitExam, "save_marks", version, { paper_id: papers.find((paper) => paper.subject_id === ID.math)!.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 64, internal: 16 } },
      { student_id: ID.student2, status: "present", scores: { theory: 48, internal: 12 } },
    ] })).version;
    version = (await action(unitExam, "lock_paper", version, { paper_id: papers.find((paper) => paper.subject_id === ID.math)!.id })).version;
    await asUser(ID.scienceTeacher);
    version = (await action(unitExam, "save_marks", version, { paper_id: papers.find((paper) => paper.subject_id === ID.science)!.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 60, internal: 15 } },
      { student_id: ID.student2, status: "present", scores: { theory: 40, internal: 10 } },
    ] })).version;
    version = (await action(unitExam, "lock_paper", version, { paper_id: papers.find((paper) => paper.subject_id === ID.science)!.id })).version;
    await asUser(ID.classTeacher);
    version = (await action(unitExam, "student_details", version, { rows: [
      { student_id: ID.student1, attendance_present: 120, attendance_working_days: 124, remarks: "Good." },
      { student_id: ID.student2, attendance_present: 115, attendance_working_days: 124, remarks: "Improving." },
    ] })).version;
    version = (await action(unitExam, "submit_class_review", version, {})).version;
    version = (await action(unitExam, "submit_principal_review", version, { remarks: "Verified." })).version;
    await asUser(ID.admin);
    version = (await action(unitExam, "approve", version, { remarks: "Approved." })).version;
    version = (await action(unitExam, "release", version, { remarks: "Released." })).version;

    // Create the annual report that aggregates the unit test.
    const annualExam = await createUnitExam(unitPolicyId, "Annual Report", { category: "annual", sources: [unitExam] });
    let annualVersion = 1;
    await asUser(ID.admin);
    annualVersion = (await action(annualExam, "open", annualVersion, {})).version;
    const annualPapers = (await workspace(annualExam)).papers as { subject_id: string }[];
    expect(annualPapers.map((paper) => paper.subject_id).sort()).toEqual([ID.math, ID.science].sort());
    await asUser(ID.classTeacher);
    annualVersion = (await action(annualExam, "student_details", annualVersion, { rows: [
      { student_id: ID.student1, attendance_present: 120, attendance_working_days: 124, remarks: "Annual review." },
      { student_id: ID.student2, attendance_present: 115, attendance_working_days: 124, remarks: "Annual review." },
    ] })).version;
    annualVersion = (await action(annualExam, "submit_class_review", annualVersion, {})).version;
    annualVersion = (await action(annualExam, "submit_principal_review", annualVersion, { remarks: "Annual verified." })).version;
    await asUser(ID.admin);
    annualVersion = (await action(annualExam, "approve", annualVersion, { remarks: "Annual approved." })).version;
    annualVersion = (await action(annualExam, "release", annualVersion, { remarks: "Annual released." })).version;

    await asUser(ID.parent1);
    const annualReports = await familyReports(ID.student1);
    const annual = annualReports.find((report) => report.exam_id === annualExam)!;
    const annualSnapshot = await downloadPayload(annual.id);
    expect(annualSnapshot.snapshot.source_report_ids).toHaveLength(1);
    expect(annualSnapshot.snapshot.subjects.find((entry: SnapshotSubject) => entry.code === "MAT").obtained).toBe(80);

    // Correcting the source withdraws the dependent annual report.
    await asUser(ID.admin);
    version = (await action(unitExam, "reopen", version, { remarks: "Recheck internal marks." })).version;
    const annualReportsAfter = await db.query<{ id: string; status: string; revision: number }>("select id,status,revision from cbse_reports where exam_id=$1 order by revision", [annualExam]);
    expect(annualReportsAfter.rows.every((row) => row.status === "withdrawn")).toBe(true);
    const annualExamRow = await db.query<{ status: string; revision: number }>("select status,revision from cbse_exams where id=$1", [annualExam]);
    expect(annualExamRow.rows[0].status).toBe("principal_review");
    expect(annualExamRow.rows[0].revision).toBe(2);

    await asUser(ID.parent1);
    const familyAfter = await familyReports(ID.student1);
    expect(familyAfter.find((report) => report.exam_id === annualExam)!.status).toBe("awaiting_release");
  });

  it("keeps disabled students out of the family surface", async () => {
    await db.exec(`update students set login_disabled=true where id='${ID.student1}'`);
    await asUser(ID.student1User);
    await rejects(() => familyReports(ID.student1), /Access denied/i);
    // The guardians keep their separately permitted access.
    await asUser(ID.parent1);
    await expect(familyReports(ID.student1)).resolves.toBeInstanceOf(Array);
    await db.exec(`update students set login_disabled=false where id='${ID.student1}'`);
  });

  it("lets a teacher and the principal enter marks for any paper", async () => {
    const policyId = await createPolicy(ID.classX, "Class X staff entry", rules());
    await approvePolicy(policyId);
    const examId = await createUnitExam(policyId, "Unit Test 7");
    await asUser(ID.admin);
    let version = (await action(examId, "open", 1, {})).version;
    const sciencePaper = (await workspace(examId)).papers.find((paper) => paper.subject_id === ID.science)!;
    // mathsTeacher holds the teacher role but is not this paper's assigned teacher.
    await asUser(ID.mathTeacher);
    version = (await action(examId, "save_marks", version, { paper_id: sciencePaper.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 60, internal: 12 } },
      { student_id: ID.student2, status: "present", scores: { theory: 50, internal: 10 } },
    ] })).version;
    await asUser(ID.principal);
    version = (await action(examId, "save_marks", version, { paper_id: sciencePaper.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 62, internal: 13 } },
      { student_id: ID.student2, status: "present", scores: { theory: 52, internal: 11 } },
    ] })).version;
    expect(version).toBeGreaterThan(1);
  });

  it("lets the principal change the class teacher but not a teacher", async () => {
    const policyId = await createPolicy(ID.classX, "Class X class teacher change", rules());
    await approvePolicy(policyId);
    const examId = await createUnitExam(policyId, "Unit Test 8");
    const setClassTeacher = (version: number, teacher: string) =>
      db.query<{ r: { id: string; version: number } }>(
        "select public.cbse_set_class_teacher($1::uuid,$2::uuid,$3::integer,$4::text) as r",
        [examId, teacher, version, "Handover for review"],
      );
    await asUser(ID.mathTeacher);
    await rejects(() => setClassTeacher(1, ID.classTeacher), /principal or super admin/i);
    await asUser(ID.principal);
    const res = await setClassTeacher(1, ID.classTeacher);
    expect(res.rows[0].r.version).toBe(2);
    const row = await db.query<{ class_teacher_user_id: string }>("select class_teacher_user_id from cbse_exams where id=$1", [examId]);
    expect(row.rows[0].class_teacher_user_id).toBe(ID.classTeacher);
    await rejects(() => setClassTeacher(1, ID.classTeacher), /changed in another session/i);
  });

  it("publishes combined weights and a release overview", async () => {
    await asUser(ID.admin);
    const weighted = await db.query<{ n: string }>(
      "select count(*)::text as n from cbse_policies where course_id=$1 and status='approved' and jsonb_array_length(coalesce(rules->'annual_weights','[]'::jsonb))>0",
      [ID.classX],
    );
    expect(Number(weighted.rows[0].n)).toBeGreaterThan(0);
    const overview = await db.query<{ r: { exams: { category: string; status: string }[] } }>(
      "select public.cbse_release_overview($1::uuid,$2::uuid) as r",
      [ID.classX, ID.session],
    );
    expect(overview.rows[0].r.exams.length).toBeGreaterThan(0);
    expect(overview.rows[0].r.exams.every((exam) => typeof exam.status === "string")).toBe(true);
  });

  it("seeds the Beacon subject master idempotently", async () => {
    const before = await db.query<{ count: string }>("select count(*)::text as count from subjects where course_id=$1", [ID.class5]);
    expect(Number(before.rows[0].count)).toBe(7);
    const evs = await db.query("select code from subjects where course_id=$1 and code='EVS'", [ID.class5]);
    expect(evs.rows).toHaveLength(1);
    await db.exec(readFileSync(SUBJECTS_SEED, "utf8"));
    const after = await db.query<{ count: string }>("select count(*)::text as count from subjects where course_id=$1", [ID.class5]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("lets the office assistant enter and lock marks without being the paper teacher", async () => {
    const policyId = await createPolicy(ID.classX, "Class X office entry", rules());
    await approvePolicy(policyId);
    const examId = await createUnitExam(policyId, "Unit Test 6");
    await asUser(ID.admin);
    let version = (await action(examId, "open", 1, {})).version;
    const mathPaper = (await workspace(examId)).papers.find((paper) => paper.subject_id === ID.math)!;

    await asUser(ID.office);
    const officeWs = await workspace(examId);
    expect(officeWs.capabilities.enter).toBe(true);
    expect(officeWs.papers.find((paper) => paper.id === mathPaper.id)!.can_enter).toBe(true);
    version = (await action(examId, "save_marks", version, { paper_id: mathPaper.id, rows: [
      { student_id: ID.student1, status: "present", scores: { theory: 55, internal: 12 } },
      { student_id: ID.student2, status: "present", scores: { theory: 45, internal: 9 } },
    ] })).version;
    version = (await action(examId, "lock_paper", version, { paper_id: mathPaper.id })).version;
    const locked = await db.query<{ locked_at: string | null }>("select locked_at from cbse_papers where id=$1", [mathPaper.id]);
    expect(locked.rows[0].locked_at).not.toBeNull();
    expect(version).toBeGreaterThan(1);
  });
});
