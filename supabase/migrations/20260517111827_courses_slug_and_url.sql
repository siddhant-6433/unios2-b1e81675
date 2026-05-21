-- Add a `slug` column to public.courses for building nimt.ac.in course-page
-- URLs from WhatsApp templates and the apply portal.
--
-- The slug values are sourced from NIMTWeb's CMS export
-- (content-export/courses.json). Mapping is by course code, which is the
-- stable identifier shared across DB rows for the same programme on
-- different campuses (e.g. BED-GN / BED-GZ / BED-KT map to
-- bachelor-of-education-{campus} slugs).
--
-- URL pattern: https://www.nimt.ac.in/courses/{slug}
-- Fee section anchor on the page: #admissions

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS slug text;

CREATE INDEX IF NOT EXISTS idx_courses_slug ON public.courses (slug);

-- Backfill known codes. Codes without a published page on NIMTWeb stay NULL
-- and the WhatsApp resolver will fall back to the /courses listing URL.
UPDATE public.courses SET slug = CASE code
  WHEN 'BCA-GN'      THEN 'bachelor-of-computer-applications-bca'
  WHEN 'BBA-GN'      THEN 'bachelor-of-business-administration-bba'
  WHEN 'MBA-GN'      THEN 'master-of-business-administration-mba'
  WHEN 'PGDM-GN'     THEN 'post-graduate-diploma-in-management-pgdm'
  WHEN 'PGDM-GZ'     THEN 'post-graduate-diploma-in-management-pgdm-ghaziabad'
  WHEN 'PGDM-KT'     THEN 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
  WHEN 'BSCN-GN'     THEN 'bachelor-of-science-in-nursing'
  WHEN 'GNM-GN'      THEN 'diploma-in-general-nursing-midwifery-gnm'
  WHEN 'BPT-GN'      THEN 'bachelor-of-physiotherapy'
  WHEN 'MPT-GN'      THEN 'masters-in-physiotherapy'
  WHEN 'DPT-GN'      THEN 'diploma-in-physiotherapy'
  WHEN 'BMRIT-GN'    THEN 'b-sc-in-radiology-and-imaging-technology'
  WHEN 'MMRIT-GN'    THEN 'm-sc-in-medical-radiology-imaging-technology-mmrit'
  WHEN 'OTT-GN'      THEN 'diploma-in-operation-theatre-technology'
  WHEN 'DPHARMA-GN'  THEN 'diploma-in-pharmacy'
  WHEN 'BED-GN'      THEN 'bachelor-of-education-greater-noida'
  WHEN 'BED-GZ'      THEN 'bachelor-of-education-ghaziabad'
  WHEN 'BED-KT'      THEN 'bachelor-of-education-kotputli-jaipur'
  WHEN 'DELED-GZ'    THEN 'diploma-in-elementary-education-d-el-ed-btc'
  WHEN 'BALLB-GN'    THEN 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
  WHEN 'BALLB-KT'    THEN 'bachelor-of-arts-bachelor-of-laws-ba-llb-kotputli'
  WHEN 'LLB-GN'      THEN 'bachelor-of-laws-llb'
  ELSE slug
END
WHERE code IN (
  'BCA-GN','BBA-GN','MBA-GN','PGDM-GN','PGDM-GZ','PGDM-KT',
  'BSCN-GN','GNM-GN','BPT-GN','MPT-GN','DPT-GN','BMRIT-GN','MMRIT-GN',
  'OTT-GN','DPHARMA-GN','BED-GN','BED-GZ','BED-KT','DELED-GZ',
  'BALLB-GN','BALLB-KT','LLB-GN'
);

COMMENT ON COLUMN public.courses.slug IS
  'NIMTWeb course-page slug. URL: https://www.nimt.ac.in/courses/{slug}. NULL → resolver falls back to /courses listing. Backfilled from content-export/courses.json in the nimtweb repo; keep in sync when new courses ship on the public site.';
