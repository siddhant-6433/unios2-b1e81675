-- Add curriculum_url to courses table
ALTER TABLE courses ADD COLUMN IF NOT EXISTS curriculum_url text;

-- Link uploaded curriculum PDFs
UPDATE courses SET curriculum_url = 'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/course-documents/BPT-GN/NCAHP_BPT_Curriculum.pdf'
WHERE code = 'BPT-GN';

UPDATE courses SET curriculum_url = 'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/course-documents/BMRIT-GN/NCAHP_BMRIT_Curriculum.pdf'
WHERE code = 'BMRIT-GN';
