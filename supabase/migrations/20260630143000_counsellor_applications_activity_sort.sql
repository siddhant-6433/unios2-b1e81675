-- Keep counsellor-scoped application lists aligned with the Applications page:
-- most recently active applications first, not just newest created rows.

DROP FUNCTION IF EXISTS public.counsellor_applications();

CREATE OR REPLACE FUNCTION public.counsellor_applications()
RETURNS TABLE (
  id uuid,
  application_id text,
  lead_id uuid,
  full_name text,
  phone text,
  email text,
  status text,
  payment_status text,
  payment_ref text,
  fee_amount numeric,
  program_category text,
  course_selections jsonb,
  completed_sections jsonb,
  submitted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  flags text[],
  dob date,
  gender text,
  category text,
  father jsonb,
  mother jsonb,
  address jsonb,
  academic_details jsonb,
  form_pdf_url text,
  fee_receipt_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.id,
    a.application_id,
    a.lead_id,
    a.full_name,
    a.phone,
    a.email,
    a.status,
    a.payment_status,
    a.payment_ref,
    a.fee_amount,
    a.program_category,
    a.course_selections,
    a.completed_sections,
    a.submitted_at,
    a.created_at,
    a.updated_at,
    a.flags,
    a.dob,
    a.gender,
    a.category,
    a.father,
    a.mother,
    a.address,
    a.academic_details,
    a.form_pdf_url,
    a.fee_receipt_url
  FROM public.applications a
  JOIN public.leads l ON l.id = a.lead_id
  JOIN public.profiles p ON p.id = l.counsellor_id
  WHERE p.user_id = auth.uid()
  ORDER BY a.updated_at DESC, a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.counsellor_applications() TO authenticated;
