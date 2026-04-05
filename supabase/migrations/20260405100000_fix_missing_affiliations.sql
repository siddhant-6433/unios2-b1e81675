-- Fix missing affiliations for courses that have null

-- DPT: approved by UP State Medical Faculty
UPDATE public.courses SET affiliations = ARRAY['Uttar Pradesh State Medical Faculty'] WHERE code = 'DPT-GN';

-- MMRIT: affiliated to ABVMU
UPDATE public.courses SET affiliations = ARRAY['Atal Bihari Vajpayee Medical University, Lucknow'] WHERE code = 'MMRIT-GN';

-- LLB Kotputli: affiliated to University of Rajasthan + BCI
UPDATE public.courses SET affiliations = ARRAY['University of Rajasthan', 'Bar Council of India'] WHERE code = 'LLB-KT';

-- LLB Greater Noida: should be CCSU + BCI
UPDATE public.courses SET affiliations = ARRAY['Chaudhary Charan Singh University', 'Bar Council of India'] WHERE code = 'LLB-GN';
