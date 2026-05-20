// Derive a human-readable grade/level hint from a JustDial category.
// Used to surface intent on lead cards when course_id is NULL (typical for
// JD school enquiries) so counsellors don't have to guess what was advertised.
//
// Returns null when the category gives no usable signal (e.g. "Schools",
// "English Medium Schools" — too generic to map to a grade).
export function jdCategoryHint(category: string | null | undefined): string | null {
  if (!category) return null;
  const k = category.toLowerCase().trim();

  if (/class\s*xii\b|class\s*12\b/.test(k)) return "Grade XII";
  if (/class\s*xi\b|class\s*11\b/.test(k))  return "Grade XI";
  if (/senior\s*secondary/.test(k))         return "Grades XI–XII";
  if (/primary\s*school/.test(k))           return "Grades I–V";
  if (/nursery|kindergarten|pre[\s-]?school|play\s*school|day\s*care/.test(k)) return "Pre-primary";
  if (/boarding\s*school|residential\s*school/.test(k))                       return "Residential (grade unknown)";
  if (/boys?\s*boarding/.test(k))                                              return "Residential (boys)";
  if (/girls?\s*boarding/.test(k))                                             return "Residential (girls)";
  if (/icse/.test(k))                                                          return "ICSE";

  return null;
}
