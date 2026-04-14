/**
 * NIMT Knowledge Base for Voice Agent
 * Source: nimt.ac.in, nimt_knowledge_base.md (compiled April 2026)
 * ALL facts verified — no hypothetical information.
 */

export const NIMT_OVERVIEW = `NIMT (National Institute of Management and Technology) is a private multi-campus educational institution established in 1987. It operates 21 Higher Education Programs at 11 Colleges across 5 Campuses in Greater Noida (UP), Ghaziabad (UP), and Kotputli Jaipur (Rajasthan). Overall, NIMT offers 36+ programmes spanning Law, Management, Teacher Training, Medicine, Biotechnology, Pharmacy, Physiotherapy, Arts, Science, Commerce, and K-12 schooling. Tagline: "Where Ambition Meets Action".

Approvals: AICTE, UGC, BCI (Bar Council of India), NCTE, Indian Nursing Council (INC), Pharmacy Council of India (PCI).
Affiliations: AKTU, GGSIPU, ABVMU, ALU (Dr. Bhimrao Ambedkar Law University), CCSU, University of Rajasthan.
Rankings: #1 in UP (EW Higher Ed), Ranked 34th B-School (Business India), AA+ rated (Digital Learning Magazine), 6 institutions NIRF ranked 2025, #57 Law in India (India Today 2025).
Placements: 1,200+ corporate partners, 60+ companies visit campus. Highest: INR 18.75 LPA, Average: INR 5.40 LPA. Top recruiters: Fortis, KPMG, Cognizant, ICICI Bank, Wipro, HCL, Dell, Airtel, Kotak Mahindra, Infosys.
Facilities: Modern classrooms, advanced labs, library with digital access, on-campus parent hospital (Greater Noida), separate hostels (600+ capacity, AC/non-AC), cafeteria, gym, sports grounds, Wi-Fi, transport.`;

export const CAMPUS_INFO: Record<string, string> = {
  "Greater Noida": "Plot No. 41, Knowledge Park-1, Near Pari Chowk, Greater Noida, UP 201310. Main academic campus. Houses PGDM, MBA, BPT, BSc Nursing, BCA, BA LLB, LLB, D Pharma, BMRIT, GNM, D-OTT, MPT. On-campus parent hospital for clinical training.",
  "Ghaziabad (Arthala)": "Near Arthala Metro Station, GT Road, Mohan Nagar, Ghaziabad 201007. NIMT Institute of Technology and Management. BBA, B.Ed, PGDM, MBA.",
  "Ghaziabad (Avantika)": "Ansal Avantika Colony, Shastri Nagar, Ghaziabad 201015. NIMT Beacon School (CBSE), Campus School, B.Ed institutions.",
  "Ghaziabad (Avantika II)": "Avantika Extension Colony, Ghaziabad. Residential and day school campus.",
  "Kotputli Jaipur": "SP-3-1, RIICO Industrial Area, Keshwana, Kotputli, Jaipur 303108. 20-acre campus. Law, engineering, management, pharmacy, B.Ed. Affiliated to University of Rajasthan.",
};

export const COURSE_KNOWLEDGE: Record<string, {
  highlights: string[];
  practicalExposure: string;
  careers: string;
  whyNimt: string;
  eligibility: string;
  entrance: string;
  duration: string;
  campus: string;
  placementHighlights?: string;
}> = {
  "B.Sc Nursing": {
    highlights: [
      "4-year degree + 6-month paid internship (stipend Rs 10,000/month)",
      "Approved by Indian Nursing Council (INC) and PCI",
      "Affiliated to Atal Bihari Vajpayee Medical University (ABVMU)",
      "Clinical training at NIMT's own parent hospital on campus PLUS affiliated hospitals — GIMS (Greater Noida), Navin Hospital, Manipal Hospital",
      "Psychiatric training at VIMHANS Delhi and IHBAS Delhi",
      "Community training at CHCs and PHCs",
      "~98% placement rate",
    ],
    practicalExposure: "Clinical training at NIMT's on-campus parent hospital and affiliated hospitals including Government Institute of Medical Sciences (Greater Noida), Navin Hospital, Manipal Hospital. Psychiatric postings at VIMHANS (Delhi) and IHBAS (Delhi). Community training at CHCs and PHCs. 6-month paid internship in final year with Rs 10,000/month stipend.",
    careers: "Registered Nurse with State and Indian Nursing Councils. Staff Nurse at hospitals (Apollo, Max, Fortis), ICU and OT Nurse, Community Nurse, Nurse Educator, Nurse Administrator. Nursing roles in Indian Army, Railways, and abroad.",
    whyNimt: "Own parent hospital on campus for hands-on training from Year 1, affiliated to multiple hospitals including government facilities, 6-month paid internship, ~98% placement rate, part of NIMT's 40-year education legacy.",
    eligibility: "10+2 with Physics, Chemistry, Biology and English. Minimum 45% aggregate from any recognised board. Minimum age 17 on 31 Dec. Must be medically fit.",
    entrance: "UPCNET (UP Combined Nursing Entrance Test) or CPNET / merit-based",
    duration: "4 Years (8 Semesters) + 6-month paid internship",
    campus: "Greater Noida, Kotputli (Jaipur)",
    placementHighlights: "Highest: Rs 10 LPA. Average: Rs 3 LPA. Top employers: Max Hospital, Apollo, Fortis.",
  },
  "GNM": {
    highlights: [
      "3-year diploma + 6-month internship",
      "Approved by Indian Nursing Council and UP State Medical Faculty",
      "UNIQUE: Open to Arts and Commerce students — Science background NOT mandatory",
      "Clinical training at NIMT parent hospital and affiliated hospitals",
      "Graduates receive registration from State and Indian Nursing Councils",
    ],
    practicalExposure: "Training at NIMT's parent hospital and affiliated hospitals. Community training at CHCs and PHCs. Psychiatric postings at specialist hospitals.",
    careers: "Registered Nurse and Registered Midwife. Work in hospitals, clinics, maternity homes, CHCs, schools, training institutes, NGOs. International nursing opportunities available.",
    whyNimt: "Accessible to non-Science students, own hospital training, affordable, pathway to Post-Basic BSc Nursing for degree upgrade.",
    eligibility: "10+2 from any stream (Arts/Commerce/Science accepted). Minimum 40% aggregate. Age 17-35 years.",
    entrance: "UPCNET / merit-based",
    duration: "3 Years + 6-month Internship",
    campus: "Greater Noida",
  },
  "BPT": {
    highlights: [
      "4.5-year degree including 6-month compulsory internship",
      "Clinical training at NIMT parent hospital and affiliated facilities",
      "Internship rotations: Orthopaedics, Neurology, General Surgery, General Medicine, and Physiotherapy",
      "Specialisation areas: Musculoskeletal, Neurological, Cardiorespiratory, Sports, Paediatric, Geriatric",
    ],
    practicalExposure: "Clinical training at NIMT's own parent hospital. Internship equally divided across Orthopaedics, Neurology, General Surgery, General Medicine, and Physiotherapy departments.",
    careers: "Physiotherapist in private clinics, government/private hospitals, nursing homes, CHCs, NGOs, sports teams, gyms, fitness clinics, rehabilitation centres. Can pursue MPT.",
    whyNimt: "Own hospital on campus, comprehensive clinical rotation, growing demand for physiotherapists in India.",
    eligibility: "10+2 with PCB. Minimum 45% (General), 40% (OBC/SC/ST). English passed individually. Minimum age 17.",
    entrance: "CPET (Common Paramedical Entrance Test) / UPCPAT",
    duration: "4.5 Years (8 Semesters + 6-month Internship)",
    campus: "Greater Noida",
  },
  "MBA": {
    highlights: [
      "2-year full-time MBA affiliated to AKTU, AICTE approved",
      "Faculty includes eminent entrepreneurs, CXOs, and stalwarts from banking, finance, and government",
      "Specialisations: Finance, Marketing, HR, Operations, IT, International Business, Insurance & Banking, Agri Business",
      "Harvard case-based learning methodology",
      "Mandatory 8-12 week summer internship",
      "1,200+ corporate placement partners",
    ],
    practicalExposure: "Mandatory 8-12 week summer internship after Semester 2. Harvard case study methodology, live industry projects, corporate visits, guest lectures by senior industry executives, corporate mentorship.",
    careers: "Management Trainee, Marketing Manager, Financial Analyst, HR Business Partner, Operations Manager, Business Development, Consultant. Top recruiters: Deloitte, KPMG, TCS, ICICI Bank, Wipro, HCL, Infosys.",
    whyNimt: "Ranked 34th B-School by Business India, AA+ rated, 1,200+ placement partners. Highest: INR 18.75 LPA, Average: INR 5.40 LPA.",
    eligibility: "Bachelor's degree (3-year minimum) with minimum 50% (45% SC/ST/OBC). Valid CAT/MAT/XAT/CMAT/GMAT/SNAP/NMAT score.",
    entrance: "CAT, MAT, XAT, CMAT, GMAT, SNAP, or NMAT",
    duration: "2 Years (4 Semesters)",
    campus: "Greater Noida, Ghaziabad",
    placementHighlights: "Highest: INR 18.75 LPA. Average: INR 5.40 LPA. 60+ companies visit campus. Top: Fortis, KPMG, Cognizant, ICICI Bank, Wipro, Dell.",
  },
  "PGDM": {
    highlights: [
      "2-year full-time residential PGDM, AICTE approved",
      "Industry-equivalent to MBA but with greater curricular flexibility",
      "NIMT Institute of Technology and Management ranked #8 in India",
      "60 students per campus — intimate batch sizes",
      "Specialisations: HR, Marketing, Operations, International Business, Insurance & Banking, Foreign Trade, Agri Business",
    ],
    practicalExposure: "Residential programme with campus immersion. Industry internships, live projects, business simulations, leadership workshops.",
    careers: "Management roles across FMCG, BFSI, IT/ITES, Retail, Logistics, Media, Healthcare, Consulting.",
    whyNimt: "Ranked #8 in India, AICTE approved, 1,200+ placement partners, residential programme.",
    eligibility: "Bachelor's degree (3-year minimum) with minimum 50% (45% reserved). Valid CAT/MAT/XAT/CMAT score.",
    entrance: "CAT, MAT, XAT, CMAT",
    duration: "2 Years (4 Semesters), Full-time Residential",
    campus: "Greater Noida, Ghaziabad, Kotputli (Jaipur)",
  },
  "LLB": {
    highlights: [
      "BA LLB (5 years integrated) and LLB (3 years) available",
      "Approved by Bar Council of India (BCI)",
      "NIMT Vidhi Evam Kanun Sansthan — one of the finest law schools",
      "MoU with CLAT Consortium for admissions",
      "#57 Law in India (India Today 2025)",
      "Moot Court room for practice advocacy and trial simulation",
      "Legal Aid clinic for community service and real case exposure",
      "Specialisations: Business Law, Criminal Law, Constitutional Law, Family Law, Labour Law, International Law",
    ],
    practicalExposure: "Moot Court sessions, live Model Moot Court competitions, legal aid activities, court visits (District and High Court), internships with advocates and law firms. Case-law teaching method. Guest lectures by corporate executives, advocates, and judges.",
    careers: "Advocate, Corporate Lawyer, Legal Advisor, Judicial Services (after PCS-J exam), Legal Consultant in MNCs, roles in banks, NGOs, international organizations. Must clear AIBE to practise as advocate.",
    whyNimt: "BCI approved, CLAT consortium MoU, #57 law India, active moot court, legal aid clinic, experienced faculty from judiciary and bar.",
    eligibility: "BA LLB: 12th pass, min 45%. LLB: Graduation in any stream, min 45% (40% SC/ST/OBC).",
    entrance: "BA LLB: CLAT, LSAT, ULSAT. LLB: Merit-based / CLAT PG.",
    duration: "BA LLB: 5 Years. LLB: 3 Years.",
    campus: "Greater Noida (main), Kotputli (affiliated to University of Rajasthan and Dr. Bhimrao Ambedkar Law University)",
  },
  "B.Ed": {
    highlights: [
      "2-year Bachelor of Education, NCTE recognised",
      "Mandatory for teaching at secondary and higher secondary level",
      "Greater Noida: affiliated to CCSU",
      "Kotputli: NIMT Mahila B.Ed College (women's), affiliated to University of Rajasthan",
      "Pedagogy specialisations for Arts and Science streams",
    ],
    practicalExposure: "School internship / teaching practice in real classrooms. Micro-teaching sessions, workshops, seminars, community outreach.",
    careers: "School Teacher (PGT/TGT) after clearing TET/CTET/UPTET. Private school teacher, coaching educator, education NGO. Can pursue M.Ed.",
    whyNimt: "NCTE recognised, strong school network for teaching practice, experienced faculty.",
    eligibility: "Arts/Science/Humanities graduates: min 50% (45% SC/ST). B.E./B.Tech: min 55%.",
    entrance: "UP B.Ed Joint Entrance Examination (UP BED JEE). Kotputli: State Level PTET.",
    duration: "2 Years (4 Semesters)",
    campus: "Greater Noida, Ghaziabad (Arthala), Kotputli (Jaipur)",
  },
  "BCA": {
    highlights: [
      "3-year undergraduate programme in Computer Applications",
      "Gateway to IT and technology careers",
      "Programming: C, C++, Java, Python. Web: HTML, CSS, JavaScript. Database: SQL",
      "Covers Cloud Computing, Mobile App Development, Cybersecurity basics",
    ],
    practicalExposure: "Project work from Semester 4 onwards, elective subjects in advanced technologies.",
    careers: "Software Developer, Web Designer, Database Administrator, System Analyst, Network Engineer, IT Support, Data Analyst. Foundation for MCA or MBA (IT).",
    whyNimt: "Strong IT curriculum, affordable, placement support.",
    eligibility: "12th pass with Mathematics. Minimum 45-50% aggregate.",
    entrance: "Merit-based / JEECUP score",
    duration: "3 Years (6 Semesters)",
    campus: "Greater Noida",
  },
  "BBA": {
    highlights: [
      "3-year full-time BBA with general management curriculum",
      "Specialisations: Finance, Marketing, HR, Strategy & Entrepreneurship, International Business, Supply Chain",
      "Industry exposure with internships at companies like Deloitte, KPMG, TCS",
      "120 student intake",
    ],
    practicalExposure: "Case studies, industry interactions, live projects, summer internship. Emphasis on real-world business practice.",
    careers: "Business Development, Marketing Executive, HR Trainee, Sales Manager, Financial Analyst, Operations, Entrepreneur. Stepping stone to MBA.",
    whyNimt: "Strong industry connections, internship with top firms, affordable management education.",
    eligibility: "12th pass from any stream. Minimum 45% aggregate.",
    entrance: "Merit-based (Class 12 marks)",
    duration: "3 Years (6 Semesters)",
    campus: "Greater Noida, Ghaziabad (Arthala)",
  },
  "BMRIT": {
    highlights: [
      "4-year B.Sc in Medical Radiology & Imaging Technology",
      "Training in X-ray, CT scan, MRI, Ultrasound, Nuclear Medicine",
      "Clinical training at NIMT hospital and affiliated facilities",
    ],
    practicalExposure: "General X-ray, orthopaedics imaging, paediatric imaging, emergency imaging, mobile imaging, surgical suite imaging at affiliate hospitals.",
    careers: "Radiographer, X-Ray/CT/MRI/Ultrasound Technician at hospitals, diagnostic centres, multi-specialty hospitals (Apollo, Max, Fortis), Armed Forces medical corps. Can pursue M.Sc MMRIT.",
    whyNimt: "Hospital-based training, growing diagnostic imaging field, affordable.",
    eligibility: "10+2 with Biology. Minimum 45% aggregate.",
    entrance: "Merit-based (no entrance exam required)",
    duration: "4 Years (including internship)",
    campus: "Greater Noida",
  },
  "D Pharma": {
    highlights: [
      "2-year Diploma in Pharmacy + 3-month practical training",
      "Approved by Pharmacy Council of India (PCI)",
      "Hospital and community pharmacy training",
    ],
    practicalExposure: "Hands-on training in hospital pharmacies and retail/community pharmacies. Dispensing, stock management, patient counselling.",
    careers: "Registered Pharmacist, Pharmaceutical Sales Rep, Drug Inspector (with further qualification), QC/QA in pharma companies. Eligible for lateral entry into B Pharma.",
    whyNimt: "PCI approved, hospital pharmacy training, pathway to B Pharma.",
    eligibility: "10+2 Science with PCB or PCM. Minimum 50% aggregate.",
    entrance: "JEECUP / merit-based",
    duration: "2 Years + 3-month training",
    campus: "Greater Noida",
  },
  "Grade": {
    highlights: [
      "NIMT Beacon School — CBSE affiliated, Nursery to Grade XII",
      "Smart classrooms with interactive boards",
      "Day boarding with after-school activities and lunch (Rs 4,000/month)",
      "Transport in 3 zones based on distance",
      "Boarding: Non-AC, AC C Block, AC B Block options",
      "Part of NIMT's 40-year education legacy",
    ],
    practicalExposure: "Science and computer labs, activity rooms, annual sports day, inter-school competitions, educational excursions.",
    careers: "Foundation for competitive exams (JEE, NEET, CLAT). Holistic development.",
    whyNimt: "CBSE curriculum, experienced teachers, safe campus, affordable fees, day boarding option includes lunch.",
    eligibility: "Age-appropriate admission.",
    entrance: "Interaction and age-appropriate assessment",
    duration: "Academic year",
    campus: "Ghaziabad (Avantika / Avantika II)",
  },
  "MIR": {
    highlights: [
      "Mirai Experiential School — IB World School",
      "PYP (Primary Years Programme) and MYP (Middle Years Programme)",
      "Inquiry-based, experiential learning — not rote memorisation",
      "International curriculum developing global citizens",
      "Small class sizes for personalised learning",
      "Bilingual programme — English and Hindi",
      "Learner profile: thinkers, communicators, risk-takers",
    ],
    practicalExposure: "PYP Exhibition, MYP Personal Project, community service, maker space, STEAM labs, performing arts, field trips.",
    careers: "Prepares for IB Diploma, international universities, global careers. Critical thinking and creativity.",
    whyNimt: "Only IB World School in the region, world-class pedagogy, international exposure, small classes, purpose-built campus.",
    eligibility: "Age-appropriate admission.",
    entrance: "Interaction and assessment",
    duration: "Academic year",
    campus: "Mirai Experiential School, Ghaziabad",
  },
};

export function getCourseKnowledge(courseName: string): typeof COURSE_KNOWLEDGE[string] | null {
  const name = courseName.toLowerCase();
  for (const [pattern, knowledge] of Object.entries(COURSE_KNOWLEDGE)) {
    if (name.includes(pattern.toLowerCase())) return knowledge;
  }
  if (name.includes("grade") || name.includes("nursery") || name.includes("lkg") || name.includes("ukg") || name.includes("toddler")) {
    return COURSE_KNOWLEDGE["Grade"];
  }
  if (name.includes("mir-") || name.includes("mirai")) {
    return COURSE_KNOWLEDGE["MIR"];
  }
  return null;
}

export const ADMISSIONS_INFO = `How to Apply:
1. Visit apply.nimt.ac.in and complete online application
2. Appear for relevant entrance exam or GD/PI
3. Receive offer letter upon shortlisting
4. Confirm seat by paying admission fee
Application Fee: Rs 500-1,000 (varies by course)
Applications: January-July | Admission deadline: September | Academic year: August/September
Helpline: +91 9555192192 | apply.nimt.ac.in`;
