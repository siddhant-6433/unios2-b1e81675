-- Refined Setup for Mirai Experiential School
-- This script creates the Campus, Institution, Departments, and all 10 Grades with age eligibility rules.
-- Run this in your Supabase SQL Editor.

DO $$
DECLARE
    v_campus_id UUID;
    v_mirai_id UUID;
    v_preprimary_id UUID;
    v_primary_id UUID;
    v_course_id UUID;
BEGIN
    -- 1. Campus
    SELECT id INTO v_campus_id FROM campuses WHERE name ILIKE '%Mirai%' LIMIT 1;
    IF v_campus_id IS NULL THEN
        INSERT INTO campuses (name, code, city) VALUES ('Mirai Campus', 'MIRAI', 'Faridabad') RETURNING id INTO v_campus_id;
    END IF;

    -- 2. Institution
    SELECT id INTO v_mirai_id FROM institutions WHERE name ILIKE '%Mirai%' LIMIT 1;
    IF v_mirai_id IS NULL THEN
        INSERT INTO institutions (name, code, type, campus_id) VALUES ('Mirai Experiential School', 'MES', 'school', v_campus_id) RETURNING id INTO v_mirai_id;
    END IF;

    -- 3. Departments
    SELECT id INTO v_preprimary_id FROM departments WHERE name ILIKE '%Pre-Primary%' AND institution_id = v_mirai_id LIMIT 1;
    IF v_preprimary_id IS NULL THEN
        INSERT INTO departments (name, code, institution_id) VALUES ('Pre-Primary', 'EYP', v_mirai_id) RETURNING id INTO v_preprimary_id;
    END IF;

    SELECT id INTO v_primary_id FROM departments WHERE name ILIKE '%Primary%' AND institution_id = v_mirai_id LIMIT 1;
    IF v_primary_id IS NULL THEN
        INSERT INTO departments (name, code, institution_id) VALUES ('Primary', 'PYP', v_mirai_id) RETURNING id INTO v_primary_id;
    END IF;

    -- 4. Grades & Eligibility Rules

    -- Toddlers (1.6y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'Toddlers' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('Toddlers', 'TOD', 1, v_preprimary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 1.6) ON CONFLICT (course_id) DO UPDATE SET min_age = 1.6;

    -- Montessori (2y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'Montessori' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('Montessori', 'MON', 1, v_preprimary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 2.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 2.0;

    -- EYP 1 (3y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'EYP 1 (Junior/Nursery)' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('EYP 1 (Junior/Nursery)', 'EYP1', 1, v_preprimary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 3.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 3.0;

    -- EYP 2 (4y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'EYP 2 (Senior/LKG)' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('EYP 2 (Senior/LKG)', 'EYP2', 1, v_preprimary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 4.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 4.0;

    -- EYP 3 (5y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'EYP 3 (Graduation/UKG)' AND department_id = v_preprimary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('EYP 3 (Graduation/UKG)', 'EYP3', 1, v_preprimary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 5.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 5.0;

    -- PYP 1 (6y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 1 (Grade I)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('PYP 1 (Grade I)', 'PYP1', 1, v_primary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 6.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 6.0;

    -- PYP 2 (7y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 2 (Grade II)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('PYP 2 (Grade II)', 'PYP2', 1, v_primary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 7.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 7.0;

    -- PYP 3 (8y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 3 (Grade III)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('PYP 3 (Grade III)', 'PYP3', 1, v_primary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 8.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 8.0;

    -- PYP 4 (9y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 4 (Grade IV)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('PYP 4 (Grade IV)', 'PYP4', 1, v_primary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 9.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 9.0;

    -- PYP 5 (10y)
    SELECT id INTO v_course_id FROM courses WHERE name = 'PYP 5 (Grade V)' AND department_id = v_primary_id LIMIT 1;
    IF v_course_id IS NULL THEN
        INSERT INTO courses (name, code, duration_years, department_id, level) VALUES ('PYP 5 (Grade V)', 'PYP5', 1, v_primary_id, 'school') RETURNING id INTO v_course_id;
    END IF;
    INSERT INTO eligibility_rules (course_id, min_age) VALUES (v_course_id, 10.0) ON CONFLICT (course_id) DO UPDATE SET min_age = 10.0;

END $$;
