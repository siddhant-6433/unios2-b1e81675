-- Employee documents, shaped after Keka's.
--
-- employee_documents already exists in production but has never been written back
-- to this repo and has no UI, no bucket and no rows — someone applied it
-- out-of-band and stopped. This writes it back idempotently and finishes it.
--
-- Two things it was missing to be usable:
--
--   * A rejection. It carries verified_by/verified_at only, so a document can be
--     approved but never turned down with a reason — and "upload it again, this one
--     is unreadable" is most of what document review actually is.
--   * A catalogue. Keka's screen is driven by a list of expected documents, which
--     is what produces "Documents pending for upload — 7" and the Mandatory badge.
--     Without it there is nothing to be pending.

CREATE TABLE IF NOT EXISTS public.employee_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  doc_key            text NOT NULL,
  file_path          text NOT NULL,
  file_url           text NOT NULL,
  file_name          text NOT NULL,
  original_file_name text,
  mime_type          text,
  file_size          integer,
  storage_provider   text NOT NULL DEFAULT 'r2' CHECK (storage_provider IN ('r2','supabase')),
  uploaded_source    text NOT NULL DEFAULT 'hr' CHECK (uploaded_source IN ('careers_portal','hr','system')),
  uploaded_by        uuid,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  doc_category       text,
  issued_on          date,
  expires_on         date,
  notes              text,
  verified_by        uuid,
  verified_at        timestamptz
);

-- Review state. Verified-only could not express a rejection, so HR had no way to
-- ask for a replacement.
ALTER TABLE public.employee_documents
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_note text;

ALTER TABLE public.employee_documents DROP CONSTRAINT IF EXISTS employee_documents_status_check;
ALTER TABLE public.employee_documents
  ADD CONSTRAINT employee_documents_status_check
  CHECK (status IN ('pending','verified','rejected'));

-- One current file per document type per employee. A re-upload supersedes rather
-- than piling up, which is what makes "pending" a countable thing.
CREATE UNIQUE INDEX IF NOT EXISTS employee_documents_employee_key_idx
  ON public.employee_documents (employee_id, doc_key);

CREATE INDEX IF NOT EXISTS employee_documents_expiring_idx
  ON public.employee_documents (expires_on)
  WHERE expires_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS employee_documents_status_idx
  ON public.employee_documents (status);

-- ── The catalogue ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_document_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  folder       text NOT NULL DEFAULT 'Other',
  is_mandatory boolean NOT NULL DEFAULT false,
  has_expiry   boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 100,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Seeded from the live Keka tenant's own pending list, so the screen matches what
-- HR already asks people for rather than a generic guess.
INSERT INTO public.employee_document_types (code, name, folder, is_mandatory, has_expiry, sort_order) VALUES
  ('cancelled_cheque',   'Cancelled Cheque / Bank Passbook',                    'Payroll',                 true,  false, 10),
  ('signed_hr_policy',   'Signed HR Policy Document',                           'Onboarding',              true,  false, 20),
  ('signed_offer',       'Signed Offer Letter and Undertaking',                 'Onboarding',              true,  false, 30),
  ('passport_photo',     'Passport Photo for ID Card',                          'Identity',                true,  false, 40),
  ('resume',             'Resume/CV',                                           'Onboarding',              true,  false, 50),
  ('employee_info_form', 'Scan of Employee Information Form',                   'Onboarding',              true,  false, 60),
  ('joining_form',       'Scan of Joining Form',                                'Onboarding',              true,  false, 70),
  ('aadhaar',            'Aadhaar Card',                                        'Identity',                false, false, 80),
  ('pan_card',           'PAN Card',                                            'Identity',                false, false, 90),
  ('degree_certificate', 'Degree / Marksheet',                                  'Degrees & Certificates',  false, false, 100),
  ('experience_letter',  'Previous Experience / Relieving Letter',              'Previous Experience',     false, false, 110),
  ('address_proof',      'Address Proof',                                       'Identity',                false, true,  120)
ON CONFLICT (code) DO NOTHING;

-- ── Access ─────────────────────────────────────────────────────────────
ALTER TABLE public.employee_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_document_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR and owner read employee documents" ON public.employee_documents;
CREATE POLICY "HR and owner read employee documents"
  ON public.employee_documents FOR SELECT TO authenticated
  USING (
    ('hr:view' = ANY (public.get_user_permissions(auth.uid())))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
               WHERE e.id = employee_documents.employee_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HR manages employee documents" ON public.employee_documents;
CREATE POLICY "HR manages employee documents"
  ON public.employee_documents FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR ('hr:employees_edit' = ANY (public.get_user_permissions(auth.uid())))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR ('hr:employees_edit' = ANY (public.get_user_permissions(auth.uid())))
  );

-- Self-service upload: an employee may add their own documents, but only as
-- 'pending' and never re-review their own — verification stays with HR.
DROP POLICY IF EXISTS "Employees upload their own documents" ON public.employee_documents;
CREATE POLICY "Employees upload their own documents"
  ON public.employee_documents FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND verified_by IS NULL
    AND EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = employee_documents.employee_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Everyone reads the document catalogue" ON public.employee_document_types;
CREATE POLICY "Everyone reads the document catalogue"
  ON public.employee_document_types FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "HR manages the document catalogue" ON public.employee_document_types;
CREATE POLICY "HR manages the document catalogue"
  ON public.employee_document_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')
         OR ('hr:employees_edit' = ANY (public.get_user_permissions(auth.uid()))))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin')
         OR ('hr:employees_edit' = ANY (public.get_user_permissions(auth.uid()))));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_documents TO authenticated;
GRANT SELECT ON public.employee_document_types TO authenticated;
GRANT ALL ON public.employee_documents, public.employee_document_types TO service_role;

-- ── Storage ────────────────────────────────────────────────────────────
-- Private, unlike employee-photos. A cancelled cheque and a signed offer letter
-- are not things to serve from a public URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "HR and owner read employee document files" ON storage.objects;
CREATE POLICY "HR and owner read employee document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND (
      ('hr:view' = ANY (public.get_user_permissions(auth.uid())))
      -- Path is <employee_profile_id>/<doc_key>-<stamp>.<ext>
      OR EXISTS (SELECT 1 FROM public.employee_profiles e
                 WHERE e.user_id = auth.uid()
                   AND e.id::text = (storage.foldername(name))[1])
    )
  );

DROP POLICY IF EXISTS "HR and owner write employee document files" ON storage.objects;
CREATE POLICY "HR and owner write employee document files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND (
      ('hr:employees_edit' = ANY (public.get_user_permissions(auth.uid())))
      OR EXISTS (SELECT 1 FROM public.employee_profiles e
                 WHERE e.user_id = auth.uid()
                   AND e.id::text = (storage.foldername(name))[1])
    )
  );

DROP POLICY IF EXISTS "HR replaces employee document files" ON storage.objects;
CREATE POLICY "HR replaces employee document files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'employee-documents'
         AND ('hr:employees_edit' = ANY (public.get_user_permissions(auth.uid()))));

DROP POLICY IF EXISTS "HR deletes employee document files" ON storage.objects;
CREATE POLICY "HR deletes employee document files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'employee-documents'
         AND ('hr:employees_edit' = ANY (public.get_user_permissions(auth.uid()))));

-- ── Review ─────────────────────────────────────────────────────────────
-- A definer RPC so the reviewer is recorded as whoever actually clicked, and so a
-- rejection always carries its reason.
CREATE OR REPLACE FUNCTION public.review_employee_document(
  _document_id uuid,
  _status      text,
  _note        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin')
          OR public.has_permission(auth.uid(), 'hr:employees_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _status NOT IN ('pending','verified','rejected') THEN
    RAISE EXCEPTION 'Unknown status %', _status;
  END IF;

  IF _status = 'rejected' AND COALESCE(btrim(_note), '') = '' THEN
    RAISE EXCEPTION 'Say why it was rejected — the employee has to know what to fix';
  END IF;

  UPDATE public.employee_documents
     SET status      = _status,
         review_note = _note,
         verified_by = CASE WHEN _status = 'verified' THEN auth.uid() ELSE NULL END,
         verified_at = CASE WHEN _status = 'verified' THEN now() ELSE NULL END,
         updated_at  = now()
   WHERE id = _document_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_employee_document(uuid, text, text) TO authenticated;

-- What is still outstanding for one employee: every active catalogue entry with no
-- document, or whose document was rejected. This is the "pending for upload" count.
CREATE OR REPLACE FUNCTION public.employee_pending_documents(_employee_id uuid)
RETURNS TABLE (
  code text, name text, folder text, is_mandatory boolean, status text, review_note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.code, t.name, t.folder, t.is_mandatory,
         COALESCE(d.status, 'missing') AS status,
         d.review_note
  FROM public.employee_document_types t
  LEFT JOIN public.employee_documents d
         ON d.employee_id = _employee_id AND d.doc_key = t.code
  WHERE t.is_active
    AND (d.id IS NULL OR d.status = 'rejected')
    AND (
      ('hr:view' = ANY (public.get_user_permissions(auth.uid())))
      OR EXISTS (SELECT 1 FROM public.employee_profiles e
                 WHERE e.id = _employee_id AND e.user_id = auth.uid())
    )
  ORDER BY t.is_mandatory DESC, t.sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.employee_pending_documents(uuid) TO authenticated;
