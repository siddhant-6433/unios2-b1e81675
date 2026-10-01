-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations to align db push history.
-- Git must keep this timestamp so `db push` matches remote history.
--
-- Seed the CBSE subject master for NIMT Beacon School Avantika II (BSAV-G1..G12)
-- from the school's 2026-27 Unit Test II and Half Yearly datesheets, so
-- assessment policies, papers, timetables and attendance can reference real
-- subjects. Idempotent: a class that already has any subject is left untouched.
-- `term` follows whatever convention already exists in public.subjects.
insert into public.subjects (course_id, name, code, term, is_elective, is_co_scholastic, display_order, active)
select c.id, s.name, s.code,
       coalesce((select term from public.subjects limit 1), 'annual'),
       s.is_elective, s.is_co_scholastic, s.display_order, true
from public.courses c
join (values
  -- Primary (I-V): English, Hindi, Maths, EVS plus co-scholastic GK/Computer/Art
  (1,'ENG','English',false,false,1),(1,'HIN','Hindi',false,false,2),(1,'MAT','Mathematics',false,false,3),(1,'EVS','Environmental Studies',false,false,4),(1,'GK','General Knowledge',false,true,5),(1,'COMP','Computer',false,true,6),(1,'ART','Art',false,true,7),
  (2,'ENG','English',false,false,1),(2,'HIN','Hindi',false,false,2),(2,'MAT','Mathematics',false,false,3),(2,'EVS','Environmental Studies',false,false,4),(2,'GK','General Knowledge',false,true,5),(2,'COMP','Computer',false,true,6),(2,'ART','Art',false,true,7),
  (3,'ENG','English',false,false,1),(3,'HIN','Hindi',false,false,2),(3,'MAT','Mathematics',false,false,3),(3,'EVS','Environmental Studies',false,false,4),(3,'GK','General Knowledge',false,true,5),(3,'COMP','Computer',false,true,6),(3,'ART','Art',false,true,7),
  (4,'ENG','English',false,false,1),(4,'HIN','Hindi',false,false,2),(4,'MAT','Mathematics',false,false,3),(4,'EVS','Environmental Studies',false,false,4),(4,'GK','General Knowledge',false,true,5),(4,'COMP','Computer',false,true,6),(4,'ART','Art',false,true,7),
  (5,'ENG','English',false,false,1),(5,'HIN','Hindi',false,false,2),(5,'MAT','Mathematics',false,false,3),(5,'EVS','Environmental Studies',false,false,4),(5,'GK','General Knowledge',false,true,5),(5,'COMP','Computer',false,true,6),(5,'ART','Art',false,true,7),
  -- Upper primary (VI-VIII)
  (6,'ENG','English',false,false,1),(6,'HIN','Hindi',false,false,2),(6,'MAT','Mathematics',false,false,3),(6,'SCI','Science',false,false,4),(6,'SST','Social Science',false,false,5),(6,'COMP','Computer',false,true,6),(6,'GK','General Knowledge',false,true,7),(6,'ART','Art',false,true,8),
  (7,'ENG','English',false,false,1),(7,'HIN','Hindi',false,false,2),(7,'MAT','Mathematics',false,false,3),(7,'SCI','Science',false,false,4),(7,'SST','Social Science',false,false,5),(7,'COMP','Computer',false,true,6),(7,'GK','General Knowledge',false,true,7),(7,'ART','Art',false,true,8),
  (8,'ENG','English',false,false,1),(8,'HIN','Hindi',false,false,2),(8,'MAT','Mathematics',false,false,3),(8,'SCI','Science',false,false,4),(8,'SST','Social Science',false,false,5),(8,'COMP','Computer',false,true,6),(8,'GK','General Knowledge',false,true,7),(8,'ART','Art',false,true,8),
  -- Secondary (IX-X)
  (9,'ENG','English',false,false,1),(9,'HIN','Hindi',false,false,2),(9,'MAT','Mathematics',false,false,3),(9,'SCI','Science',false,false,4),(9,'SST','Social Science',false,false,5),
  (10,'ENG','English',false,false,1),(10,'HIN','Hindi',false,false,2),(10,'MAT','Mathematics',false,false,3),(10,'SCI','Science',false,false,4),(10,'SST','Social Science',false,false,5),
  -- Senior secondary (XI-XII): English core plus elective subjects from the datesheets
  (11,'ENG','English',false,false,1),(11,'PHY','Physics',true,false,2),(11,'CHE','Chemistry',true,false,3),(11,'MAT','Mathematics',true,false,4),(11,'BIO','Biology',true,false,5),(11,'ECO','Economics',true,false,6),(11,'ACC','Accountancy',true,false,7),(11,'BST','Business Studies',true,false,8),(11,'HIS','History',true,false,9),(11,'POL','Political Science',true,false,10),(11,'CS','Computer Science',true,false,11),(11,'PE','Physical Education',true,false,12),
  (12,'ENG','English',false,false,1),(12,'PHY','Physics',true,false,2),(12,'CHE','Chemistry',true,false,3),(12,'MAT','Mathematics',true,false,4),(12,'BIO','Biology',true,false,5),(12,'ECO','Economics',true,false,6),(12,'ACC','Accountancy',true,false,7),(12,'BST','Business Studies',true,false,8),(12,'HIS','History',true,false,9),(12,'POL','Political Science',true,false,10),(12,'CS','Computer Science',true,false,11),(12,'PE','Physical Education',true,false,12)
) as s(grade, code, name, is_elective, is_co_scholastic, display_order)
  on s.grade = public.cbse_grade_from_code(c.code)
where c.code ~* '^BSAV-G([1-9]|1[0-2])$'
  and not exists (select 1 from public.subjects existing where existing.course_id = c.id);
