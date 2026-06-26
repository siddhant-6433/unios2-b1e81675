-- Library module: catalog, circulation, inventory, patron discovery, and digitization.

DO $$ BEGIN
  CREATE TYPE public.library_item_status AS ENUM (
    'available', 'issued', 'reserved', 'lost', 'damaged', 'repair', 'withdrawn', 'reference_only'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.library_loan_status AS ENUM (
    'active', 'returned', 'overdue', 'lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.library_hold_status AS ENUM (
    'active', 'ready', 'fulfilled', 'cancelled', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.library_digitization_status AS ENUM (
    'captured', 'matched', 'needs_review', 'approved', 'duplicate', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.can_manage_library()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'librarian'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.can_operate_library()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'librarian'::public.app_role)
$$;

CREATE TABLE IF NOT EXISTS public.library_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES public.campuses(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campus_id, institution_id, name),
  UNIQUE (campus_id, institution_id, code)
);

CREATE TABLE IF NOT EXISTS public.library_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  authors text[] NOT NULL DEFAULT '{}',
  isbn_10 text,
  isbn_13 text,
  publisher text,
  published_year int,
  edition text,
  language text,
  category text,
  subject text,
  classification text,
  description text,
  cover_url text,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT library_books_isbn_10_format CHECK (isbn_10 IS NULL OR isbn_10 ~ '^[0-9Xx-]{10,17}$'),
  CONSTRAINT library_books_isbn_13_format CHECK (isbn_13 IS NULL OR isbn_13 ~ '^[0-9-]{13,17}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_books_isbn_10
  ON public.library_books (regexp_replace(coalesce(isbn_10, ''), '[^0-9Xx]', '', 'g'))
  WHERE isbn_10 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_books_isbn_13
  ON public.library_books (regexp_replace(coalesce(isbn_13, ''), '[^0-9]', '', 'g'))
  WHERE isbn_13 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_books_title ON public.library_books (lower(title));

CREATE TABLE IF NOT EXISTS public.library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.library_books(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.library_branches(id) ON DELETE RESTRICT,
  campus_id uuid NOT NULL REFERENCES public.campuses(id) ON DELETE RESTRICT,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  accession_no text NOT NULL,
  barcode text,
  shelf_location text,
  rack text,
  status public.library_item_status NOT NULL DEFAULT 'available',
  condition text NOT NULL DEFAULT 'good',
  source text,
  purchase_date date,
  purchase_price numeric(10,2),
  replacement_cost numeric(10,2),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, accession_no),
  UNIQUE (branch_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_library_items_book_id ON public.library_items(book_id);
CREATE INDEX IF NOT EXISTS idx_library_items_branch_status ON public.library_items(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_library_items_campus_status ON public.library_items(campus_id, status);
CREATE INDEX IF NOT EXISTS idx_library_items_institution_status ON public.library_items(institution_id, status);

CREATE TABLE IF NOT EXISTS public.library_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  member_type text NOT NULL CHECK (member_type IN ('student', 'faculty', 'staff', 'parent', 'external')),
  display_name text NOT NULL,
  phone text,
  email text,
  campus_id uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'inactive')),
  borrowing_limit int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_members_user_unique ON public.library_members(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_members_student_unique ON public.library_members(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_members_campus_status ON public.library_members(campus_id, status);

CREATE TABLE IF NOT EXISTS public.library_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.library_items(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES public.library_members(id) ON DELETE RESTRICT,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  returned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_on date NOT NULL,
  returned_at timestamptz,
  renewed_count int NOT NULL DEFAULT 0,
  status public.library_loan_status NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT library_loans_returned_status CHECK (
    (status = 'returned' AND returned_at IS NOT NULL) OR status <> 'returned'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_one_active_loan_per_item
  ON public.library_loans(item_id)
  WHERE status IN ('active', 'overdue');
CREATE INDEX IF NOT EXISTS idx_library_loans_member_status ON public.library_loans(member_id, status);
CREATE INDEX IF NOT EXISTS idx_library_loans_due_on ON public.library_loans(due_on) WHERE status IN ('active', 'overdue');

CREATE TABLE IF NOT EXISTS public.library_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.library_books(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.library_items(id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.library_members(id) ON DELETE CASCADE,
  status public.library_hold_status NOT NULL DEFAULT 'active',
  priority int NOT NULL DEFAULT 1,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_holds_book_status ON public.library_holds(book_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_library_holds_member_status ON public.library_holds(member_id, status);

CREATE TABLE IF NOT EXISTS public.library_fines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid REFERENCES public.library_loans(id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.library_members(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'waived', 'paid')),
  assessed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_library_fines_member_status ON public.library_fines(member_id, status);

CREATE TABLE IF NOT EXISTS public.library_digitization_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.library_branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.library_digitization_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.library_digitization_batches(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.library_branches(id) ON DELETE SET NULL,
  captured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('barcode', 'cover_photo', 'spine_photo', 'csv_import', 'manual')),
  scanned_barcode text,
  isbn text,
  cover_image_url text,
  raw_ocr_text text,
  suggested_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched_book_id uuid REFERENCES public.library_books(id) ON DELETE SET NULL,
  confidence numeric(4,3),
  status public.library_digitization_status NOT NULL DEFAULT 'captured',
  duplicate_of uuid REFERENCES public.library_digitization_records(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_digitization_records_status ON public.library_digitization_records(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_digitization_records_batch ON public.library_digitization_records(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_library_digitization_records_isbn ON public.library_digitization_records(isbn) WHERE isbn IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.library_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  branch_id uuid REFERENCES public.library_branches(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_audit_events_entity ON public.library_audit_events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_audit_events_actor ON public.library_audit_events(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.library_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.library_branches(id) ON DELETE CASCADE,
  borrowing_days int NOT NULL DEFAULT 14,
  borrowing_limit int NOT NULL DEFAULT 3,
  fine_per_day numeric(10,2) NOT NULL DEFAULT 0,
  renewals_allowed int NOT NULL DEFAULT 1,
  reference_books_circulate boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);

CREATE OR REPLACE FUNCTION public.library_mark_item_issued()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('active', 'overdue') THEN
    IF EXISTS (
      SELECT 1 FROM public.library_items
      WHERE id = NEW.item_id
        AND status NOT IN ('available', 'reserved')
    ) THEN
      RAISE EXCEPTION 'Library item is not available for issue';
    END IF;
    UPDATE public.library_items SET status = 'issued', updated_at = now() WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.library_mark_item_returned()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'returned' AND OLD.status <> 'returned' THEN
    UPDATE public.library_items SET status = 'available', updated_at = now() WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_library_mark_item_issued ON public.library_loans;
CREATE TRIGGER trg_library_mark_item_issued
  BEFORE INSERT ON public.library_loans
  FOR EACH ROW EXECUTE FUNCTION public.library_mark_item_issued();

DROP TRIGGER IF EXISTS trg_library_mark_item_returned ON public.library_loans;
CREATE TRIGGER trg_library_mark_item_returned
  AFTER UPDATE OF status ON public.library_loans
  FOR EACH ROW EXECUTE FUNCTION public.library_mark_item_returned();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'library_branches',
    'library_books',
    'library_items',
    'library_members',
    'library_loans',
    'library_holds',
    'library_digitization_batches',
    'library_digitization_records',
    'library_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;

ALTER TABLE public.library_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_fines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_digitization_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_digitization_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users discover library branches" ON public.library_branches
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Library managers maintain branches" ON public.library_branches
  FOR ALL TO authenticated USING (public.can_manage_library()) WITH CHECK (public.can_manage_library());

CREATE POLICY "Authenticated users discover library books" ON public.library_books
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Library staff catalog books" ON public.library_books
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

CREATE POLICY "Authenticated users discover library items" ON public.library_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Library staff manage items" ON public.library_items
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

CREATE POLICY "Members view own library record" ON public.library_members
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.can_manage_library());
CREATE POLICY "Library staff manage members" ON public.library_members
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

CREATE POLICY "Members view own loans" ON public.library_loans
  FOR SELECT TO authenticated USING (
    public.can_manage_library()
    OR EXISTS (
      SELECT 1 FROM public.library_members m
      WHERE m.id = library_loans.member_id AND m.user_id = auth.uid()
    )
  );
CREATE POLICY "Library staff circulate loans" ON public.library_loans
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

CREATE POLICY "Members view own holds" ON public.library_holds
  FOR SELECT TO authenticated USING (
    public.can_manage_library()
    OR EXISTS (
      SELECT 1 FROM public.library_members m
      WHERE m.id = library_holds.member_id AND m.user_id = auth.uid()
    )
  );
CREATE POLICY "Patrons create own holds" ON public.library_holds
  FOR INSERT TO authenticated WITH CHECK (
    public.can_manage_library()
    OR EXISTS (
      SELECT 1 FROM public.library_members m
      WHERE m.id = library_holds.member_id AND m.user_id = auth.uid()
    )
  );
CREATE POLICY "Library staff manage holds" ON public.library_holds
  FOR UPDATE TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

CREATE POLICY "Members view own fines" ON public.library_fines
  FOR SELECT TO authenticated USING (
    public.can_manage_library()
    OR EXISTS (
      SELECT 1 FROM public.library_members m
      WHERE m.id = library_fines.member_id AND m.user_id = auth.uid()
    )
  );
CREATE POLICY "Library staff manage fines" ON public.library_fines
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

CREATE POLICY "Library staff view digitization batches" ON public.library_digitization_batches
  FOR SELECT TO authenticated USING (public.can_operate_library());
CREATE POLICY "Library staff manage digitization batches" ON public.library_digitization_batches
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

CREATE POLICY "Library staff view digitization records" ON public.library_digitization_records
  FOR SELECT TO authenticated USING (public.can_operate_library());
CREATE POLICY "Library staff manage digitization records" ON public.library_digitization_records
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

CREATE POLICY "Library managers view audit events" ON public.library_audit_events
  FOR SELECT TO authenticated USING (public.can_manage_library());
CREATE POLICY "Library staff insert audit events" ON public.library_audit_events
  FOR INSERT TO authenticated WITH CHECK (public.can_operate_library());

CREATE POLICY "Authenticated users view library settings" ON public.library_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Library managers maintain settings" ON public.library_settings
  FOR ALL TO authenticated USING (public.can_manage_library()) WITH CHECK (public.can_manage_library());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_branches, public.library_books, public.library_items, public.library_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.library_members,
  public.library_loans,
  public.library_holds,
  public.library_fines,
  public.library_digitization_batches,
  public.library_digitization_records,
  public.library_audit_events
TO authenticated;
GRANT ALL ON
  public.library_branches,
  public.library_books,
  public.library_items,
  public.library_members,
  public.library_loans,
  public.library_holds,
  public.library_fines,
  public.library_digitization_batches,
  public.library_digitization_records,
  public.library_audit_events,
  public.library_settings
TO service_role;

INSERT INTO public.permissions (module, action, description) VALUES
  ('library', 'view', 'View library dashboard and discovery'),
  ('library', 'catalog', 'Create and edit library catalog records'),
  ('library', 'circulate', 'Issue, return, renew, and manage holds'),
  ('library', 'inventory', 'Run shelf audits and manage item status'),
  ('library', 'digitize', 'Capture and review offline book records'),
  ('library', 'manage_settings', 'Manage library branches and circulation rules'),
  ('library', 'export', 'Export library reports and catalog data')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'librarian'::public.app_role, id
FROM public.permissions
WHERE module = 'library'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'super_admin'::public.app_role, id
FROM public.permissions
WHERE module = 'library'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT role_name::public.app_role, p.id
FROM unnest(ARRAY['principal','campus_admin']) AS role_name
CROSS JOIN public.permissions p
WHERE p.module = 'library'
  AND p.action IN ('view', 'manage_settings', 'export')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT role_name::public.app_role, p.id
FROM unnest(ARRAY['student','parent','faculty','teacher']) AS role_name
CROSS JOIN public.permissions p
WHERE p.module = 'library'
  AND p.action = 'view'
ON CONFLICT DO NOTHING;
