-- Work locations, business unit, and Seralis staff access.
--
-- The register's seven locations are NOT all campuses. NIMT Preet Vihar Center and
-- Seralis Lab Preet Vihar are offices with no students; adding them to `campuses`
-- would put them in admissions pickers, fee structures and student filters. So a
-- location is its own thing that OPTIONALLY points at a campus.

CREATE TABLE IF NOT EXISTS public.hr_locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  -- NULL for an office. Everything already reading campus_id keeps working for the
  -- five locations that are campuses; offices simply have none.
  campus_id       uuid REFERENCES public.campuses(id),
  legal_entity_id uuid REFERENCES public.legal_entities(id),
  is_office       boolean NOT NULL DEFAULT false,
  address         text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS hr_location_id uuid REFERENCES public.hr_locations(id),
  -- Keka's Business Unit. The importer resolved it to an institution id (4 of 92
  -- matched) and discarded the text, losing the other 88.
  ADD COLUMN IF NOT EXISTS business_unit text;

CREATE INDEX IF NOT EXISTS employee_profiles_hr_location_idx
  ON public.employee_profiles (hr_location_id);

-- Seed the seven register locations against the campuses they actually map to.
INSERT INTO public.hr_locations (name, campus_id, legal_entity_id, is_office)
SELECT v.name,
       (SELECT id FROM public.campuses WHERE code = v.campus_code),
       (SELECT id FROM public.legal_entities WHERE name = v.entity),
       v.is_office
  FROM (VALUES
    ('NIMT Greater Noida Campus',     'GN',  'NIMT', false),
    ('NIMT School',                   'GZ3', 'NIMT', false),
    ('NIMT Mohan Nagar Campus',       'GZ1', 'NIMT', false),
    ('Campus School',                 'GZ2', 'NIMT', false),
    ('NIMT Kotputli Campus',          'KT',  'NIMT', false),
    ('NIMT Preet Vihar Center',        NULL, 'NIMT', true),
    ('Seralis Lab Preet Vihar Delhi',  NULL, 'Seralis Lab Diagnostics LLP', true)
  ) AS v(name, campus_code, entity, is_office)
ON CONFLICT (name) DO UPDATE
  SET campus_id = EXCLUDED.campus_id,
      legal_entity_id = EXCLUDED.legal_entity_id,
      is_office = EXCLUDED.is_office;

-- Backfill from the work_location text already stored on every imported row, so
-- nobody has to be reassigned by hand.
UPDATE public.employee_profiles e
   SET hr_location_id = l.id,
       campus_id = COALESCE(e.campus_id, l.campus_id)
  FROM public.hr_locations l
 WHERE e.work_location = l.name
   AND e.hr_location_id IS NULL;

-- Business unit, matched on employee number.
UPDATE public.employee_profiles e
   SET business_unit = v.bu
  FROM (VALUES ('1','NIMT School'),('E1037K','NIMT School'),('E1041K','NIMT School'),('E1043K','NIMT School'),('E1068K','NIMT School'),('E1078K','NIMT Institute of Technology and Management'),('E109','NIMT Preet Vihar'),('E1101K','NIMT Institute of Medical and Paramedical Sciences'),('E1109K','NIMT Institute of Medical and Paramedical Sciences'),('E1111K','NIMT Institute of Medical and Paramedical Sciences'),('E1112K','NIMT Institute of Medical and Paramedical Sciences'),('E1139K','NIMT Greater Noida'),('E1155K','NIMT School'),('E1159K','NIMT School'),('E1169K','NIMT School'),('E1171K','NIMT School'),('E1172K','NIMT School'),('E1186K','NIMT Institute of Medical and Paramedical Sciences'),('E1187K','NIMT Institute of Medical and Paramedical Sciences'),('E1202K','NIMT Greater Noida'),('E1217K','Seralis Lab Preet Vihar'),('E1227K','Seralis Lab Preet Vihar'),('E1228K','NIMT School'),('E1229K','NIMT Greater Noida'),('E1236K','NIMT Greater Noida'),('E1245K','Seralis Lab Preet Vihar'),('E1248K','NIMT Institute of Medical and Paramedical Sciences'),('E1254K','NIMT Institute of Medical and Paramedical Sciences'),('E1258K','NIMT College of Law (NIMT Technical and Professional College)'),('E1259K','NIMT Institute of Medical and Paramedical Sciences'),('E1260K','NIMT College of Law (NIMT Technical and Professional College)'),('E1271K','NIMT Institute of Medical and Paramedical Sciences'),('E1278K','NIMT School'),('E1280K','Seralis Lab Preet Vihar'),('E1281K','NIMT School'),('E1283K','NIMT Institute of Medical and Paramedical Sciences'),('E1285K','NIMT Institute of Medical and Paramedical Sciences'),('E1288K','NIMT School'),('E1292K','NIMT Institute of Medical and Paramedical Sciences'),('E1299K','NIMT Institute of Medical and Paramedical Sciences'),('E1300K','NIMT Institute of Medical and Paramedical Sciences'),('E1302K','NIMT Institute of Medical and Paramedical Sciences'),('E1303K','NIMT Institute of Medical and Paramedical Sciences'),('E1304K','NIMT Institute of Medical and Paramedical Sciences'),('E1305K','NIMT Institute of Medical and Paramedical Sciences'),('E1307K','NIMT Institute of Medical and Paramedical Sciences'),('E1312K','NIMT School'),('E1315K','NIMT Greater Noida'),('E1316K','NIMT School'),('E1320K','NIMT School'),('E1321K','NIMT School'),('E1322K','NIMT School'),('E1325K','Seralis Lab Preet Vihar'),('E1326K','Seralis Lab Preet Vihar'),('E1327K','Seralis Lab Preet Vihar'),('E1328K','Seralis Lab Preet Vihar'),('E1329K','Seralis Lab Preet Vihar'),('E1330K','NIMT Institute of Medical and Paramedical Sciences'),('E1331K','Seralis Lab Preet Vihar'),('E1333K','NIMT Institute of Medical and Paramedical Sciences'),('E1334K','NIMT College of Law (NIMT Technical and Professional College)'),('E1337K','NIMT School'),('E1338K','Campus School'),('E1341K','Seralis Lab Preet Vihar'),('E1343K','NIMT School'),('E1346K','NIMT School'),('E1348K','NIMT Greater Noida'),('E1350K','NIMT School'),('E1352K','NIMT School'),('E1353K','NIMT School'),('E1355K','NIMT Institute of Medical and Paramedical Sciences'),('E1356K','NIMT School'),('E1357K','NIMT School'),('E1359K','NIMT Greater Noida'),('E1360K','NIMT School'),('E1361K','NIMT School'),('E1362K','NIMT School'),('E1363K','NIMT Greater Noida'),('E1364K','Not Available'),('E1365K','NIMT Greater Noida'),('E1366K','NIMT Vidhi Evam Kanun Sansthan'),('E1367K','NIMT Vidhi Evam Kanun Sansthan'),('E152','Campus School'),('E241K','NIMT Greater Noida'),('E29','NIMT Preet Vihar'),('E650K','NIMT School'),('E721K','NIMT School'),('E740K','NIMT Mahila B.Ed College'),('E832K','NIMT School'),('E849K','NIMT Mahila B.Ed College'),('E902K','NIMT Greater Noida'),('E912K','NIMT Greater Noida'),('E925K','NIMT Greater Noida'),('E938K','NIMT School'),('E940K','NIMT School'),('E989K','NIMT Institute of Medical and Paramedical Sciences')) AS v(emp_no, bu)
 WHERE e.employee_number = v.emp_no
   AND NULLIF(trim(v.bu), '') IS NOT NULL
   AND v.bu <> 'Not Available';

ALTER TABLE public.hr_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read hr locations" ON public.hr_locations;
CREATE POLICY "Authenticated read hr locations"
  ON public.hr_locations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "HR manages hr locations" ON public.hr_locations;
CREATE POLICY "HR manages hr locations"
  ON public.hr_locations FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:employees_edit')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_locations TO authenticated;
GRANT ALL ON public.hr_locations TO service_role;
