import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://deylhigsisuexszsmypq.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3ODQwOCwiZXhwIjoyMDg4MzU0NDA4fQ.wjV_8veUrjdJO__Uv1and4Ij5LiB5My9DEWrhyM9Jr8';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
});

// Commission structure mapped from fee structure image
// course_code → fixed commission amount (INR)
// Courses with NA commission are excluded
const COMMISSION_MAP = {
  'BMRIT-GN':   15000,  // B.Sc Radiology & Imaging (Greater Noida)
  'MMRIT-GN':   15000,  // M.Sc Medical Radiology & Imaging (Greater Noida)
  'DPT-GN':     10000,  // Diploma in Physiotherapy (Greater Noida)
  'BPT-GN':     15000,  // Bachelor of Physiotherapy (Greater Noida)
  'MPT-GN':     15000,  // Masters in Physiotherapy (Greater Noida)
  'OTT-GN':     10000,  // Diploma in OTT (Greater Noida)
  'DPHARMA-GN': 10000,  // D.Pharma (Greater Noida)
  'BED-GN':     10000,  // B.Ed (Greater Noida)
  'DELED-GZ':   10000,  // D.El.Ed (Ghaziabad)
  'BED-GZ':     10000,  // B.Ed (Ghaziabad)
  'BCA-GN':     15000,  // BCA (Greater Noida)
  'BBA-GN':     15000,  // BBA (Greater Noida)
  'MBA-GN':     30000,  // MBA (Greater Noida)
  'PGDM-GN':    40000,  // PGDM (Greater Noida)
  'PGDM-KT':    40000,  // PGDM (Kotputli)
  'BALLB-GN':   25000,  // BA LLB (Greater Noida)
  'LLB-KT':     10000,  // LLB (Kotputli)
  'LLB-GN':     10000,  // LLB (Greater Noida)
  // Excluded (NA commission): BSCN-GN (B.Sc Nursing), GNM-GN (GNM), BED-KT (B.Ed Kotputli)
};

async function main() {
  // 1. Get all courses that have commission
  const { data: courses, error: courseErr } = await supabase
    .from('courses')
    .select('id, code, name')
    .in('code', Object.keys(COMMISSION_MAP));

  if (courseErr) { console.error('Course fetch error:', courseErr); process.exit(1); }

  console.log(`Found ${courses.length} courses with commission structure:`);
  courses.forEach(c => console.log(`  ${c.code} → ₹${COMMISSION_MAP[c.code].toLocaleString()}`));

  // 2. Get all consultants
  const { data: consultants, error: consErr } = await supabase
    .from('consultants')
    .select('id, name');

  if (consErr) { console.error('Consultant fetch error:', consErr); process.exit(1); }

  console.log(`\nApplying to ${consultants.length} consultants...`);

  // 3. Build commission rows: every consultant × every course
  const rows = [];
  for (const consultant of consultants) {
    for (const course of courses) {
      rows.push({
        consultant_id: consultant.id,
        course_id: course.id,
        commission_type: 'fixed',
        commission_value: COMMISSION_MAP[course.code],
      });
    }
  }

  console.log(`Total commission records to insert: ${rows.length}`);

  // 4. Insert in batches of 500
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('consultant_commissions')
      .upsert(batch, { onConflict: 'consultant_id,course_id' });

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${inserted}/${rows.length}`);
  }

  console.log(`\nDone! ${inserted} commission records set for ${consultants.length} consultants × ${courses.length} courses.`);
}

main().catch(console.error);
