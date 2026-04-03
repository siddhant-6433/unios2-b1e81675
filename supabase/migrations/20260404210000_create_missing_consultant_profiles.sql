-- Auto-create consultant profiles for any user with consultant role that doesn't have one
INSERT INTO public.consultants (name, email, phone, user_id, stage)
SELECT
  COALESCE(p.display_name, p.email, 'Unnamed Consultant'),
  p.email,
  p.phone,
  p.user_id,
  'active'
FROM public.profiles p
INNER JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'consultant'
LEFT JOIN public.consultants c ON c.user_id = p.user_id
WHERE c.id IS NULL;

-- Also add RLS policy so consultants can view their own record
CREATE POLICY "Consultants can view own record" ON public.consultants FOR SELECT TO authenticated
  USING (user_id = auth.uid());
