-- grant cleanup phone anon execute
-- The applications phone expression index invokes cleanup_phone on INSERT.
-- Applicant applications can be inserted with the anon role, so that role
-- also needs EXECUTE on this pure phone-normalization helper.
GRANT EXECUTE ON FUNCTION public.cleanup_phone(text) TO anon;
