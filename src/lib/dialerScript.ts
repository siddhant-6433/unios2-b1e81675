// Course-specific call-script copy for the Cloud Dialer. Extracted from
// CloudDialer.tsx so both the mobile collapsible and the desktop context rail
// read from one place.

export const getCourseScript = (courseName: string): string => {
  const c = courseName.toLowerCase();
  if (c.includes("nursing") || c.includes("gnm"))
    return " We have our own 500-bed hospital on campus for clinical training. Students get paid internships of ₹10,000/month. Our nursing graduates are placed in top hospitals across India and abroad.";
  if (c.includes("bpt") || c.includes("dpt") || c.includes("mpt") || c.includes("physiotherapy"))
    return " Our physiotherapy programs include hands-on clinical training at our campus hospital. Students get paid internships of ₹10,000/month and excellent placement opportunities in hospitals and sports medicine.";
  if (c.includes("bmrit") || c.includes("mmrit") || c.includes("radiology") || c.includes("imaging"))
    return " Our radiology & imaging technology program offers hands-on training with advanced diagnostic equipment at our campus hospital. Graduates are in high demand at hospitals and diagnostic centres.";
  if (c.includes("ott") || c.includes("operation theat"))
    return " Our OTT diploma trains you in operation theatre management and surgical assistance. Clinical training at our own hospital with direct placement support.";
  if (c.includes("d.pharm") || c.includes("d pharm") || c.includes("pharma"))
    return " Our D.Pharma program is PCI approved with modern labs and industry tie-ups. Students get placed in pharma companies, hospitals, and research labs.";
  if (c.includes("mba") || c.includes("pgdm"))
    return " Our MBA/PGDM program is AICTE approved and NIRF ranked. We have 1,200+ recruiters with packages up to ₹18.75 LPA. The program includes industry internships and live projects.";
  if (c.includes("bba"))
    return " Our BBA program gives you a strong foundation for management careers. Graduates go on to top MBA programs or get placed directly. Industry visits and internships are part of the curriculum.";
  if (c.includes("bca"))
    return " Our BCA program builds strong computing and programming skills. Graduates are placed in IT companies or pursue MCA for advanced careers. Modern computer labs and industry projects included.";
  if (c.includes("law") || c.includes("llb") || c.includes("ballb"))
    return " Our law program is BCI approved with moot court facilities and legal aid clinics. Students participate in national moot court competitions and get placed at top law firms and corporate legal teams.";
  if (c.includes("b.ed") || c.includes("bed") || c.includes("education"))
    return " Our B.Ed program is NCTE recognised. Graduates are eligible for government teaching positions and CTET/UPTET exams. We include school internship experience.";
  if (c.includes("d.el.ed") || c.includes("deled") || c.includes("elementary"))
    return " Our D.El.Ed program prepares you for primary school teaching. NCTE recognised with school internship placements.";
  return " It's a well-established program with strong placement support, experienced faculty, and modern infrastructure.";
};

export const getCourseHighlights = (courseName: string): string[] => {
  const c = courseName.toLowerCase();
  if (c.includes("nursing") || c.includes("gnm"))
    return ["Own 500-bed hospital for clinical training", "Paid internships: ₹10K/month", "INC/UP Medical Faculty approved"];
  if (c.includes("bpt") || c.includes("dpt") || c.includes("mpt") || c.includes("physiotherapy"))
    return ["Own hospital for clinical training", "Paid internships: ₹10K/month", "Sports medicine & rehabilitation focus"];
  if (c.includes("bmrit") || c.includes("mmrit") || c.includes("radiology"))
    return ["Advanced diagnostic equipment on campus", "Hospital-based clinical training", "High demand in healthcare sector"];
  if (c.includes("ott") || c.includes("operation theat"))
    return ["Hands-on OT training at campus hospital", "Surgical assistance skills", "Direct hospital placement"];
  if (c.includes("d.pharm") || c.includes("pharma"))
    return ["PCI approved with modern labs", "Pharma industry tie-ups for placements", "Hospital pharmacy training"];
  if (c.includes("mba") || c.includes("pgdm") || c.includes("bba") || c.includes("bca"))
    return ["NIRF ranked management institution", "₹18.75 LPA highest package", "Industry internships + live projects"];
  if (c.includes("law") || c.includes("llb") || c.includes("ballb"))
    return ["BCI approved with moot court facilities", "National moot court competitions", "Legal aid clinic on campus"];
  if (c.includes("b.ed") || c.includes("bed") || c.includes("d.el.ed") || c.includes("deled") || c.includes("education"))
    return ["NCTE recognised", "Eligible for govt teaching + CTET/UPTET", "School internship included"];
  return [];
};

export const getCourseNudges = (courseName: string): string[] => {
  const c = courseName.toLowerCase();
  if (c.includes("nursing") || c.includes("gnm"))
    return ["Paid internship: ₹10K/month", "Own hospital for clinical training", "International placement opportunities"];
  if (c.includes("bpt") || c.includes("dpt") || c.includes("mpt") || c.includes("physiotherapy"))
    return ["Paid internship: ₹10K/month", "Own hospital for clinical training", "Sports medicine career path"];
  if (c.includes("bmrit") || c.includes("mmrit") || c.includes("radiology"))
    return ["High-demand healthcare career", "Modern diagnostic equipment", "Hospital placement support"];
  if (c.includes("ott") || c.includes("operation theat"))
    return ["Hospital OT training", "Quick career start (diploma)", "Direct placement support"];
  if (c.includes("d.pharm") || c.includes("pharma"))
    return ["Modern pharma labs on campus", "Industry placement tie-ups", "Hospital pharmacy exposure"];
  if (c.includes("mba") || c.includes("pgdm"))
    return ["₹18.75 LPA highest package", "1,200+ recruiters on campus", "Industry internship included"];
  if (c.includes("bba"))
    return ["Strong foundation for MBA", "Industry visits + internships", "Direct placement support"];
  if (c.includes("bca"))
    return ["IT industry placements", "Modern computer labs", "MCA pathway available"];
  if (c.includes("law") || c.includes("llb") || c.includes("ballb"))
    return ["Moot court + legal aid clinic", "National competition participation", "Law firm placement support"];
  if (c.includes("b.ed") || c.includes("bed") || c.includes("education"))
    return ["Govt teaching eligibility", "CTET/UPTET preparation support", "School internship experience"];
  if (c.includes("d.el.ed") || c.includes("deled") || c.includes("elementary"))
    return ["Primary school teaching career", "NCTE recognised", "School internship included"];
  return ["Strong placement support", "Experienced faculty"];
};
