-- HR Executive role: runs the hiring process (job applicants, replies, interviews,
-- document generation) but every generated document needs super_admin approval
-- before it can be issued. Enum value only — a new value must be committed before
-- any later migration can cast to it, so permissions/RLS live in a separate file.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr_executive';
