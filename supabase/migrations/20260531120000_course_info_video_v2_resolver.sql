-- course_info_video_v2 resolver — body-link replacement for course_info_video.
--
-- The old course_info_video template carried its course / campus / apply links
-- as Meta URL-button *prefixes* (baked into the approved template). That made
-- two bugs unfixable from our side:
--   1. Apply button prefix was https://app.nimt.ac.in/apply/ (wrong domain).
--   2. Campus button prefix was https://maps.google.com/?q={{1}}, so an untagged
--      lead got a useless "?q=NIMT" search, and there was no way to fall back to
--      a "list all campuses" page.
-- It was also auto-sent on every new lead with hard-coded "N/A" duration,
-- "As per university norms" eligibility, and "our campus" — junk when the lead
-- has no course/campus tagged.
--
-- v2 follows the pattern already used by course_info_v3/v4: put every URL in the
-- BODY (WhatsApp auto-linkifies them), so there are no fixed button prefixes to
-- get wrong. This resolver fills the body params per-lead, each with a graceful
-- fallback when the lead is untagged:
--   course_url  → course page,  else the full courses listing  (/courses/)
--   campus_url  → that campus's precise Maps link, else the contact page (all
--                 campuses) (/contact/)
--   apply_url   → always https://uni.nimt.ac.in/apply/nimt (correct domain)
--
-- NOTE: This migration is safe to apply immediately (purely additive). The
-- companion migration that flips the new-lead auto-send rule to v2 must only be
-- applied AFTER the course_info_video_v2 template is APPROVED in Meta — otherwise
-- new-lead sends fail on an unknown template name.

CREATE OR REPLACE FUNCTION public.fn_resolve_course_info_video_params(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead         record;
  v_course       record;
  v_campus       record;
  v_course_label text := 'our programmes';
  v_course_url   text := 'https://nimt.ac.in/courses/';
  v_campus_url   text := 'https://nimt.ac.in/contact/';
  v_apply_url    text := 'https://uni.nimt.ac.in/apply/nimt';
BEGIN
  SELECT id, name, course_id, campus_id
    INTO v_lead
    FROM public.leads
   WHERE id = p_lead_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Course: link to the course page when tagged, else the full course listing.
  IF v_lead.course_id IS NOT NULL THEN
    SELECT name, slug INTO v_course FROM public.courses WHERE id = v_lead.course_id;
    IF FOUND THEN
      IF v_course.name IS NOT NULL AND length(trim(v_course.name)) > 0 THEN
        v_course_label := v_course.name;
      END IF;
      IF v_course.slug IS NOT NULL AND length(trim(v_course.slug)) > 0 THEN
        v_course_url := 'https://nimt.ac.in/courses/' || v_course.slug;
      END IF;
    END IF;
  END IF;

  -- Campus: precise Maps link when tagged, else the contact page (all campuses
  -- with their map locations).
  IF v_lead.campus_id IS NOT NULL THEN
    SELECT google_maps_url, maps_cid INTO v_campus FROM public.campuses WHERE id = v_lead.campus_id;
    IF FOUND THEN
      IF v_campus.google_maps_url IS NOT NULL AND length(trim(v_campus.google_maps_url)) > 0 THEN
        v_campus_url := v_campus.google_maps_url;
      ELSIF v_campus.maps_cid IS NOT NULL AND length(trim(v_campus.maps_cid)) > 0 THEN
        v_campus_url := 'https://maps.google.com/?cid=' || v_campus.maps_cid;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'student_name', COALESCE(NULLIF(trim(v_lead.name), ''), 'there'),
    'course_label', v_course_label,
    'course_url',   v_course_url,
    'campus_url',   v_campus_url,
    'apply_url',    v_apply_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_course_info_video_params(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_resolve_course_info_video_params(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_resolve_course_info_video_params(uuid) IS
  'Builds course_info_video_v2 WhatsApp body params for a lead: course page (or /courses listing), campus Maps link (or /contact page), and the apply portal URL. URLs live in the body so there are no Meta button-prefix locks. Never returns null params for a real lead.';
