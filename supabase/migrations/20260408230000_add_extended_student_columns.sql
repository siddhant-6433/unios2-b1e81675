-- Extended student columns (based on 97-column Excel import)

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS middle_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS date_of_admission date;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS form_filling_date date;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS hostel_type text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS star_information text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS concession_category text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS dnd boolean DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS house text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS school_email text;

-- Father extended details
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_whatsapp text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_email text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_occupation text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_designation text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_organization text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_qualification text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_aadhar text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_income text;

-- Mother extended details
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_whatsapp text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_email text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_occupation text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_organization text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_aadhar text;

-- Address fields
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS pincode text;

-- Identity & demographics
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS student_aadhar text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS biometric_id text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS nationality text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS religion text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS caste text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS sub_caste text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS caste_category text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_tongue text;

-- Financial
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS bank_reference_no text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS fee_remarks text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS fee_profile_type text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS ifsc_code text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS bank_account_no text;

-- Misc
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS food_habits text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS state_enrollment_no text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS birth_place text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS language_spoken text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS sports text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS second_language text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS third_language text;

-- Previous school
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS joining_class text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS previous_school text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS previous_class text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS previous_board text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS joining_academic_year text;

-- Identification
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS identification_marks_1 text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS identification_marks_2 text;

-- Transport & documents
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS transport_required boolean DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS tc_submitted boolean DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS marksheet_submitted boolean DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS dob_certificate_submitted boolean DEFAULT false;

-- WhatsApp
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS whatsapp_no text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS student_email text;

-- Government IDs
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS rte_student boolean DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS pen text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS udise text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS apaar_id text;

-- Medical
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_asthmatic boolean DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS allergies_medicine text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS allergies_food text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS vision text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS medical_ailments text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS physical_handicap text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS ongoing_treatment text;

-- Parent user_id links
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_user_id uuid REFERENCES auth.users(id);

-- SR Number from SchoolKnot
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS sr_number text;

-- Grants
GRANT ALL ON public.students TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.students TO authenticated;
