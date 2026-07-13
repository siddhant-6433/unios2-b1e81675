-- Super admins / admission heads could not approve or answer anything in the
-- Navya Knowledge page: the learning tables only granted SELECT to
-- authenticated, so the RLS manage policies (super_admin / admission_head)
-- had no table-level privilege to act on. RLS continues to gate WHO can
-- write; these grants just make the policies effective.

grant insert, update on public.admissions_ai_reply_examples to authenticated;
grant insert, update on public.voice_knowledge_gaps to authenticated;
