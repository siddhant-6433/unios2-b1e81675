-- HR Employee Engagement & Helpdesk (new pillar).
--
-- Announcements (org-wide or targeted), helpdesk tickets with a threaded
-- conversation, and lightweight peer recognition. This is the "employee voice"
-- layer a Keka-class HRMS provides on top of the transactional modules.

CREATE TABLE IF NOT EXISTS public.announcements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  body           text NOT NULL,
  audience_roles app_role[],
  institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  campus_id      uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  is_pinned      boolean NOT NULL DEFAULT false,
  published_at   timestamptz,
  expires_at     timestamptz,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_live_idx
  ON public.announcements (COALESCE(published_at, created_at) DESC)
  WHERE published_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.announcement_reads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.helpdesk_tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no           text UNIQUE,
  employee_profile_id uuid REFERENCES public.employee_profiles(id) ON DELETE SET NULL,
  submitted_by        uuid REFERENCES auth.users(id),
  category            text NOT NULL DEFAULT 'general'
                        CHECK (category IN ('general','payroll','attendance','leave','documents','it','facilities','grievance')),
  subject             text NOT NULL,
  description         text,
  priority            text NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high','urgent')),
  status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to         uuid REFERENCES auth.users(id),
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_status_idx
  ON public.helpdesk_tickets (status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_employee_idx
  ON public.helpdesk_tickets (employee_profile_id, status);

CREATE TABLE IF NOT EXISTS public.helpdesk_ticket_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES public.helpdesk_tickets(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES auth.users(id),
  body       text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS helpdesk_messages_ticket_idx
  ON public.helpdesk_ticket_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.recognitions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id          uuid REFERENCES auth.users(id),
  to_employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  message               text NOT NULL,
  value_tag             text,
  is_public             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recognitions_to_idx
  ON public.recognitions (to_employee_profile_id, created_at DESC);

-- ── Permissions ─────────────────────────────────────────────────────────────

INSERT INTO public.permissions (module, action, description) VALUES
  ('hr', 'engage_manage',   'Publish announcements and recognitions'),
  ('hr', 'helpdesk_manage', 'Triage and resolve helpdesk tickets')
ON CONFLICT (module, action) DO NOTHING;

DO $$
DECLARE
  v_engage uuid;
  v_help   uuid;
  r app_role;
BEGIN
  SELECT id INTO v_engage FROM public.permissions WHERE module = 'hr' AND action = 'engage_manage';
  SELECT id INTO v_help   FROM public.permissions WHERE module = 'hr' AND action = 'helpdesk_manage';

  FOREACH r IN ARRAY ARRAY['super_admin','campus_admin','principal','hr_executive']::app_role[] LOOP
    INSERT INTO public.role_permissions (role, permission_id) VALUES (r, v_engage) ON CONFLICT DO NOTHING;
    INSERT INTO public.role_permissions (role, permission_id) VALUES (r, v_help)   ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.announcements             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helpdesk_tickets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helpdesk_ticket_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognitions              ENABLE ROW LEVEL SECURITY;

-- Published, unexpired announcements whose audience (if set) includes one of
-- the caller's roles.
DROP POLICY IF EXISTS "Staff read live announcements" ON public.announcements;
CREATE POLICY "Staff read live announcements"
  ON public.announcements FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:engage_manage'))
    OR (
      published_at IS NOT NULL
      AND published_at <= now()
      AND (expires_at IS NULL OR expires_at > now())
      AND (
        audience_roles IS NULL
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid() AND ur.role = ANY (announcements.audience_roles)
        )
      )
    )
  );

DROP POLICY IF EXISTS "HR manages announcements" ON public.announcements;
CREATE POLICY "HR manages announcements"
  ON public.announcements FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:engage_manage')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:engage_manage')));

DROP POLICY IF EXISTS "Users read own announcement reads" ON public.announcement_reads;
CREATE POLICY "Users read own announcement reads"
  ON public.announcement_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (SELECT public.has_permission(auth.uid(), 'hr:engage_manage')));

DROP POLICY IF EXISTS "Users mark announcements read" ON public.announcement_reads;
CREATE POLICY "Users mark announcements read"
  ON public.announcement_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "People read own tickets" ON public.helpdesk_tickets;
CREATE POLICY "People read own tickets"
  ON public.helpdesk_tickets FOR SELECT TO authenticated
  USING (
    submitted_by = auth.uid()
    OR assigned_to = auth.uid()
    OR (SELECT public.has_permission(auth.uid(), 'hr:helpdesk_manage'))
  );

DROP POLICY IF EXISTS "People raise tickets" ON public.helpdesk_tickets;
CREATE POLICY "People raise tickets"
  ON public.helpdesk_tickets FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid() OR (SELECT public.has_permission(auth.uid(), 'hr:helpdesk_manage')));

DROP POLICY IF EXISTS "People update relevant tickets" ON public.helpdesk_tickets;
CREATE POLICY "People update relevant tickets"
  ON public.helpdesk_tickets FOR UPDATE TO authenticated
  USING (
    submitted_by = auth.uid()
    OR assigned_to = auth.uid()
    OR (SELECT public.has_permission(auth.uid(), 'hr:helpdesk_manage'))
  )
  WITH CHECK (
    submitted_by = auth.uid()
    OR assigned_to = auth.uid()
    OR (SELECT public.has_permission(auth.uid(), 'hr:helpdesk_manage'))
  );

DROP POLICY IF EXISTS "People read ticket messages" ON public.helpdesk_ticket_messages;
CREATE POLICY "People read ticket messages"
  ON public.helpdesk_ticket_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.helpdesk_tickets t
       WHERE t.id = helpdesk_ticket_messages.ticket_id
         AND (t.submitted_by = auth.uid() OR t.assigned_to = auth.uid()
              OR (SELECT public.has_permission(auth.uid(), 'hr:helpdesk_manage')))
    )
    AND (is_internal IS FALSE OR (SELECT public.has_permission(auth.uid(), 'hr:helpdesk_manage')))
  );

DROP POLICY IF EXISTS "People write ticket messages" ON public.helpdesk_ticket_messages;
CREATE POLICY "People write ticket messages"
  ON public.helpdesk_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.helpdesk_tickets t
       WHERE t.id = helpdesk_ticket_messages.ticket_id
         AND (t.submitted_by = auth.uid() OR t.assigned_to = auth.uid()
              OR (SELECT public.has_permission(auth.uid(), 'hr:helpdesk_manage')))
    )
  );

DROP POLICY IF EXISTS "Staff read public recognition" ON public.recognitions;
CREATE POLICY "Staff read public recognition"
  ON public.recognitions FOR SELECT TO authenticated
  USING (
    is_public OR from_user_id = auth.uid()
    OR (SELECT public.has_permission(auth.uid(), 'hr:engage_manage'))
  );

DROP POLICY IF EXISTS "Staff give recognition" ON public.recognitions;
CREATE POLICY "Staff give recognition"
  ON public.recognitions FOR INSERT TO authenticated
  WITH CHECK (from_user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.announcement_reads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.helpdesk_tickets TO authenticated;
GRANT SELECT, INSERT ON public.helpdesk_ticket_messages TO authenticated;
GRANT SELECT, INSERT ON public.recognitions TO authenticated;
GRANT ALL ON public.announcements, public.announcement_reads, public.helpdesk_tickets,
  public.helpdesk_ticket_messages, public.recognitions TO service_role;

-- ── Triggers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_hr_engagement_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_announcements_touch ON public.announcements;
CREATE TRIGGER trg_announcements_touch
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.tg_hr_engagement_touch();

DROP TRIGGER IF EXISTS trg_helpdesk_tickets_touch ON public.helpdesk_tickets;
CREATE TRIGGER trg_helpdesk_tickets_touch
  BEFORE UPDATE ON public.helpdesk_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tg_hr_engagement_touch();

-- Human ticket number, e.g. HD-2026-000123.
CREATE SEQUENCE IF NOT EXISTS public.helpdesk_ticket_seq;
GRANT USAGE, SELECT ON SEQUENCE public.helpdesk_ticket_seq TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_helpdesk_ticket_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ticket_no IS NULL THEN
    NEW.ticket_no := 'HD-' || to_char(now(), 'YYYY') || '-' ||
                     lpad((nextval('public.helpdesk_ticket_seq'))::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_helpdesk_ticket_number ON public.helpdesk_tickets;
CREATE TRIGGER trg_helpdesk_ticket_number
  BEFORE INSERT ON public.helpdesk_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tg_helpdesk_ticket_number();

-- ── RPCs ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_helpdesk_ticket(
  _category text, _subject text, _description text, _priority text DEFAULT 'normal'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_profile uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_profile FROM public.employee_profiles WHERE user_id = auth.uid();

  INSERT INTO public.helpdesk_tickets
    (employee_profile_id, submitted_by, category, subject, description, priority, status)
  VALUES (v_profile, auth.uid(), _category, _subject, _description, _priority, 'open')
  RETURNING id INTO v_id;

  -- Notify HR managers.
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT ur.user_id, 'helpdesk_ticket', 'New helpdesk ticket', _subject, '/hr-helpdesk'
    FROM public.user_roles ur
   WHERE ur.role IN ('super_admin'::public.app_role, 'hr_executive'::public.app_role, 'campus_admin'::public.app_role);
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_helpdesk_ticket(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_helpdesk_ticket(text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_helpdesk_ticket(
  _ticket_id uuid, _status text DEFAULT NULL, _assigned_to uuid DEFAULT NULL, _note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new_status text;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:helpdesk_manage')
          OR EXISTS (SELECT 1 FROM public.helpdesk_tickets t WHERE t.id = _ticket_id AND t.submitted_by = auth.uid())) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  v_new_status := COALESCE(_status, (SELECT status FROM public.helpdesk_tickets WHERE id = _ticket_id));

  UPDATE public.helpdesk_tickets
     SET status = v_new_status,
         assigned_to = COALESCE(_assigned_to, assigned_to),
         resolved_at = CASE WHEN v_new_status IN ('resolved','closed') THEN now() ELSE resolved_at END
   WHERE id = _ticket_id;

  IF _note IS NOT NULL THEN
    INSERT INTO public.helpdesk_ticket_messages (ticket_id, author_id, body, is_internal)
    VALUES (_ticket_id, auth.uid(), _note, true);
  END IF;

  RETURN v_new_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_helpdesk_ticket(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_helpdesk_ticket(uuid, text, uuid, text) TO authenticated, service_role;

-- ── Conversation index view ─────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.helpdesk_ticket_inbox AS
SELECT
  t.id, t.ticket_no, t.employee_profile_id, t.submitted_by, t.category, t.subject,
  t.priority, t.status, t.assigned_to, t.created_at, t.updated_at, t.resolved_at,
  COALESCE(NULLIF(btrim(e.display_name), ''), btrim(concat_ws(' ', e.first_name, e.last_name))) AS employee_name,
  p.display_name AS assigned_to_name,
  (SELECT count(*) FROM public.helpdesk_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
FROM public.helpdesk_tickets t
LEFT JOIN public.employee_profiles e ON e.id = t.employee_profile_id
LEFT JOIN public.profiles p ON p.user_id = t.assigned_to;

ALTER VIEW public.helpdesk_ticket_inbox SET (security_invoker = true);
GRANT SELECT ON public.helpdesk_ticket_inbox TO authenticated, service_role;
