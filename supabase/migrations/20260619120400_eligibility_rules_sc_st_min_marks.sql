ALTER TABLE eligibility_rules
  ADD COLUMN IF NOT EXISTS sc_st_min_marks numeric(5,2) DEFAULT NULL;

COMMENT ON COLUMN eligibility_rules.sc_st_min_marks IS
  'Minimum Class 12 percentage required for SC/ST applicants. When NULL, class_12_min_marks applies to all categories.';
