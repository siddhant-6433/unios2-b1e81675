-- Change min_age and max_age to numeric to support fractional ages (e.g. 1.6 for Toddlers)
ALTER TABLE public.eligibility_rules
  ALTER COLUMN min_age TYPE numeric(5,2),
  ALTER COLUMN max_age TYPE numeric(5,2);

-- Add Mirai Experiential School Branch
DO $$
DECLARE
    v_campus_id UUID;
    v_mirai_id UUID;
    v_preprimary_id UUID;
    v_primary_id UUID;
    v_course_id UUID;
BEGIN
    -- 1. Campus (name must contain "mirai" for portal campusKeywords filter)
    SELECT id INTO v_campus_id FROM campuses WHERE name ILIKE '%Mirai%' LIMIT 1;
    IF v_campus_id IS NULL THEN
        INSERT INTO campuses (name, code, city) VALUES ('Mirai Campus', 'MIRAI', 'Faridabad') RETURNING id INTO v_campus_id;
    END IF;

    -- 2. Institution
    SELECT id INTO v_mirai_id FROM institutions WHERE name ILIKE '%Mirai%' LIMIT 1;
    IF v_mirai_id IS NULL THEN
        INSERT INTO institutions (name, code, type, campus_id)
        VALUES ('Mirai Experiential School', 'MES', 'school', v_campus_id)
        RETURNING id INTO v_mirai_id;
    END IF;

    -- 3. Pre-Primary department (EYP)
    SELECT id INTO v_preprimary_id FROM departments WHERE name = 'Pre-Primary' AND institution_id = v_mirai_id LIMIT 1;
    IF v_preprimary_id IS NULL THEN
        INSERT INTO departments (name, code, institution_id) VALUES ('Pre-Primary', 'EYP', v_mirai_id) RETURNING id INTO v_preprimary_id;
    END IF;

    -- 4. Primary department (PYP)
    SELECT id INTO v_primary_id FROM departments WHERE name = 'Primary' AND institution_id = v_mirai_id LIMIT 1;
    IF v_primary_id IS NULL THEN
        INSERT INTO departments (name, code, institution_id) VALUES ('Primary', 'PYP', v_mirai_id) RETURNING id INTO v_primary_id;
    END IF;

    -- 5. Grades

    -- Toddlers (1.6y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'Toddlers' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('Toddlers', 'MES-TOD', 1, v_preprimary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 1.6, 2.6, 'Minimum age: 1.6 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 1.6, max_age = 2.6, notes = 'Minimum age: 1.6 years as of June 1';

    -- Montessori (2y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'Montessori' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('Montessori', 'MES-MON', 1, v_preprimary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 2.0, 3.5, 'Minimum age: 2 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 2.0, max_age = 3.5, notes = 'Minimum age: 2 years as of June 1';

    -- EYP 1 / Junior / Nursery (3y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'EYP 1 (Junior/Nursery)' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('EYP 1 (Junior/Nursery)', 'MES-EYP1', 1, v_preprimary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 3.0, 4.5, 'Minimum age: 3 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 3.0, max_age = 4.5, notes = 'Minimum age: 3 years as of June 1';

    -- EYP 2 / Senior / LKG (4y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'EYP 2 (Senior/LKG)' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('EYP 2 (Senior/LKG)', 'MES-EYP2', 1, v_preprimary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 4.0, 5.5, 'Minimum age: 4 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 4.0, max_age = 5.5, notes = 'Minimum age: 4 years as of June 1';

    -- EYP 3 / Graduation / UKG (5y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'EYP 3 (Graduation/UKG)' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('EYP 3 (Graduation/UKG)', 'MES-EYP3', 1, v_preprimary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 5.0, 6.5, 'Minimum age: 5 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 5.0, max_age = 6.5, notes = 'Minimum age: 5 years as of June 1';

    -- PYP 1 / Grade I (6y+) — strict enforcement
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 1 (Grade I)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('PYP 1 (Grade I)', 'MES-PYP1', 1, v_primary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 6.0, 7.5, 'Minimum age: 6 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 6.0, max_age = 7.5, notes = 'Minimum age: 6 years as of June 1';

    -- PYP 2 / Grade II (7y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 2 (Grade II)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('PYP 2 (Grade II)', 'MES-PYP2', 1, v_primary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 7.0, 8.5, 'Minimum age: 7 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 7.0, max_age = 8.5, notes = 'Minimum age: 7 years as of June 1';

    -- PYP 3 / Grade III (8y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 3 (Grade III)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('PYP 3 (Grade III)', 'MES-PYP3', 1, v_primary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 8.0, 9.5, 'Minimum age: 8 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 8.0, max_age = 9.5, notes = 'Minimum age: 8 years as of June 1';

    -- PYP 4 / Grade IV (9y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 4 (Grade IV)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('PYP 4 (Grade IV)', 'MES-PYP4', 1, v_primary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 9.0, 10.5, 'Minimum age: 9 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 9.0, max_age = 10.5, notes = 'Minimum age: 9 years as of June 1';

    -- PYP 5 / Grade V (10y+)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 5 (Grade V)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id) VALUES ('PYP 5 (Grade V)', 'MES-PYP5', 1, v_primary_id) RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age, max_age, notes) VALUES (v_course_id, 10.0, 11.5, 'Minimum age: 10 years as of June 1')
    ON CONFLICT (course_id) DO UPDATE SET min_age = 10.0, max_age = 11.5, notes = 'Minimum age: 10 years as of June 1';

END $$;
