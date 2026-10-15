-- cbse datesheet unique assessment

-- Prevent separate draft sheets for the same campus/session assessment from
-- both being finalised concurrently.
create unique index if not exists cbse_datesheets_one_final_per_assessment
 on public.cbse_datesheets(institution_id,session_id,category,sequence)
 where status in ('finalized','released');
