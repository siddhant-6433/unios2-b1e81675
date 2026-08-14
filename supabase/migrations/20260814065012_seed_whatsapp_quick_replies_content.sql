-- Seed the common content templates counsellors asked for into the DB-managed
-- whatsapp_quick_replies table (single source of truth surfaced in both the
-- composer chip panel and the Send WhatsApp Template modal's KNOWLEDGE group).
--
-- Fee info, Hostel info, Placement stats already exist. Added here:
--   • Campus Locations  (moved out of the hardcoded INBOX_TEMPLATES array)
--   • Hostel Fee Structure
--   • Internships & Placements Report
--   • Alumni Network
--
-- NOTE: hostel-fee amounts, internship/placement report figures and alumni data
-- have no structured source in the DB — the copy below is general and points the
-- applicant to a counsellor for specifics. Admins can edit any of these in-app
-- via "Manage Quick Replies" without a deploy. Idempotent: only inserts a label
-- that does not already exist.

INSERT INTO public.whatsapp_quick_replies (label, text, sort_order, is_active)
SELECT v.label, v.text, v.sort_order, true
FROM (VALUES
  (
    'Campus Locations',
    E'📍 *NIMT Campus Locations*\n\n🏫 *Greater Noida (Main)*\nPlot No. 41, Knowledge Park-1, Near Pari Chowk, Greater Noida, UP 201310\n\n🏫 *Ghaziabad – Arthala*\nNear Arthala Metro Station, GT Road, Mohan Nagar, Ghaziabad 201007\n\n🏫 *Ghaziabad – Avantika*\nAnsal Avantika Colony, Shastri Nagar, Ghaziabad 201015\n\n🏫 *Ghaziabad – Avantika II*\nAvantika Extension Colony, Ghaziabad\n\n🏫 *Kotputli, Jaipur*\nSP-3-1, RIICO Industrial Area, Keshwana, Kotputli, Jaipur 303108\n\nFor directions or to schedule a visit, call 📞 +91 9555192192.',
    20
  ),
  (
    'Hostel Fee Structure',
    E'🏠 *NIMT Hostel — Fees & Facilities*\n\nSeparate boys'' and girls'' hostels on/near campus with warden supervision, Wi-Fi, mess, laundry and 24×7 security.\n\n💰 *Hostel fee* depends on room type (single / double / triple sharing) and whether mess is included, and is billed separately from tuition.\n\nShare your campus and preferred room type and our counsellor will send the exact current hostel + mess fee schedule.\n📞 +91 9555192192',
    21
  ),
  (
    'Internships & Placements Report',
    E'💼 *NIMT Internships & Placements*\n\n📈 Highest package: ₹18.75 LPA  •  📊 Average: ₹5.40 LPA\n🏢 1,200+ corporate partners  •  🎯 60+ recruiters visit annually\n🤝 Structured internships built into most programmes\n\n*Top recruiters:* KPMG, Cognizant, ICICI Bank, Wipro, HCL, Dell, Infosys, Deloitte, TCS, Fortis and more.\n\nWant the detailed placement report for a specific course/year? Tell us the course and our placement cell will share it.\n📞 +91 9555192192',
    22
  ),
  (
    'Alumni Network',
    E'🎓 *NIMT Alumni Network*\n\nOur alumni work across leading hospitals, banks, corporates, law firms and their own ventures in India and abroad, and actively mentor and refer current students.\n\n👥 Alumni referral discounts available on admission.\n\nWant to connect with an alumnus from your course, or verify alumni status? Share your details and we''ll put you in touch.\n📞 +91 9555192192',
    23
  )
) AS v(label, text, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_quick_replies q WHERE q.label = v.label
);
