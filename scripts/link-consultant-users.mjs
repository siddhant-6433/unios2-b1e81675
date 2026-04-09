import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://deylhigsisuexszsmypq.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3ODQwOCwiZXhwIjoyMDg4MzU0NDA4fQ.wjV_8veUrjdJO__Uv1and4Ij5LiB5My9DEWrhyM9Jr8';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
});

const DEFAULT_PASSWORD = 'NimtConsultant@2026';

async function main() {
  // Get all consultants without a linked user
  const { data: consultants, error: fetchErr } = await supabase
    .from('consultants')
    .select('id, name, phone, email, user_id')
    .is('user_id', null);

  if (fetchErr) { console.error('Fetch error:', fetchErr); process.exit(1); }
  if (!consultants || consultants.length === 0) {
    console.log('All consultants already have linked users.');
    return;
  }

  console.log(`Found ${consultants.length} consultants without user accounts. Creating...\n`);

  let success = 0;
  let failed = 0;

  for (const consultant of consultants) {
    const phone = (consultant.phone || '').trim();
    if (!phone) {
      console.log(`  SKIP: ${consultant.name} — no phone number`);
      failed++;
      continue;
    }

    // Normalize phone: ensure +91 prefix
    const normalizedPhone = phone.startsWith('+') ? phone : `+91${phone}`;
    // Generate email from phone
    const generatedEmail = `${phone}@consultant.nimt.ac.in`;

    try {
      // 1. Create auth user
      const { data: userData, error: createErr } = await supabase.auth.admin.createUser({
        email: generatedEmail,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        phone: normalizedPhone,
        phone_confirm: true,
        user_metadata: {
          display_name: consultant.name,
          full_name: consultant.name,
        },
      });

      if (createErr) {
        // User might already exist with this email
        if (createErr.message?.includes('already been registered')) {
          console.log(`  SKIP: ${consultant.name} (${phone}) — user already exists`);
          continue;
        }
        throw createErr;
      }

      const userId = userData.user.id;

      // 2. Update profile with phone (trigger creates profile, we update it)
      await supabase
        .from('profiles')
        .upsert({
          user_id: userId,
          display_name: consultant.name,
          phone: normalizedPhone,
          email: generatedEmail,
        }, { onConflict: 'user_id' });

      // 3. Assign consultant role
      await supabase
        .from('user_roles')
        .upsert({
          user_id: userId,
          role: 'consultant',
        }, { onConflict: 'user_id,role' });

      // 4. Link consultant record to user
      await supabase
        .from('consultants')
        .update({ user_id: userId })
        .eq('id', consultant.id);

      console.log(`  OK: ${consultant.name} (${normalizedPhone}) → ${userId}`);
      success++;
    } catch (err) {
      console.error(`  FAIL: ${consultant.name} (${phone}) — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} created, ${failed} failed/skipped out of ${consultants.length}`);
}

main().catch(console.error);
