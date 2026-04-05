-- LLB Kotputli: Dr. Bhimrao Ambedkar Law University, Jaipur (not University of Rajasthan)
UPDATE public.courses SET affiliations = ARRAY['Dr. Bhimrao Ambedkar Law University, Jaipur', 'Bar Council of India'] WHERE code = 'LLB-KT';

-- BBA: add AICTE approval
UPDATE public.courses SET affiliations = ARRAY['Chaudhary Charan Singh University', 'All India Council for Technical Education'] WHERE code = 'BBA-GN';

-- BCA: add AICTE approval
UPDATE public.courses SET affiliations = ARRAY['Chaudhary Charan Singh University', 'All India Council for Technical Education'] WHERE code = 'BCA-GN';
