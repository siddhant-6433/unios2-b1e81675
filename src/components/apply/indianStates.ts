/**
 * Canonical list of Indian states + Union Territories.
 * Used by the State dropdown in PersonalDetails (and anywhere else we
 * need a dropdown of Indian states) so applicant data stays standardised
 * for analytics, geo-mapping, and counsellor filters.
 *
 * Names match the official central-government spelling. Added "Other"
 * so the rare edge case (newly-formed UT, mis-listed region) doesn't
 * block submission.
 */

export const INDIAN_STATES: string[] = [
  // 28 States, alphabetical
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  // 8 Union Territories
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
  // Catch-all for anything we missed
  "Other",
];
