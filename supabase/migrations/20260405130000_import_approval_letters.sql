-- Import approval letters from Webflow CSV


INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'ABVMUUP BMRIT LOC 2021-22', 'abvmuup-bmrit-loc',
  (SELECT id FROM public.approval_bodies WHERE name = 'Atal Bihari Vajpayee Medical University, Lucknow' LIMIT 1),
  '2022-02-21', '2021 - 2022', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/64045e9d27be9b77b6c96884_BRDIT_ATAL_LNO%20780-%20LoC%20NIMT21022.pdf', '66620d67965c2281e7a7bf90'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'abvmuup-bmrit-loc');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'abvmuup-bmrit-loc' AND c.webflow_slug = 'b-sc-in-radiology-and-imaging-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'ABVMUUP BPT LOC 2021-22', 'abvmuup-loc',
  (SELECT id FROM public.approval_bodies WHERE name = 'Atal Bihari Vajpayee Medical University, Lucknow' LIMIT 1),
  '2022-02-21', '2021 - 2022', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/64045e3abdf9c62750968031_BPT_ATAL_LNO%20779-%20LoC%20NIMT%20(2)21022.pdf', '66620d679f85517fbd0266a9'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'abvmuup-loc');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'abvmuup-loc' AND c.webflow_slug = 'bachelor-of-physiotherapy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'ABVMUUP MMRIT LOI 2022-23', 'abvmuup-mmrit-loi',
  (SELECT id FROM public.approval_bodies WHERE name = 'Atal Bihari Vajpayee Medical University, Lucknow' LIMIT 1),
  '2022-09-02', '2022 - 2023', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/64045fa5d395812aa0e6dead_MMRIT%20LOI.pdf', '66620d67e3309b2a7db894e2'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'abvmuup-mmrit-loi');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'abvmuup-mmrit-loi' AND c.webflow_slug = 'm-sc-in-medical-radiology-imaging-technology-mmrit'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'ABVMUUP MPT LOI 2022-23', 'abvmuup-mpt-loi',
  (SELECT id FROM public.approval_bodies WHERE name = 'Atal Bihari Vajpayee Medical University, Lucknow' LIMIT 1),
  '2022-09-02', '2022 - 2023', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/64045f8fa2b653484f5d4204_LOI%20MPT.pdf', '66620d67b5c722fb3fe5e91a'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'abvmuup-mpt-loi');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'abvmuup-mpt-loi' AND c.webflow_slug = 'masters-in-physiotherapy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter - 2023-24 ALU - NIMT Kotputli', 'alu-affiliation-letter-for-session-2023-24',
  (SELECT id FROM public.approval_bodies WHERE name = 'Dr. Bhimrao Ambedkar Law University, Jaipur' LIMIT 1),
  '2023-07-26', '2023-2024', 'nimt-technical-and-professional-college-kotputli-jaipur', 'https://cdn.prod.website-files.com/661fb6df59dd4f6d4910cc8b/67dce712fb3a4dad25fba62d_ALU%202023-24%20Affiliation.pdf', '66620d6965615631d9962d6b'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'alu-affiliation-letter-for-session-2023-24');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'alu-affiliation-letter-for-session-2023-24' AND c.webflow_slug = 'bachelor-of-laws-llb'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter - 2024-25 - ALU', 'affiliation-for-session-2024-25',
  (SELECT id FROM public.approval_bodies WHERE name = 'Dr. Bhimrao Ambedkar Law University, Jaipur' LIMIT 1),
  '2024-07-18', '2024-2025', 'nimt-technical-and-professional-college-kotputli-jaipur', 'https://cdn.prod.website-files.com/661fb6df59dd4f6d4910cc8b/669900fa1fe091dc86c6c07d_ALU2024-25.pdf', '66990134ccd988b4d56ebcee'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-for-session-2024-25');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-for-session-2024-25' AND c.webflow_slug = 'bachelor-of-laws-llb'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter BTE -NIMT GRN - 2022-23', 'bte-affiliation-2022-2023',
  (SELECT id FROM public.approval_bodies WHERE name = 'Pharmacy Council of India' LIMIT 1),
  '2022-12-15', '2022 - 2023', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/64045d4ee0dbafdddb3eb2f0_Screenshot%202023-03-05%20at%202.43.20%20PM.png', '66620d6bfe1cf23a9925c785'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bte-affiliation-2022-2023');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bte-affiliation-2022-2023' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter fo BA, B.Sc, B.Com', 'affiliation-letter-fo-ba-b-sc-b-com',
  (SELECT id FROM public.approval_bodies WHERE name = 'University of Rajasthan' LIMIT 1),
  '2020-03-14', '2017-2018', 'nimt-technical-and-professional-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f74484a7f7b0c418e48934a_Affiliation%202017-18%20BA%20BSc%20BCom.pdf', '66620d671834f426c4d0799a'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-fo-ba-b-sc-b-com');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-fo-ba-b-sc-b-com' AND c.webflow_slug = 'bachelor-of-arts'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-fo-ba-b-sc-b-com' AND c.webflow_slug = 'bachelor-of-commerce'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-fo-ba-b-sc-b-com' AND c.webflow_slug = 'bachelor-of-science'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter for B.Ed for 2014-15', 'affiliation-letter-for-b-ed-for-2014-15',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2014-05-10', '2014 - 2015', 'nimt-institute-of-education-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e76638a351b76ab56f966af_NIMT%2BInst%2Bof%2BEducation%2BAffiliation%2BCCSU%2B2014-15.pdf', '66620d6753ecc6f76c569040'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-for-b-ed-for-2014-15');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-for-b-ed-for-2014-15' AND c.webflow_slug = 'bachelor-of-education-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter for B.Ed for 2016-18', 'affiliation-letter-for-b-ed-for-2016-18',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2016-05-10', '2016 - 2018', 'nimt-institute-of-education-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7663eb4c71bde23241cd4a_Affiliation-Letter-BEd-2016-18-NIMT-Institute-of-Education.jpg', '66620d686ebf60d3faa3dbeb'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-for-b-ed-for-2016-18');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-for-b-ed-for-2016-18' AND c.webflow_slug = 'bachelor-of-education-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter for B.Sc Nursing for Year 2016-17', 'affiliation-letter-for-b-sc-nursing-for-year-2016-17',
  (SELECT id FROM public.approval_bodies WHERE name = 'King George Medical University' LIMIT 1),
  '2017-05-24', '2016 - 2017', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e693503c6177d6db3a75f89_KGMU%20Affiliation%20Letter%202016-17.pdf', '66620d6745b0b68abb5a0059'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-for-b-sc-nursing-for-year-2016-17');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-for-b-sc-nursing-for-year-2016-17' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter for D.Pharma for Year 2019-2020', 'affiliation-letter-for-d-pharma-for-year-2019-2020',
  (SELECT id FROM public.approval_bodies WHERE name = 'Board of Technical Education, Uttar Pradesh' LIMIT 1),
  '2019-05-15', '2019-2020', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5fe0c380e88230d0b3f7936a_BTE-DPharma-201920.pdf', '66620d676e3d2b918ccb515c'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-for-d-pharma-for-year-2019-2020');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-for-d-pharma-for-year-2019-2020' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter for MBA for 2021-22 -AKTU Lucknow', 'affiliation-letter-for-mba-for-2021-22-aktu-lucknow',
  (SELECT id FROM public.approval_bodies WHERE name = 'Dr. A.P.J. Abdul Kalam Technical University, Lucknow' LIMIT 1),
  '2021-08-31', '2021-2022', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/618a91dbbe8c8b3cdd374a36_AKTU%20Affiliation%20-%20MBA%20-%20NIMT-2021-22.pdf', '66620d68f9f978917c6abeec'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-for-mba-for-2021-22-aktu-lucknow');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-for-mba-for-2021-22-aktu-lucknow' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter of BA LLB for 2012-13, 2013-14, 2014-15, 2015-16 & 2016-17', 'affiliation-letter-of-ba-llb-for-2012-13-2013-14-2014-15-2015-16-2016-17',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2013-01-31', '2012 - 2017', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7661f69105fa593adf0027_CCSU-BALLB-Affiliation-Letter.jpg', '66620d68706da9d47550a3aa'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-of-ba-llb-for-2012-13-2013-14-2014-15-2015-16-2016-17');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-ba-llb-for-2012-13-2013-14-2014-15-2015-16-2016-17' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter of BALLB for 2017-18, 2018-19, 2019-20, 2020-21, 2021-2022', 'affiliation-letter-of-ballb-for-2017-18-2018-19-2019-20-2020-21-2021-2022',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2017-07-04', '2017 - 2022', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e76625c5127a1492534e62d_CCS%20Affiliation%20Letter%202017%20-2022%20NIMT%20Vidhi%20Evam%20Kanun%20Sansthan%20Law.jpg', '66620d68a0b26944b476b421'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-of-ballb-for-2017-18-2018-19-2019-20-2020-21-2021-2022');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-ballb-for-2017-18-2018-19-2019-20-2020-21-2021-2022' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter of BPT, BSc Radiology & Imaging Technology for Year 2011-12', 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2011-12',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2012-09-20', '2011 - 2012', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7660554c71bd039c41c3c6_2011-12-letter.jpeg', '66620d686127616bdc1bb82d'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2011-12');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2011-12' AND c.webflow_slug = 'b-sc-in-radiology-and-imaging-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2011-12' AND c.webflow_slug = 'bachelor-of-physiotherapy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter of BPT, BSc Radiology & Imaging Technology for Year 2012-13,2013-14,2014-15 and 2015-16', 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2012-13-2013-14-2014-15-and-2015-16',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2016-10-27', '2012- 2016', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e692a09df0bf431ab5d41ae_Affilation-letter-BRDIT-and-BPT-1.jpg', '66620d6859c35dbb4a3a680f'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2012-13-2013-14-2014-15-and-2015-16');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2012-13-2013-14-2014-15-and-2015-16' AND c.webflow_slug = 'b-sc-in-radiology-and-imaging-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2012-13-2013-14-2014-15-and-2015-16' AND c.webflow_slug = 'bachelor-of-physiotherapy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter of BPT, BSc Radiology & Imaging Technology for Year 2017 Onwards', 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2017-onwards',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2017-09-04', '2017 Onwards', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e67fa89fac97dedac52b72e_Affiliation%20Letter%20CCSU%20BPT%20BRDIT%202017%20Onwards.jpg', '66620d69f32223093edf46c0'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2017-onwards');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2017-onwards' AND c.webflow_slug = 'b-sc-in-radiology-and-imaging-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-bpt-bsc-radiology-imaging-technology-for-year-2017-onwards' AND c.webflow_slug = 'bachelor-of-physiotherapy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter of BSc Biotechnology for 2014-15,2015-16 & 2016-17', 'affiliation-letter-of-bsc-biotechnology-for-2014-15-2015-16-2016-17',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2014-09-10', '2014 - 2017', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7660df351b76bca7f95d25_biotech.pdf', '66620d6853ecc6f76c5690d3'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-of-bsc-biotechnology-for-2014-15-2015-16-2016-17');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-bsc-biotechnology-for-2014-15-2015-16-2016-17' AND c.webflow_slug = 'bachelor-of-science-in-biotechnology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation Letter of BSc Biotechnology for 2017-18,2018-19 & 2019-20', 'affiliation-letter-of-bsc-biotechnology-for-2017-18-2018-19-2019-20',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2017-11-06', '2017 - 2020', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7661679105fa5869defc57_BSC%20Biotechnology%20Affiliation%20Letter%202017-18%20NIMT%20INSTITUTE%20OF%20MEDICAL%20AND%20PARAMEDICAL%20SCIENCES.jpg', '66620d6885576f69b1026f5b'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-letter-of-bsc-biotechnology-for-2017-18-2018-19-2019-20');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-letter-of-bsc-biotechnology-for-2017-18-2018-19-2019-20' AND c.webflow_slug = 'bachelor-of-science-in-biotechnology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation for 2024-25 for B.ED', 'affiliation-for-2024-25-for-b-ed',
  (SELECT id FROM public.approval_bodies WHERE name = 'University of Rajasthan' LIMIT 1),
  '2024-05-20', '2024-2025', 'nimt-mahila-b-ed-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/661fb6df59dd4f6d4910cc8b/669907cd39611811474b69f2_UOR%20Affiliation%202024-25%20NIMT%20Mahila%20BEd%20College%20(1).pdf', '6699083fa487a16cf5a8565d'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-for-2024-25-for-b-ed');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-for-2024-25-for-b-ed' AND c.webflow_slug = 'bachelor-of-education-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Affiliation for B.Ed for session 2020-21', 'affiliation-for-b-ed-for-session-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'University of Rajasthan' LIMIT 1),
  '2020-09-14', '2020-2021', 'nimt-mahila-b-ed-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f744751556750774006d1d9_UOR-List-B.Ed.pdf', '66620d67741e217191e1398e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'affiliation-for-b-ed-for-session-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'affiliation-for-b-ed-for-session-2020-21' AND c.webflow_slug = 'bachelor-of-education-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Approval Letter for 2024-25 for BSc Nursing - Indian Nursing Council', 'approval-letter-for-2024-25-for-bsc-nursing---indian-nursing-council',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2024-03-01', '2024-2025', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/661fb6df59dd4f6d4910cc8b/667cfc3ce947345480156e12_INC%20Approval%20BSc%20Nursing.pdf', '667cfc87c51329c61d825be6'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-letter-for-2024-25-for-bsc-nursing---indian-nursing-council');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-letter-for-2024-25-for-bsc-nursing---indian-nursing-council' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Approval Letter for 2024-25 for BSc Nursing - Indian Nursing Council', 'approval-letter-for-2024-25-for-bsc-nursing---indian-nursing-council-2',
  (SELECT id FROM public.approval_bodies WHERE name = 'Uttar Pradesh State Medical Faculty' LIMIT 1),
  '2024-03-01', '2024-2025', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/661fb6df59dd4f6d4910cc8b/667cfcb728f2df2d221d92d4_GNM%20Indian%20Nursing%20Council.pdf', '667cfcc775a4bc9f8af75ff3'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-letter-for-2024-25-for-bsc-nursing---indian-nursing-council-2');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-letter-for-2024-25-for-bsc-nursing---indian-nursing-council-2' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Approval Letter for GNM - UPSMF - NIMT GRN', 'upsmf-approval-letter-for-gnm',
  (SELECT id FROM public.approval_bodies WHERE name = 'Uttar Pradesh State Medical Faculty' LIMIT 1),
  '2012-10-03', '2012-Onwards', 'nimt-hospital', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/62e1199a589d9a6b0ebb08a7_UPSMF-Approval-Letter-for-GNM.pdf', '66620d774624987a3c47c6fc'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'upsmf-approval-letter-for-gnm');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'upsmf-approval-letter-for-gnm' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Approval Letter for PGDBM 1996-1997', 'approval-letter-for-pgdbm-1996-1997',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '1996-03-19', '1996-1997', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e79c37463cc8b6b0e54f1d2_Letter%201996-97.jpeg', '66620d69e378b0a34a956b77'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-letter-for-pgdbm-1996-1997');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-letter-for-pgdbm-1996-1997' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Approval for B.Sc Nursing for the year 2020-21', 'approval-for-b-sc-nursing-for-the-year-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2020-10-23', '2020-2021', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f997903aac04960ddc3300b_BSC_231020_21.pdf', '66620d70178e3fdb26c8ae16'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-for-b-sc-nursing-for-the-year-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-for-b-sc-nursing-for-the-year-2020-21' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Approval for GNM for the year 2020-21', 'approval-for-gnm-for-the-year-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2020-10-23', '2020-2021', 'nimt-hospital', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f997a1c245772436f65f6a3_GNM_231020_21.pdf', '66620d6928f93a3798618750'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-for-gnm-for-the-year-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-for-gnm-for-the-year-2020-21' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2013 - 15 GN', 'bci-2013-15-gn',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2013-09-02', '2013 - 2014 & 2014 - 2015', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e4e5f0348207ad90c6f21_LOA%20Bar%20Council%20of%20India%202013-15.pdf', '66620d6a0c27fd572daf68ac'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2013-15-gn');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2013-15-gn' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2015 - 16 GN', 'bci-2015-16-gn',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2015-06-11', '2015 - 2016', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e4df944a855775efb901f_2015-16%20NIMT%20BCI.pdf', '66620d6a711b4fe9e508256e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2015-16-gn');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2015-16-gn' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2016 - 17 GN', 'bci-2016-17-gn',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2016-06-09', '2016 - 2017', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e4c35522c856bdf72d3e2_BCI%20558%202016-17%20NIIMT%20Law%20College.pdf', '66620d6a59c35dbb4a3a69e2'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2016-17-gn');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2016-17-gn' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2017 - 18 GN', 'bci-2017-18-gn',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2017-07-25', '2017 - 2018', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e4d3b9293f2fceceda286_BCI%201225%202017%20NIMT%20Vidhi%20Avam%20Kanno%20Sansthan%2C%20G.%20Noida.pdf', '66620d6aee55c3502f2fd5ae'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2017-18-gn');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2017-18-gn' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2018 - 19 GN', 'bci-2018-19-gn',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2018-06-16', '2018 - 2019', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e4a973ed3cbb799bfe505_BCID6552018%20Extension%20of%20Provisional%20temporary%20approval%20of%20affiliation%20to%20following%20law%20colleges%20for%20the%20academic%20year%202018-19%20CCS.pdf', '66620d6b06359ceb90f74633'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2018-19-gn');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2018-19-gn' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2018 - 19 KTP', 'bci-2018-19-ktp',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2017-08-25', '2018 - 2019', 'nimt-technical-and-professional-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e49c34aec9300339d962c_030%20NIMT%20Technical%20and%20Professional%20College%2C%20Jaipur%2C%20Rajasthan.pdf', '66620d6ad90c8741867af36e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2018-19-ktp');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2018-19-ktp' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-kotputli'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2018-19-ktp' AND c.webflow_slug = 'bachelor-of-laws-llb'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2019 - 20 GN', 'bci-2019-20-gn',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2019-07-06', '2019 - 2020', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e47d65cdee6707253743b_bcid5082019%20Extension%20of%20provisional%20temporary%20approval%20of%20affiliation%20to%20following%20law%20colleges%20for%20the%20academic%20year%202019-20.pdf', '66620d6b5eea7fa5e4326922'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2019-20-gn');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2019-20-gn' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2019 - 20 KTP', 'bci-2019-20-ktp',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2019-08-23', '2019 - 2020', 'nimt-technical-and-professional-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e48e6201d6a08af376069_bcid8512019%20NIMT%20technical%20and%20professional%20college%2C%20kotputli%2C%20jaipur%2C%20raj.pdf', '66620d6b6300f0c0e6487677'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2019-20-ktp');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2019-20-ktp' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-kotputli'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2019-20-ktp' AND c.webflow_slug = 'bachelor-of-laws-llb'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'BCI 2020-21 GN', 'bci-2020-21-gn',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2020-09-14', '2020-2021', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f61f3980245ff1a171a3b61_bcid5932020%20%20LE-Provisional%20Approval%20of%20Affiliation%20Letter-Various%20Colleges%20of%20U.P.pdf', '66620d6b6300f0c0e648769e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'bci-2020-21-gn');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'bci-2020-21-gn' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'CCS University Permanent Affiliation - BALLB 2017 Onwards', 'ccs-university-permanent-affiliation-ballb',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2022-09-14', '2017-Onwards', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/63230a92bdbb2cfcb3df5829_CCSU%20Permanent%20Affiliation%20Letter%20BALLB.jpeg', '66620d6b5f7e3a8322504749'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'ccs-university-permanent-affiliation-ballb');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'ccs-university-permanent-affiliation-ballb' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'CCSU - BBA - BCA Affiliation Letter 2024-2027.pdf', 'ccsu---bba---bca-affiliation-letter-2024-2027-pdf',
  (SELECT id FROM public.approval_bodies WHERE name = 'Chaudhary Charan Singh University' LIMIT 1),
  '2024-07-03', '2024-2025, 2025-2026 and 2026-2026', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/661fb6df59dd4f6d4910cc8b/6698fe91b10c95abef7da271_CCSU%20-%20BBA%20-%20BCA%20Affiliation%20Letter%202024-2027.pdf', '6698feeaebbf45cb254ec899'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'ccsu---bba---bca-affiliation-letter-2024-2027-pdf');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'ccsu---bba---bca-affiliation-letter-2024-2027-pdf' AND c.webflow_slug = 'bachelor-of-business-administration-bba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'ccsu---bba---bca-affiliation-letter-2024-2027-pdf' AND c.webflow_slug = 'bachelor-of-computer-applications-bca'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Consent Letter for B.Sc Nursing 2020-21', 'consent-letter-for-b-sc-nursing-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'Atal Bihari Vajpayee Medical University, Lucknow' LIMIT 1),
  '2021-02-19', '2020-2021', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/6030cbc03d70b869060b807a_434N-079_19022021214303.PDF', '66620d6b59c35dbb4a3a6aad'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'consent-letter-for-b-sc-nursing-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'consent-letter-for-b-sc-nursing-2020-21' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'EOA for 2024-25 - NIMT Greater Noida', 'eoa-for-2024-25---nimt-greater-noida',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  NULL, '2024-2024', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/661fb6df59dd4f6d4910cc8b/669901c06326f191c08c6f76_EOA%20REPORT-2024-2025-NIMT%20GREATER%20NOIDA%20(3).PDF', '669906022dcfa2714cd91d60'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'eoa-for-2024-25---nimt-greater-noida');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'eoa-for-2024-25---nimt-greater-noida' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'EOA for 2024-25 NIMT Institute of Hospital and Pharma Management', 'eoa-2024-25-nimt-institute-of-hospital-and-pharma-management',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2024-03-23', '2024-2025', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/661fb6df59dd4f6d4910cc8b/66990609d383f61f94f0add1_EOA%20REPORT-2024-2025-NIMT%20INSTITUTE%20OF%20HOSPITAL%20AND%20PHARMA%20MANAGEMENT%20(2).PDF', '6699071dbd102f217e57cde2'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'eoa-2024-25-nimt-institute-of-hospital-and-pharma-management');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'eoa-2024-25-nimt-institute-of-hospital-and-pharma-management' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'EOA for NIMT Institute of Management', 'eoa-for-nimt-institute-of-management',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2024-03-23', '2024-2025', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/661fb6df59dd4f6d4910cc8b/6699077086b8fa9393f1b32c_EOA%20Report%202024-25-NIMT%20INSTITUTE%20OF%20MANAGEMENT.pdf', '66990776e02dc75163618714'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'eoa-for-nimt-institute-of-management');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'eoa-for-nimt-institute-of-management' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extenison of Approval for Session 2024-25', 'extenison-of-approval-for-session-2024-25',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2024-07-16', '2024-2025', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/661fb6df59dd4f6d4910cc8b/66990022f9f59fbf1683f37d_bci2024_25-compressed.pdf', '66990044fcdcebc9e104a3e9'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extenison-of-approval-for-session-2024-25');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extenison-of-approval-for-session-2024-25' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Affiliation - NIMT B School Ghaziabad - 2014-2019', 'extension-of-affiliation-from-year-2014-2019-nimt-b-school-ghaziabad',
  (SELECT id FROM public.approval_bodies WHERE name = '' LIMIT 1),
  '2015-08-14', '2014-2019', 'nimt-school', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01d7e144b49e2d0f6d9b12_CBSE%20Letter%20EOA%20with%20Bye%20laws%20%2018-02-2016.pdf', '66620d6ccf21faf3c16fb9fe'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-affiliation-from-year-2014-2019-nimt-b-school-ghaziabad');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-affiliation-from-year-2014-2019-nimt-b-school-ghaziabad' AND c.webflow_slug = 'schooling-nur-10-cbse-affiliated'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Affiliation - NIMT B School Ghaziabad - 2019-2021', 'extension-of-affiliation',
  (SELECT id FROM public.approval_bodies WHERE name = '' LIMIT 1),
  '2020-03-18', '2019-2021', 'nimt-school', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5ed797e3988ff3500679b307_EX%20status%20upto%2031-03-2021.pdf', '66620d6b4761dd6c6acb1da2'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-affiliation');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-affiliation' AND c.webflow_slug = 'schooling-nur-10-cbse-affiliated'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Affiliation 2022-2023 - MBA - AKTU - NIMT GRN', 'extension-of-affiliation-for-session-2022-2023',
  (SELECT id FROM public.approval_bodies WHERE name = 'Dr. A.P.J. Abdul Kalam Technical University, Lucknow' LIMIT 1),
  '2022-09-23', '2022-2023', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/63bffbb9a55c34036dd9cc79_MBA_AKTU_AFFILIATION_2022_2023%20(1).pdf', '66620d6c6e3d2b918ccb56f0'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-affiliation-for-session-2022-2023');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-affiliation-for-session-2022-2023' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Affiliation 2023-2024 - MBA - AKTU - NIMT GRN', 'extension-of-affiliation-of-aktu-lucknow',
  (SELECT id FROM public.approval_bodies WHERE name = 'Dr. A.P.J. Abdul Kalam Technical University, Lucknow' LIMIT 1),
  '2023-09-15', '2023-2024', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/6512b198d27506a6fcd32eb7_238(Digitally%20Signed).pdf', '66620d6c685d1955e7a0a5bc'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-affiliation-of-aktu-lucknow');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-affiliation-of-aktu-lucknow' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Affiliation D Pharma', 'extension-of-affiliation-d-pharma',
  (SELECT id FROM public.approval_bodies WHERE name = 'Board of Technical Education, Uttar Pradesh' LIMIT 1),
  '2021-08-09', '2021 - 2022', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/61139200e581f857dd6cf375_Screenshot%202021-08-11%20at%202.31.39%20PM.png', '66620d6c169fd5c05e765093'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-affiliation-d-pharma');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-affiliation-d-pharma' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Affiliation for LLB and BALLB 2019-2020', 'extension-of-affiliation-for-llb-and-ballb-2019-2020',
  (SELECT id FROM public.approval_bodies WHERE name = 'University of Rajasthan' LIMIT 1),
  '2019-04-30', '2019-2020', 'nimt-technical-and-professional-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/60f299a62184401f1f6440b7_of25556-30apr19.pdf', '66620d6cc07b415cc1b4dce0'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-affiliation-for-llb-and-ballb-2019-2020');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-affiliation-for-llb-and-ballb-2019-2020' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-kotputli'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-affiliation-for-llb-and-ballb-2019-2020' AND c.webflow_slug = 'bachelor-of-laws-llb'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Apporval of AICTE - 2022-2023 - NIMT Greater Noida', 'extension-of-apporval-2022-2023-nimt-greater-noida',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2022-06-02', '2022-2023', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/62e139514aea861d6791650b_EOA-NIMT%20GREATER%20NOIDA-2022-2023.pdf', '66620d6d106d5cc2f9aec919'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-apporval-2022-2023-nimt-greater-noida');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-apporval-2022-2023-nimt-greater-noida' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval - 2020-2021 and 2021-2022 - Bar Council of India - NIMT Kotptutli', 'extension-of-approval-of-bar-council-of-india-for-nimt-college-of-law-kotputli',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2021-10-30', '2020-2022', 'nimt-technical-and-professional-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/618a922d6635d95ecbba7d90_bcid14792021%20NIMT%20Technical%20and%20Professional%20College%2C%20Kotputli%2C%20Jaipur%2C%20Raj_0001.pdf', '66620d747f25c06a9c3a0fbb'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-of-bar-council-of-india-for-nimt-college-of-law-kotputli');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-of-bar-council-of-india-for-nimt-college-of-law-kotputli' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-kotputli'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-of-bar-council-of-india-for-nimt-college-of-law-kotputli' AND c.webflow_slug = 'bachelor-of-laws-llb'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval - 2020-21 - MBA - NIMT Institute of Hospital and Pharma Management', 'extension-of-approval-2020-21-mba-nimt-institute-of-hospital-and-pharma-management',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2020-04-30', '2020-2021', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5fd4c3e1fd9311a1c81789a8_EOA_Report_2020-21%20NIMT%20HOSPITAL%20AND%20PHARMA%20MGMT.PDF', '66620d70178e3fdb26c8ae2e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-2020-21-mba-nimt-institute-of-hospital-and-pharma-management');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-2020-21-mba-nimt-institute-of-hospital-and-pharma-management' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval - 2021-2022 - Bar Council of India - NIMT GRN', 'extension-of-approval-of-bci-for-nimt-vidhi-evam-kanun-sansthan',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2021-10-25', '2021-2022', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/628bb03804881801e46303f7_bcid14382021%20NIMT%20Vidhi%20Avam%20Kanoon%20Sansthan%2C%20G.Noida%2C%20U.P.pdf', '66620d734b86b22714bb0c01'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-of-bci-for-nimt-vidhi-evam-kanun-sansthan');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-of-bci-for-nimt-vidhi-evam-kanun-sansthan' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval - 2022-2023 - Bar Council of India - NIMT GRN', 'extension-of-approval-2022-2023-bar-council-of-india',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2022-09-29', '2022-2023', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/64fd758d0f751d39c8e7d54d_bcid14402022%20NIMT%20Vidhi%20Avam%20Kanoon%20Sansthan%2C%20Greater%20Noida%2C%20U.P_0001.pdf', '66620d6df2a82757f38f94e0'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-2022-2023-bar-council-of-india');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-2022-2023-bar-council-of-india' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval - 2022-2023 and 2023-2024 - Bar Council of India - NIMT Kotptutli', 'extension-of-approval---2022-2023-and-2023-2024---bar-council-of-india---nimt-kotptutli',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2022-11-03', '2022-2023 and 2023-2024', 'nimt-technical-and-professional-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/65cce0b431ec951f0205128e_bcid17032023%20NIMT%20Technical%20and%20Professional%20COllege%2C%20Jaipur%2C%20Raj_0001%20(3).pdf', '66620d6dc07b415cc1b4dd25'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval---2022-2023-and-2023-2024---bar-council-of-india---nimt-kotptutli');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval---2022-2023-and-2023-2024---bar-council-of-india---nimt-kotptutli' AND c.webflow_slug = 'bachelor-of-laws-llb'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval - 2023-2024 - Bar Council of India - NIMT GRN', 'extension-of-approval---2023-2024---bar-council-of-india---nimt-grn',
  (SELECT id FROM public.approval_bodies WHERE name = 'Bar Council of India' LIMIT 1),
  '2023-09-16', '2023-2024', 'nimt-vidhi-evam-kanun-sansthan-nimt-institute-of-method-law-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/65cce1f9d2e1fa50025ccb1c_bcid14002023%20NIMT%20Vidhi%20Avam%20Kanoon%20Sansthan%2C%20Greater%20Noida%2C%20U.P_0001%20(1).pdf', '66620d6d4d4aba8d70f37730'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval---2023-2024---bar-council-of-india---nimt-grn');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval---2023-2024---bar-council-of-india---nimt-grn' AND c.webflow_slug = 'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval - 2023-24 AICTE NIMT Greater Noida', 'extension-of-approval-2023-24-nimt-greater-noida',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2023-05-15', '2023-2024', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/6471af5343da89b8c5f3d633_EOA-Report-2023-24.PDF', '66620d6de14a5bd85f1af48e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-2023-24-nimt-greater-noida');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-2023-24-nimt-greater-noida' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval - PGDM - NIMT Greater Noida', 'extension-of-approval-pgdm-nimt-greater-noida',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2009-08-20', '2009-2010', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/60c4ac683c40c4fa624b1528_EOA_2009-10_NIMT_Greater_Noida.PDF', '66620d74d53e26596665568c'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-pgdm-nimt-greater-noida');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-pgdm-nimt-greater-noida' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval 2022-23 PCI NIMT GRN', 'pharmacy-council-of-india-approval-letter-2022-2023',
  (SELECT id FROM public.approval_bodies WHERE name = 'Pharmacy Council of India' LIMIT 1),
  '2023-01-31', '2022 - 2023', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/640457004b57267fe58a1b3c_Decision%20Letter%20(1).pdf', '66620d77480b9fa10838b2dd'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'pharmacy-council-of-india-approval-letter-2022-2023');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'pharmacy-council-of-india-approval-letter-2022-2023' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval 2023-24 AICTE NIMT Institute of Hospital and Pharma Management Gr Noida', 'extension-of-approval-2023-24-nimt-institute-of-hospital-and-pharma-management-gr-noida',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2023-05-15', '2023-2024', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/6472d8821df6d044852352a1_EOA-Report-2023-24.PDF', '66620d6d0016cfde0c99d07b'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-2023-24-nimt-institute-of-hospital-and-pharma-management-gr-noida');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-2023-24-nimt-institute-of-hospital-and-pharma-management-gr-noida' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval 2023-24 AICTE NIMT Institute of Management', 'extension-of-approval-2023-24-nimt-institute-of-management',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2023-05-15', '2023-2024', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/6472d8f8bd1a3e1ac4bf5c6f_EOA-Report-2023-24%20-%20NIMT%20Institute%20of%20Management.PDF', '66620d6db5c722fb3fe5eb0d'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-2023-24-nimt-institute-of-management');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-2023-24-nimt-institute-of-management' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval 2023-24 PCI NIMT GRN', 'extension-of-approval-2023-24-pci',
  (SELECT id FROM public.approval_bodies WHERE name = 'Pharmacy Council of India' LIMIT 1),
  '2023-05-16', '2023-2024', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/64b512fea1098e1c1e57a9d5_Decision%20Letter%20(1).pdf', '66620d6d6cd882aba1f5c1ed'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-2023-24-pci');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-2023-24-pci' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval D.Pharma', 'extension-of-approval-d-pharma',
  (SELECT id FROM public.approval_bodies WHERE name = 'Pharmacy Council of India' LIMIT 1),
  '2021-08-16', '2021 - 2022', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/611bab6c761e0a138bbbe5e3_Decision%20Letter%20for%20Academic%20Session(2021-2022).pdf', '66620d6e15ec54f7e0147c6f'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-d-pharma');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-d-pharma' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for MBA for year 2011-12', 'extension-of-approval-letter-for-mba-for-year-2011-12',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2011-09-01', '2011-2012', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01f8fadc9b2d707b568033_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20HOSPITAL%20AND%20PHARMA%20%20%20MANAGEMENT%202011-12.pdf', '66620d6e847f48273a21585b'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-mba-for-year-2011-12');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-mba-for-year-2011-12' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for MBA for year 2012-2013', 'extension-of-approval-letter-for-mba-for-year-2012-2013',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2017-03-30', '2012-2013', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01f970a0b62d30be72ac6a_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20HOSPITAL%20AND%20PHARMA%20%20%20MANAGEMENT%202012-13.PDF', '66620d6e59c35dbb4a3a6be6'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-mba-for-year-2012-2013');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-mba-for-year-2012-2013' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for MBA for year 2013-2014', 'extension-of-approval-letter-for-mba-for-year-2013-2014',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2013-03-19', '2013-2014', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01f9bfa0b62df79772acee_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20HOSPITAL%20AND%20PHARMA%20%20%20MANAGEMENT%202013-14.PDF', '66620d6f85576f69b1027315'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-mba-for-year-2013-2014');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-mba-for-year-2013-2014' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for MBA for year 2017-2018', 'extension-of-approval-letter-for-mba-for-year-2017-2018',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2017-03-30', '2017-2018', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01f9f5549ac2daf7f2c1f4_EOA%20Report%202017-18%20NIMT%20Institute%20of%20Hospital%20and%20Pharma%20Management.PDF', '66620d6f7fc885d5f8bde8da'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-mba-for-year-2017-2018');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-mba-for-year-2017-2018' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDBA 1997-1998', 'approval-letter-for-pgdba',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '1997-12-31', '1997-1998', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e79d282c3821a4b6433dbf5_Approval%20Letter%20PGDBM%201997-98.pdf', '66620d698e748b1e66079f2e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-letter-for-pgdba');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-letter-for-pgdba' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDBM 1999-2000', 'approval-letter-pgdbm-1999-2000',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '1999-09-08', '1999-2000', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a15722077c0eaf4e3b563_Approval%20Letter%20PGDBM%201999-2000%20(1).pdf', '66620d6a706da9d47550a49a'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-letter-pgdbm-1999-2000');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-letter-pgdbm-1999-2000' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM 2011-2012', 'extension-of-approval-letter-for-pgdm-2011-2012',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2011-09-01', '2011-2012', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01c2e0dc9b2d59ea563232_EOA%20Report%20NIMT%20GREATER%20NOIDA%202011-12.PDF', '66620d6fe14a5bd85f1af5c2'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-2011-2012');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-2011-2012' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM 2013-2014', 'extension-of-approval-letter-for-pgdm-2013-2014',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2013-03-19', '2013-2014', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01c30f3319a3e0804283f9_EOA%20Report%20NIMT%20GREATER%20NOIDA%202013-14.PDF', '66620d6f5eea7fa5e4326b2d'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-2013-2014');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-2013-2014' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM 2014-2015', 'extension-of-approval-letter-for-pgdm-2014-2015',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2014-03-11', '2014-2015', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01c37e338e05b95c44f620_EOA%20Report%20NIMT%20GREATER%20NOIDA%202014-15.PDF', '66620d732a8fc4d7ee57aeed'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-2014-2015');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-2014-2015' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM 2016-2017', 'extension-of-approval-letter-for-pgdm-2016-2017',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2016-04-05', '2016-2017', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01c3d8fb8e0c1b37d71b9f_EOA%20Report%202016-17%20NIMT%20GREATER%20NOIDA.PDF', '66620d700797210dc940d6e2'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-2016-2017');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-2016-2017' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM 2017-2018', 'extension-of-approval-letter-for-pgdm-2017-2018',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2017-03-30', '2017-2018', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01c4267bc6f839b6499e03_EOA_Report_2017-18%20NIMT%20Greater%20Noida.PDF', '66620d700c27fd572daf6bfc'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-2017-2018');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-2017-2018' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM 2019-2020', 'extension-of-approval-letter-for-pgdm-2019-2020',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2019-04-10', '2019-2020', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01c4818ca3ac6f48622df9_EOA_Report%20Nimt%20Greater%20Noida.PDF', '66620d706e3d2b918ccb5906'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-2019-2020');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-2019-2020' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for 2012-2013', 'extension-of-approval-letter-for-pgdm-for-2012-2013',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2012-07-05', '2012-2013', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a2d505d76bfc56195f00b_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20MANAGEMENT%202012-13.PDF', '66620d700fc4eeae3e974ee6'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-2012-2013');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-2012-2013' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for 2013-2014', 'extension-of-approval-letter-for-pgdm-for-2013-2014',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2013-03-19', '2013-2014', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a2db4fcda28a13928cbb5_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20MANAGEMENT%202013-14.PDF', '66620d71e14a5bd85f1af655'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-2013-2014');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-2013-2014' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for 2014-2015', 'extension-of-approval-letter-for-pgdm-for-2014-2015',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2014-03-11', '2014-2015', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a2e0d21fcad2315a49652_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20MANAGEMENT%202014-15.PDF', '66620d71bd0b370625b76979'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-2014-2015');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-2014-2015' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for 2015-2016', 'extension-of-approval-letter-for-pgdm-for-2015-2016',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2015-04-07', '2015-2016', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a2e60c5b45820689329c5_EOA%20Report%202015-16%20NImt%20institute%20of%20management.pdf', '66620d71ce2ccaa9a2751eef'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-2015-2016');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-2015-2016' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for 2017-2018', 'extension-of-approval-letter-for-pgdm-for-2017-18',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2017-03-30', '2017-18', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a2eadc94930a2f13477ee_EOA_Report_2017-18%20NIMT%20Institute%20of%20Management.PDF', '66620d71480b9fa10838af06'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-2017-18');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-2017-18' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for 2019-2020', 'extension-of-approval-letter-for-pgdm-for-2019-2020',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2019-04-10', '2019-2020', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01abb2adc66dcb7b871c80_EOA_Report%202019-20%20Nimt%20Institute%20of%20Education.PDF', '66620d7145b0b68abb5a0588'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-2019-2020');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-2019-2020' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for Revised Intake for 2008-2009', 'approval-letter-for-pgdm-for-revised-intake-for-2008-2009',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2007-10-12', '2008-2009', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a1654fcda287f2e2853d5_October%202007.jpeg', '66620d6a4b86b22714bb058e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-letter-for-pgdm-for-revised-intake-for-2008-2009');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-letter-for-pgdm-for-revised-intake-for-2008-2009' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 1996-1997', 'extension-of-approval-letter-for-pgdm-1996-1997',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '1996-03-30', '1996-1997', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e79c37463cc8b6b0e54f1d2_Letter%201996-97.jpeg', '66620d6fd90c8741867af7a6'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-1996-1997');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-1996-1997' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 1997-1998', 'extension-of-approval-letter-for-pgdm-for-year-1997-1998',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '1997-12-31', '1997-1998', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e79d282c3821a4b6433dbf5_Approval%20Letter%20PGDBM%201997-98.pdf', '66620d71e14a5bd85f1af6c4'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-1997-1998');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-1997-1998' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 1998-1999', 'approval-letter-for-pgdm',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '1998-01-14', '1998-1999', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e79fc8581a6e6f4e5911696_Approval%20Letter%20PGDM%201998-99%20(1).pdf', '66620d69e3309b2a7db896a9'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-letter-for-pgdm');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-letter-for-pgdm' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 1999-2000', 'extension-of-approval-letter-for-pgdm-for-year-1999-2000',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '1999-09-08', '1999-2000', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a15722077c0eaf4e3b563_Approval%20Letter%20PGDBM%201999-2000%20(1).pdf', '66620d71c07b415cc1b4ded0'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-1999-2000');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-1999-2000' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2004-2005', 'extension-of-approval-letter-for-pgdm-for-year-2004-2005',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2004-05-14', '2004-2005', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a1b012077c0f8c5e3cf26_AICTE%20EOA%202004-5%20NIMT%20INSTITUTE%20OF%20TECH%20AND%20MGMT%20GHAZIABAD.pdf', '66620d72f367d8727262e8e7'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2004-2005');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2004-2005' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2008-2009', 'approval-pgdm-2008-2009',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2007-10-12', '2008-2009', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a1654fcda287f2e2853d5_October%202007.jpeg', '66620d6a6127616bdc1bb9b1'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-pgdm-2008-2009');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-pgdm-2008-2009' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2011-2012', 'extension-of-approval-letter-for-pgdm-for-year-2011-2012',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2011-09-01', '2011-2012', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a17f7bfa8646419b7dd32_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20TECHNOLOGY%20AND%20%20%20MANAGEMENT%202011-12.PDF', '66620d727fc885d5f8bdeab7'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2011-2012');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2011-2012' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2012-2013', 'extension-of-approval-letter-for-pgdm-for-year-2012-2013',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2012-07-05', '2012-2013', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a185f1de2790a96d1657f_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20TECHNOLOGY%20AND%20%20%20MANAGEMENT%202012-13.PDF', '66620d724761dd6c6acb2168'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2012-2013');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2012-2013' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2013-2014', 'extension-of-approval-letter-for-pgdm-for-year-2013-2014',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2013-04-07', '2013-2014', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a18ecc5b45804b49296e1_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20TECHNOLOGY%20AND%20%20%20MANAGEMENT%202013-14.PDF', '66620d729e5fe3bc58c2cc83'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2013-2014');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2013-2014' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2014-2015', 'extension-of-approval-letter-for-pgdm-for-year-2014-2015',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2014-03-11', '2014-2015', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a194e2077c0babbe3c72f_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20TECHNOLOGY%20AND%20%20%20MANAGEMENT%202014-15.PDF', '66620d722eef4636b345b2ec'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2014-2015');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2014-2015' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2015-2016', 'extension-of-approval-letter-for-pgdm-for-year-2015-2016',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2015-04-07', '2015-2016', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a19a9dd44a72932b769ab_EOA%20Report%20NIMT%20INSTITUTE%20OF%20%20TECHNOLOGY%20AND%20%20%20MANAGEMENT%202015-16%20NIMT%20GHAZIABAD.pdf', '66620d72f7dd8937e5ca43b9'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2015-2016');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2015-2016' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2016-2017', 'extension-of-approval-letter-for-pgdm-for-year-2016-2017',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2016-04-05', '2016-2017', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a19fcc94930b494340519_EOA%20Report%202016-17%20NIMT%20GZB.PDF', '66620d724d4aba8d70f37a2a'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2016-2017');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2016-2017' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2017-2018', 'extension-of-approval-letter-for-pgdm-for-year-2017-2018',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2017-03-30', '2017-2018', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a1a58fcda283fd7286528_EOA_Report_2017-18_NIMTGZB.pdf', '66620d720797210dc940d7fa'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2017-2018');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2017-2018' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval Letter for PGDM for year 2018-2019', 'extension-of-approval-letter-for-pgdm-for-year-2018-2019',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2018-04-04', '2018-2019', 'nimt-institute-of-technology-and-management-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a1bbe15620ba673f01420_EOA%20Report_2018-19%20(1)%20NIMT%20Institute%20of%20Technology%20%26%20Management.PDF', '66620d72741e217191e13e05'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-letter-for-pgdm-for-year-2018-2019');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-letter-for-pgdm-for-year-2018-2019' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval for D.Pharma for year 2020-21', 'extension-of-approval-for-d-pharma-for-year-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2020-04-30', '2020-2021', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5fe0bd2b1c2a4bba4857a745_EOA_Report_2020-21%20(4).PDF', '66620d6e59c35dbb4a3a6b8c'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-for-d-pharma-for-year-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-for-d-pharma-for-year-2020-21' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval for PGDM for year 2020-2021', 'extension-of-approval-for-pgdm-for-year-2020-2021',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2020-06-15', '2020-2021', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5fe0be0266f2763a80ab9c57_EOA_Report_2020-21%20(1)%20(1).PDF', '66620d6e741e217191e13c30'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-for-pgdm-for-year-2020-2021');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-for-pgdm-for-year-2020-2021' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval of  AICTE  2022-2023 - NIMT Institute of Hospital and Pharma Management', 'extension-of-approval-of-aicte-2022-2023-nimt-institute-of-hospital-and-pharma-management',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2022-06-02', '2022-2023', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/62e138b22f5b9a481b0ee372_EOA%20Report%2022-23-NIMT%20INSTITUTE%20OF%20HOSPITAL%20AND%20PHARMA%20MANAGEMENT.pdf', '66620d7394f9a6db7c471345'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-of-aicte-2022-2023-nimt-institute-of-hospital-and-pharma-management');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-of-aicte-2022-2023-nimt-institute-of-hospital-and-pharma-management' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Extension of Approval of AICTE  2022-2023 - NIMT Institute of Management', 'extension-of-approval-of-aicte-2022-2023-nimt-institute-of-management',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2022-06-02', '2022-2023', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/62e1390db4bd5e21549dc05e_EOA%20Report%2022-23-NIMT%20INSTITUTE%20OF%20MANAGEMENT.pdf', '66620d73706da9d47550a899'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'extension-of-approval-of-aicte-2022-2023-nimt-institute-of-management');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'extension-of-approval-of-aicte-2022-2023-nimt-institute-of-management' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'GNM Approval Letter 2013 - 2014', 'gnm-approval-letter-2013-2014',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2013-11-26', '2013 - 2014', 'nimt-hospital', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e3267ce46013ecc3eb0a3_INC%20Approval%20Letter%202013-14.jpg', '66620d7482905d27500eb2d0'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'gnm-approval-letter-2013-2014');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'gnm-approval-letter-2013-2014' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'INC APPROVAL B.SC NURSING 2013-14', 'inc-approval-b-sc-nursing-2013-14',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2013-11-26', '2013 - 2014', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e418cce4601432d459fc1_B.Sc%20Nursing%202013-14%20(1).jpeg', '66620d74685d1955e7a0b301'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-approval-b-sc-nursing-2013-14');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-approval-b-sc-nursing-2013-14' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'INC Approval 2015- 16 & 2016-17', 'inc-approval-2015-16-2016-17',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2017-01-27', '2015 - 2016 & 2016 - 2017', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e3457522c854b57662ced_INC%20APPROVALS.pdf', '66620d74266b3128e7f1fdef'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-approval-2015-16-2016-17');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-approval-2015-16-2016-17' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'INC Approval Letter for B.Sc Nursing for the year 2020-21', 'inc-approval-letter-for-b-sc-nursing-for-the-year-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2020-10-10', '2020-2021', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f9fcfb87b0cbf30fc449e46_NIMT%20INSTITUTE%20OF%20MEDICAL%20AND%20PARAMEDICAL%20SCIENCES%20-%20INC%20-%202020-2021.PDF', '66620d740016cfde0c99d48e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-approval-letter-for-b-sc-nursing-for-the-year-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-approval-letter-for-b-sc-nursing-for-the-year-2020-21' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'INC Approval Letter for GNM for the year 2020-21', 'inc-approval-letter-for-gnm-for-the-year-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2020-10-10', '2020-2021', 'nimt-hospital', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f9fd0e2a1d7da115335002e_NIMT%20HOSPITAL%20-%20GNM.pdf', '66620d75affb6ca2586cc05f'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-approval-letter-for-gnm-for-the-year-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-approval-letter-for-gnm-for-the-year-2020-21' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'INC GNM APPROVAL LETTER 2017 - 18', 'inc-gnm-approval-letter-2017-18',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2017-11-11', '2017 - 2018', 'nimt-hospital', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5ec7b7c32d8f47ec9a0e521e_GNM%20APPROVAL%20LETTER.pdf', '66620d75d0ab70d3da9bb65b'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-gnm-approval-letter-2017-18');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-gnm-approval-letter-2017-18' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'INC Renewal of Suitability for the academic year 2019-2020', 'inc-renewal-of-suitability-for-the-academic-year-2019-2020',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2019-12-23', '2019 - 2020', 'nimt-hospital', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5ec7b9eccd87544b6e0fc08b_AppId-15598SuitablewithConditionLetter.pdf', '66620d750daf7794a70ec3e5'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-renewal-of-suitability-for-the-academic-year-2019-2020');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-renewal-of-suitability-for-the-academic-year-2019-2020' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Letter of Affiliation - NIMT B School', 'letter-of-affiliation-nimt-b-school',
  (SELECT id FROM public.approval_bodies WHERE name = '' LIMIT 1),
  '2011-09-07', '2011-2014', 'nimt-school', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01f83d549ac2716ef2bca6_CBSE%20LOA%20-%20NIMT%20B%20SCHOOL.pdf', '66620d75480b9fa10838b1e3'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'letter-of-affiliation-nimt-b-school');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-affiliation-nimt-b-school' AND c.webflow_slug = 'schooling-nur-10-cbse-affiliated'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Letter of Approval  - PGDM - NIMT Greater Noida', 'letter-of-approval-pgdm-nimt-greater-noida',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2008-05-16', '2008-2009', 'nimt-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/60c4ac343fee0051d75830be_Letter%20of%20Approval%20_AICTE_2008-9.PDF', '66620d7685576f69b10277ed'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'letter-of-approval-pgdm-nimt-greater-noida');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-approval-pgdm-nimt-greater-noida' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Letter of Approval for PGDM for 2009-2010', 'approval-letter-for-pgdm-for-2009-2010',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2009-06-04', '2009-2010', 'nimt-institute-of-management-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e7a2cc0dd44a74956b7dee2_NIMT%20Institute%20of%20Management%202009%20LOA.pdf', '66620d69bd0b370625b76660'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-letter-for-pgdm-for-2009-2010');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-letter-for-pgdm-for-2009-2010' AND c.webflow_slug = 'post-graduate-diploma-in-management-pgdm-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Letter of Approval of MBA', 'letter-of-approval-of-mba',
  (SELECT id FROM public.approval_bodies WHERE name = 'All India Council for Technical Education' LIMIT 1),
  '2006-02-06', '2006-2007', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f0204e6a0b62d128772bf56_AICTE%20LOA%20-%20NIMT%20MBA%20-%202006.pdf', '66620d757f041acb7fe0ba5c'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'letter-of-approval-of-mba');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-approval-of-mba' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Letter of Association - TISS', 'letter-of-association-tiss',
  (SELECT id FROM public.approval_bodies WHERE name = '' LIMIT 1),
  '2021-08-20', '2021-2022, 2022-2023, 2023-2024', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/614330ac4de68a56a7f1d45e_UES.pdf', '66620d75965c2281e7a7cee8'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'letter-of-association-tiss');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-association-tiss' AND c.webflow_slug = 'b-voc-in-medical-laboratory-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-association-tiss' AND c.webflow_slug = 'b-voc-in-patient-care-management-geriatric-and-palliative-care'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-association-tiss' AND c.webflow_slug = 'b-voc-in-dialysis-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-association-tiss' AND c.webflow_slug = 'b-voc-in-optometry'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-association-tiss' AND c.webflow_slug = 'post-graduate-diploma-in-emergency-medical-services'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-association-tiss' AND c.webflow_slug = 'postgraduate-diploma-in-critical-care-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Letter of Consent for 2020-21, 2021-22 and 2022-23 ABVMUP NIMT GRN', 'letter-of-consent-for-2020-21-2021-22-and-2022-23',
  (SELECT id FROM public.approval_bodies WHERE name = 'Atal Bihari Vajpayee Medical University, Lucknow' LIMIT 1),
  '2021-02-19', '2020-23', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/617051ca408571bde3b41d76_Letter%20of%20Consent%202020-2021.pdf', '66620d757f041acb7fe0bb2e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'letter-of-consent-for-2020-21-2021-22-and-2022-23');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'letter-of-consent-for-2020-21-2021-22-and-2022-23' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'MBA AFFILIATION 2017 - 18', 'mba-affiliation-2017-18',
  (SELECT id FROM public.approval_bodies WHERE name = 'Dr. A.P.J. Abdul Kalam Technical University, Lucknow' LIMIT 1),
  '2017-05-15', '2017 - 2018', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e532068b46f31616f82bd_238(Digitally%20Signed).pdf', '66620d760797210dc940d979'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'mba-affiliation-2017-18');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'mba-affiliation-2017-18' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'MBA AFFILIATION 2018 - 19', 'mba-affiliation-2018-19',
  (SELECT id FROM public.approval_bodies WHERE name = 'Dr. A.P.J. Abdul Kalam Technical University, Lucknow' LIMIT 1),
  '2018-05-15', '2018 - 2019', 'nimt-instiute-of-hospital-and-pharma-management-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e5269717f543e16216fe3_238.pdf', '66620d764d4aba8d70f37baa'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'mba-affiliation-2018-19');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'mba-affiliation-2018-19' AND c.webflow_slug = 'master-of-business-administration-mba'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'NCTE Approval for Course B.Ed 2003-04 & Onwards', 'approval-2003-04-onwards',
  (SELECT id FROM public.approval_bodies WHERE name = 'National Council for Teacher Education' LIMIT 1),
  '2004-01-05', '2003-2004 and Onwards', 'campus-school-department-of-education-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5ed7986163854faa452aafd0_NCTE%20APPROVAL%20LETTER%202003-4%20BED%20CAMPUS%20SCHOOL%20DEPT%20OF%20EDUCATION%20GHAZIABAD.pdf', '66620d695aec5700200a85ce'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'approval-2003-04-onwards');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'approval-2003-04-onwards' AND c.webflow_slug = 'bachelor-of-education-ghaziabad'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'NCTE Approval for Course B.Ed 2005-06 & Onwards', 'ncte-approval-for-course-b-ed-2005-06-onwards',
  (SELECT id FROM public.approval_bodies WHERE name = 'National Council for Teacher Education' LIMIT 1),
  '2005-07-04', '2005-2006 and Onwards', 'nimt-mahila-b-ed-college-kotputli-jaipur', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5ed7a1bd29db0fab9e869217_565.pdf', '66620d76e1f56059eeac541e'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'ncte-approval-for-course-b-ed-2005-06-onwards');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'ncte-approval-for-course-b-ed-2005-06-onwards' AND c.webflow_slug = 'bachelor-of-education-kotputli-jaipur'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'NCTE Approval for Course B.Ed 2013-14 & Onwards', 'ncte-approval-for-course-b-ed-2013-14-onwards',
  (SELECT id FROM public.approval_bodies WHERE name = 'National Council for Teacher Education' LIMIT 1),
  '2013-03-01', '2013-2014 and Onwards', 'nimt-institute-of-education-greater-noida', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5ed79b316aca69ea587bcf79_NCTE%20Approval%20NIMT%20Greater%20Noida%202013-14.pdf', '66620d76f7dd8937e5ca47b6'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'ncte-approval-for-course-b-ed-2013-14-onwards');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'ncte-approval-for-course-b-ed-2013-14-onwards' AND c.webflow_slug = 'bachelor-of-education-greater-noida'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'NCTE Approval for Course B.T.C /D.El.ED 2004-05 & Onwards', 'ncte-approval-for-course-b-t-c-d-el-ed-2004-05-onwards',
  (SELECT id FROM public.approval_bodies WHERE name = 'National Council for Teacher Education' LIMIT 1),
  '2004-07-06', '2004-2005 and Onwards', 'campus-school-department-of-education-ghaziabad', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5ed79ad329db0fedf4866739_172%20(1).pdf', '66620d769f85517fbd0271a8'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'ncte-approval-for-course-b-t-c-d-el-ed-2004-05-onwards');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'ncte-approval-for-course-b-t-c-d-el-ed-2004-05-onwards' AND c.webflow_slug = 'diploma-in-elementary-education-d-el-ed-btc'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'PCI 2018 - 19', 'pci-2018-19',
  (SELECT id FROM public.approval_bodies WHERE name = 'Pharmacy Council of India' LIMIT 1),
  '2018-02-09', '2018 - 2019', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5e8e501d03482038800d51ad_286website-nimt.pdf', '66620d770dceef1aa9f74d08'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'pci-2018-19');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'pci-2018-19' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'PCI Approval Letter 2019-20', 'pci-2019-20-decision-letter',
  (SELECT id FROM public.approval_bodies WHERE name = 'Pharmacy Council of India' LIMIT 1),
  '2020-04-10', '2019-2020', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f74984b7f04f60dff27ca1b_Decision%20Letter%20for%20Academic%20Session(2019-2020).pdf', '66620d764624987a3c47c646'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'pci-2019-20-decision-letter');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'pci-2019-20-decision-letter' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'PCI Approval Letter 2020 - 21', 'pci-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'Pharmacy Council of India' LIMIT 1),
  '2020-06-04', '2020-2021', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f749a68f3c86e39e7c22d90_Appendix-B_328-NIMT.pdf', '66620d777f041acb7fe0bbe3'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'pci-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'pci-2020-21' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'PCI Decision Letter for 2020-21', 'pci-decision-letter-for-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'Pharmacy Council of India' LIMIT 1),
  '2020-04-10', '2020-2021', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5fd4c36c4f71094f1de317ff_Decision%20Letter%20for%20Academic%20Session(2020-2021).pdf', '66620d77178e3fdb26c8b984'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'pci-decision-letter-for-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'pci-decision-letter-for-2020-21' AND c.webflow_slug = 'diploma-in-pharmacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Permanent Affiliation Letter - 2002 & Onwards', 'permanent-affiliation-letter-2002-onwards',
  (SELECT id FROM public.approval_bodies WHERE name = '' LIMIT 1),
  '2002-12-23', '2002 & Onwards', 'campus-school', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f01f6b6b8a3d2413995cb68_AFFILATION%20CERTIFICATE%20CAMPUS%20SCHOOL.jpeg', '66620d77266b3128e7f2015b'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'permanent-affiliation-letter-2002-onwards');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'permanent-affiliation-letter-2002-onwards' AND c.webflow_slug = 'schooling-nur-12-cisce-curriculum'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Renewal of Suitability INC 2021-22 NIMT GRN', 'inc-suitability-2021-2022',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2022-03-03', '2021-2022', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/62e118cafea192963e53806f_INC%20Suitability%202021-22.pdf', '66620d756127616bdc1bbf90'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-suitability-2021-2022');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-suitability-2021-2022' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-suitability-2021-2022' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Renewal of Suitability INC 2021-22 NIMT GRN BSc Nursing Web', 'inc-approval-for-bsc-nursing-for-2021-2022',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2022-04-22', '2021-2022', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/6295ac8c9b041dbec126d235_Screen%20Shot%202022-05-31%20at%2011.19.22%20AM.png', '66620d746300f0c0e6487e02'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-approval-for-bsc-nursing-for-2021-2022');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-approval-for-bsc-nursing-for-2021-2022' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Renewal of Suitability INC 2022-23 NIMT GRN', 'renewal-of-suitability-2022-2023',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2022-12-01', '2022 - 2023', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/6404596f4b5726eba28a3cef_RenewalSuitabilityLetterNewFinalDS2021.pdf', '66620d77e14a5bd85f1afc6c'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'renewal-of-suitability-2022-2023');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'renewal-of-suitability-2022-2023' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'renewal-of-suitability-2022-2023' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Renewal of Suitability INC 2022-23 NIMT GRN GNM Web', 'inc-approval-for-2021-22-gnm',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2022-04-22', '2021-2022', 'nimt-hospital', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/6295ac083328512e45da981f_Screen%20Shot%202022-05-31%20at%2011.12.21%20AM.png', '66620d74cb4e6529596e0316'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'inc-approval-for-2021-22-gnm');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'inc-approval-for-2021-22-gnm' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Suitability for B.Sc Nursing for year 2020-21', 'suitability-for-b-sc-nursing-for-year-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = 'Indian Nursing Council' LIMIT 1),
  '2020-10-14', '2020-2021', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f86dd66151dc37eb03672aa_WhatsApp%20Image%202020-10-14%20at%201.17.04%20PM.jpeg', '66620d7785576f69b10278d5'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'suitability-for-b-sc-nursing-for-year-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'suitability-for-b-sc-nursing-for-year-2020-21' AND c.webflow_slug = 'bachelor-of-science-in-nursing'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Suitability for GNM for year 2020-21', 'suitability-for-gnm-for-year-2020-21',
  (SELECT id FROM public.approval_bodies WHERE name = '' LIMIT 1),
  '2020-10-14', '2020-2021', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/5f86e04f83bfcd034e2cc3e5_WhatsApp%20Image%202020-10-14%20at%204.52.43%20PM.jpeg', '66620d779f85517fbd02731f'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'suitability-for-gnm-for-year-2020-21');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'suitability-for-gnm-for-year-2020-21' AND c.webflow_slug = 'diploma-in-general-nursing-midwifery-gnm'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Tata Institute of Social Sciences Approval Letter (All Verticals)', 'tata-institute-of-social-sciences-approval-letter-all-verticals',
  (SELECT id FROM public.approval_bodies WHERE name = '' LIMIT 1),
  '2021-08-20', '2021 - 2022, 2022 - 2023, 2023 - 2024', 'nimt-institute-of-medical-and-paramedical-sciences', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/614330ac4de68a56a7f1d45e_UES.pdf', '66620d773407226d43bfe63b'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'tata-institute-of-social-sciences-approval-letter-all-verticals');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'tata-institute-of-social-sciences-approval-letter-all-verticals' AND c.webflow_slug = 'b-voc-in-medical-laboratory-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'tata-institute-of-social-sciences-approval-letter-all-verticals' AND c.webflow_slug = 'b-voc-in-patient-care-management-geriatric-and-palliative-care'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'tata-institute-of-social-sciences-approval-letter-all-verticals' AND c.webflow_slug = 'b-voc-in-dialysis-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'tata-institute-of-social-sciences-approval-letter-all-verticals' AND c.webflow_slug = 'b-voc-in-optometry'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'tata-institute-of-social-sciences-approval-letter-all-verticals' AND c.webflow_slug = 'post-graduate-diploma-in-emergency-medical-services'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'tata-institute-of-social-sciences-approval-letter-all-verticals' AND c.webflow_slug = 'postgraduate-diploma-in-critical-care-technology'
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_letters (name, slug, approval_body_id, issue_date, academic_session, institution_name, file_url, webflow_item_id)
SELECT 'Upgradation of Affilaition to Class 12th - CBSE - 2023-2028 - NIMT School Ghaziabad', 'upgradation-of-affilaition-to-class-12th-cbse-2023-2028',
  (SELECT id FROM public.approval_bodies WHERE name = '' LIMIT 1),
  '2023-05-11', '2023-2028', 'nimt-school', 'https://uploads-ssl.webflow.com/5e4452effb00142736b79f74/645f5ba2c592fff767025f2a_NIMT%20B%20SCHOOL%20CBSE-12TH%20AFFILIATION%202023-2028.pdf', '66620d7765615631d9963775'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_letters WHERE slug = 'upgradation-of-affilaition-to-class-12th-cbse-2023-2028');

INSERT INTO public.approval_letter_courses (letter_id, course_id)
SELECT al.id, c.id
FROM public.approval_letters al, public.courses c
WHERE al.slug = 'upgradation-of-affilaition-to-class-12th-cbse-2023-2028' AND c.webflow_slug = 'schooling-nur-10-cbse-affiliated'
ON CONFLICT DO NOTHING;