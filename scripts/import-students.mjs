/**
 * Import students from CSV into Supabase (2026-27 batch)
 * - Reads CSV via xlsx package
 * - Parent deduplication by phone number (sibling linking)
 * - Creates auth users for students, fathers, mothers, guardians
 * - Creates profiles + roles
 * - Inserts into students table with all columns mapped
 * - Upserts on duplicate admission_no
 *
 * Usage: node scripts/import-students.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const CSV_PATH = '/Users/siddhantsingh/Desktop/students-data 2026-27.csv';

const SUPABASE_URL = 'https://deylhigsisuexszsmypq.supabase.co';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3ODQwOCwiZXhwIjoyMDg4MzU0NDA4fQ.wjV_8veUrjdJO__Uv1and4Ij5LiB5My9DEWrhyM9Jr8';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
  global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
});

// ──────────────────────────────────────────────
// Hardcoded campus & course mapping
// ──────────────────────────────────────────────

const CAMPUS_ID = '9bb6b4cc-c992-4af1-b9d3-384537a510c8';
const CAMPUS_NAME = 'Ghaziabad Campus 3 (Avantika II)';

const COURSE_MAP = {
  'NURSERY': { id: '6b4d25f7-67c2-4cc6-9111-29bfbc2a901c', code: 'BSA-NUR' },
  'NUR':     { id: '6b4d25f7-67c2-4cc6-9111-29bfbc2a901c', code: 'BSA-NUR' },
  'LKG':     { id: '37b26909-3b8a-4413-952d-d264dd70746d', code: 'BSA-LKG' },
  'L.K.G':   { id: '37b26909-3b8a-4413-952d-d264dd70746d', code: 'BSA-LKG' },
  'UKG':     { id: 'b846c988-adb2-4b7b-834a-97a25460679d', code: 'BSA-UKG' },
  'U.K.G':   { id: 'b846c988-adb2-4b7b-834a-97a25460679d', code: 'BSA-UKG' },
  'G1':      { id: '300a58e1-f2d8-4ae6-b672-1e85deb4cabc', code: 'BSA-G1' },
  'G2':      { id: 'e34d6e81-0790-4448-8ccb-eadfcca5f8bb', code: 'BSA-G2' },
  'G3':      { id: '0a7dfb91-c29e-4e24-81ef-7520e49de1da', code: 'BSA-G3' },
  'G4':      { id: '19103903-5c21-4465-af12-d57da2e77713', code: 'BSA-G4' },
  'G5':      { id: '98f440e8-ac71-4dbc-9cd6-7f984deab752', code: 'BSA-G5' },
  'G6':      { id: 'd4459e8b-49aa-4891-83d3-bbc69db4ec09', code: 'BSA-G6' },
  'G7':      { id: '35519b1a-078d-4c6f-8e5a-71c4adb17d85', code: 'BSA-G7' },
  'G8':      { id: '4e30071d-7b89-4c30-8c7b-eef90f7716f5', code: 'BSA-G8' },
};

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Strip leading apostrophe, +91, spaces, dashes from phone numbers */
function cleanPhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^'+/, '');
  s = s.replace(/^\+?91(?=\d{10}$)/, '');
  s = s.replace(/[\s\-]/g, '');
  if (!/^\d{10}$/.test(s)) return null;
  return s;
}

/** Parse DD/MM/YYYY to ISO date string YYYY-MM-DD */
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    const year = m[3];
    return `${year}-${month}-${day}`;
  }
  if (!isNaN(raw) && Number(raw) > 30000) {
    const d = new Date((Number(raw) - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Map status from CSV to DB enum */
function mapStatus(raw) {
  if (!raw) return 'active';
  const s = String(raw).trim().toUpperCase();
  if (s === 'ACTIVE') return 'active';
  if (s === 'LEFT' || s === 'INACTIVE') return 'inactive';
  if (s === 'ALUMNI') return 'alumni';
  if (s === 'DROPPED') return 'dropped';
  if (s === 'PRE_ADMITTED' || s === 'PRE-ADMITTED') return 'pre_admitted';
  return 'active';
}

/** Map gender */
function mapGender(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (s === 'M' || s === 'MALE') return 'male';
  if (s === 'F' || s === 'FEMALE') return 'female';
  if (s === 'OTHER') return 'other';
  return null;
}

/** Truthy check for yes/no/true/false fields */
function toBool(raw) {
  if (!raw) return false;
  const s = String(raw).trim().toUpperCase();
  return ['YES', 'Y', 'TRUE', '1'].includes(s);
}

/** Get a clean string or null */
function str(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

/** Normalise Class column to a key we can look up in COURSE_MAP */
function normaliseClass(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toUpperCase();

  // Direct match first
  if (COURSE_MAP[s]) return s;

  // Common aliases
  const aliases = {
    'PRE-NURSERY': null, 'PRE NURSERY': null, 'PRENURSERY': null,
    'KG': 'UKG',
    'I': 'G1', 'II': 'G2', 'III': 'G3', 'IV': 'G4', 'V': 'G5',
    'VI': 'G6', 'VII': 'G7', 'VIII': 'G8', 'IX': null, 'X': null,
    'XI': null, 'XII': null,
    '1': 'G1', '2': 'G2', '3': 'G3', '4': 'G4', '5': 'G5',
    '6': 'G6', '7': 'G7', '8': 'G8', '9': null, '10': null,
    '11': null, '12': null,
  };
  if (s in aliases) return aliases[s];

  // Handle "Grade 1", "Class 5", "G1", etc.
  const gm = s.match(/(?:GRADE|CLASS|G)\s*(\d+)/i);
  if (gm) {
    const num = parseInt(gm[1], 10);
    if (num >= 9) return null; // No BSA course for 9+
    return `G${num}`;
  }

  return s; // fallback — may not match
}

// ──────────────────────────────────────────────
// Auth user creation helpers
// ──────────────────────────────────────────────

async function createAuthUser(email, password, displayName, phone) {
  const userData = {
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, full_name: displayName },
  };
  if (phone) {
    userData.phone = `+91${phone}`;
    userData.phone_confirm = true;
  }

  const { data, error } = await supabase.auth.admin.createUser(userData);

  if (error) {
    if (
      error.message?.includes('already been registered') ||
      error.message?.includes('already exists') ||
      error.message?.includes('duplicate') ||
      error.status === 422
    ) {
      // Look up existing user by email
      const { data: listData } = await supabase.auth.admin.listUsers({
        filter: `email.eq.${email}`,
        page: 1,
        perPage: 1,
      });
      const existingId = listData?.users?.[0]?.id || null;
      return { userId: existingId, skipped: true, error: error.message };
    }
    return { userId: null, skipped: false, error: error.message };
  }
  return { userId: data.user.id, skipped: false, error: null };
}

async function assignRole(userId, role) {
  if (!userId) return;
  const { error } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role }, { onConflict: 'user_id,role' });
  if (error) console.warn(`  [warn] role assign failed for ${userId}: ${error.message}`);
}

async function setDisplayName(userId, displayName) {
  if (!userId || !displayName) return;
  // Only set if not already set (don't overwrite for existing parents / siblings)
  const { data: existing } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .single();
  if (existing?.display_name) return; // already has a name
  await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', userId);
}

// ──────────────────────────────────────────────
// Parent deduplication
// ──────────────────────────────────────────────

// Maps cleaned phone → { userId, name }
const phoneToParent = new Map();

/**
 * Get or create a parent auth user. Deduplicates by phone number.
 * Returns the user_id or null.
 */
async function getOrCreateParent({ phone, email, fallbackEmail, password, displayName, srNumber }) {
  // 1. Check in-memory map
  if (phone && phoneToParent.has(phone)) {
    const cached = phoneToParent.get(phone);
    return { userId: cached.userId, reused: true };
  }

  // 2. Check DB by phone (profiles table)
  if (phone) {
    const { data: profileMatch } = await supabase
      .from('profiles')
      .select('id')
      .eq('phone', `+91${phone}`)
      .limit(1);
    if (profileMatch?.length) {
      const uid = profileMatch[0].id;
      phoneToParent.set(phone, { userId: uid, name: displayName });
      await assignRole(uid, 'parent');
      return { userId: uid, reused: true };
    }
  }

  // 3. Create new auth user
  const emailToUse = email || fallbackEmail;
  const auth = await createAuthUser(emailToUse, password, displayName, phone);
  let userId = auth.userId;

  if (userId) {
    await assignRole(userId, 'parent');
    await setDisplayName(userId, displayName);
    if (phone) phoneToParent.set(phone, { userId, name: displayName });
    return { userId, reused: false };
  }

  // auth failed but not a duplicate error — nothing we can do
  if (auth.error && !auth.skipped) {
    console.warn(`    [warn] Parent auth failed: ${auth.error}`);
  }
  return { userId: null, reused: false };
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('Loading CSV file...');
  const xlsxModule = await import('xlsx');
  const XLSX = xlsxModule.default ?? xlsxModule;

  const buffer = fs.readFileSync(CSV_PATH);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`Found ${rows.length} rows\n`);

  if (rows.length === 0) {
    console.log('No data found. Exiting.');
    return;
  }

  // Print first row keys for debugging
  console.log('Column headers:', Object.keys(rows[0]).join(', '));
  console.log('');

  // ── Lookup session ──
  const { data: sessions } = await supabase
    .from('admission_sessions')
    .select('id, name')
    .order('start_date', { ascending: false })
    .limit(1);
  const sessionId = sessions?.[0]?.id || null;
  console.log(`Campus: ${CAMPUS_NAME} (${CAMPUS_ID})`);
  console.log(`Session: ${sessions?.[0]?.name || 'none'} (${sessionId})\n`);

  // ── Import loop ──

  const stats = { imported: 0, updated: 0, failed: 0, siblingsDetected: 0 };
  const total = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const srNumber = str(r['SR Number']);
    const fullName = str(r['Student Full Name']) ||
      [str(r['Student First Name']), str(r['Student Middle Name']), str(r['Student Last Name'])]
        .filter(Boolean)
        .join(' ') ||
      'Unknown';

    try {
      console.log(`[${i + 1}/${total}] ${fullName} (SR ${srNumber})`);

      // ── 1. Clean phone numbers ──
      const fatherPhone = cleanPhone(r['Father Mobile No.']);
      const motherPhone = cleanPhone(r['Mother Mobile No.']);
      const fatherWhatsapp = cleanPhone(r['Father WhatsApp No.']);
      const motherWhatsapp = cleanPhone(r['Mother WhatsApp No.']);
      const guardianPhone = cleanPhone(r['Guardian No.']);
      const studentWhatsapp = cleanPhone(r['WhatsApp No.']);

      // ── 2. Create student auth user ──
      const studentEmail =
        str(r['School Email']) ||
        str(r['Student Email']) ||
        `sr${srNumber}@beacon.nimt.ac.in`;
      const studentPassword = `Beacon@${srNumber}`;

      const studentAuth = await createAuthUser(
        studentEmail,
        studentPassword,
        fullName,
        studentWhatsapp || fatherPhone,
      );
      let studentUserId = studentAuth.userId;
      if (studentUserId) {
        await assignRole(studentUserId, 'student');
        await setDisplayName(studentUserId, fullName);
      }
      if (studentAuth.error && !studentAuth.skipped) {
        console.error(`    [!] Student auth failed: ${studentAuth.error}`);
      }

      // ── 3. Father ──
      let fatherUserId = null;
      if (str(r['Fathers Name']) && (fatherPhone || str(r['Father Email ID']))) {
        const result = await getOrCreateParent({
          phone: fatherPhone,
          email: str(r['Father Email ID']),
          fallbackEmail: `father.sr${srNumber}@beacon.nimt.ac.in`,
          password: `Parent@${srNumber}`,
          displayName: str(r['Fathers Name']),
          srNumber,
        });
        fatherUserId = result.userId;
        if (result.reused) {
          stats.siblingsDetected++;
          console.log(`    -> Father reused (sibling detected) phone=${fatherPhone}`);
        }
      }

      // ── 4. Mother ──
      let motherUserId = null;
      if (str(r['Mothers Name']) && (motherPhone || str(r['Mother Email ID']))) {
        const result = await getOrCreateParent({
          phone: motherPhone,
          email: str(r['Mother Email ID']),
          fallbackEmail: `mother.sr${srNumber}@beacon.nimt.ac.in`,
          password: `Parent@${srNumber}`,
          displayName: str(r['Mothers Name']),
          srNumber,
        });
        motherUserId = result.userId;
        if (result.reused) {
          stats.siblingsDetected++;
          console.log(`    -> Mother reused (sibling detected) phone=${motherPhone}`);
        }
      }

      // ── 5. Guardian (if different from father/mother) ──
      let guardianUserId = null;
      if (guardianPhone && guardianPhone !== fatherPhone && guardianPhone !== motherPhone) {
        const result = await getOrCreateParent({
          phone: guardianPhone,
          email: null,
          fallbackEmail: `guardian.sr${srNumber}@beacon.nimt.ac.in`,
          password: `Parent@${srNumber}`,
          displayName: `Guardian of ${fullName}`,
          srNumber,
        });
        guardianUserId = result.userId;
        if (result.reused) {
          stats.siblingsDetected++;
          console.log(`    -> Guardian reused (sibling detected) phone=${guardianPhone}`);
        }
      }

      // ── 6. Look up course ──
      const classRaw = str(r['Class']);
      const normClass = normaliseClass(classRaw);
      const courseEntry = normClass ? COURSE_MAP[normClass] : null;
      const courseId = courseEntry?.id || null;
      if (!courseId && classRaw) {
        console.warn(`    [warn] No BSA course for class "${classRaw}" (normalised: "${normClass}") — student will be imported without course`);
      }

      // ── 7. Build student record ──
      const studentData = {
        // Core fields
        user_id: studentUserId || undefined,
        name: fullName,
        first_name: str(r['Student First Name']),
        middle_name: str(r['Student Middle Name']),
        last_name: str(r['Student Last Name']),
        sr_number: srNumber,
        phone: fatherPhone || motherPhone || null,
        email: studentEmail,
        gender: mapGender(r['Gender']),
        dob: parseDate(r['Date of Birth']),
        status: mapStatus(r['Status']),
        admission_date: parseDate(r['Date of Adm']),
        date_of_admission: parseDate(r['Date of Adm']),
        admission_no: str(r['School Admission No.']),
        campus_id: CAMPUS_ID,
        course_id: courseId || undefined,
        session_id: sessionId || undefined,
        blood_group: str(r['Blood Group']),

        // Section & type
        section: str(r['Section']),
        class_roll_no: str(r['Class Roll No.']),
        student_type: str(r['Student Type'])
          ? String(r['Student Type']).trim().toLowerCase().replace(/\s+/g, '_')
          : 'day_scholar',
        hostel_type: str(r['Hostel Type']),
        school_admission_no: str(r['School Admission No.']),

        // School info
        form_filling_date: parseDate(r['Form Filling Date']),
        star_information: str(r['Star Information']),
        concession_category: str(r['Concession Category']),
        dnd: toBool(r['Do Not Disturb (DND)']),
        house: str(r['House']),
        school_email: str(r['School Email']),

        // Father
        father_name: str(r['Fathers Name']),
        father_phone: fatherPhone,
        father_whatsapp: fatherWhatsapp,
        father_email: str(r['Father Email ID']),
        father_occupation: str(r['Father Occupation']),
        father_designation: str(r['Father Designation']),
        father_organization: str(r['Father Organization']),
        father_qualification: str(r['Father Qualification']),
        father_aadhar: str(r['Father Aadhar']),
        father_income: str(r['Father Income']),
        father_user_id: fatherUserId || undefined,

        // Mother
        mother_name: str(r['Mothers Name']),
        mother_phone: motherPhone,
        mother_whatsapp: motherWhatsapp,
        mother_email: str(r['Mother Email ID']),
        mother_occupation: str(r['Mother Occupation']),
        mother_organization: str(r['Mother Organization']),
        mother_aadhar: str(r['Mother Aadhar']),
        mother_user_id: motherUserId || undefined,

        // Guardian
        guardian_name: str(r['Fathers Name']) || str(r['Mothers Name']),
        guardian_phone: guardianPhone || fatherPhone || motherPhone,
        guardian_user_id: guardianUserId || undefined,

        // Address
        address: str(r['Residential Address']),
        city: str(r['City']),
        state: str(r['State']),
        country: str(r['Country']),
        pincode: str(r['Pincode']),

        // Identity
        student_aadhar: str(r['Student Aadhar No.']),
        biometric_id: str(r['Biometric ID']),
        nationality: str(r['Nationality']),
        religion: str(r['Religion']),
        caste: str(r['Caste']),
        sub_caste: str(r['Sub Caste']),
        caste_category: str(r['Caste Category']),
        mother_tongue: str(r['Mother Tongue']),

        // Financial
        bank_reference_no: str(r['Bank Reference No.']),
        fee_remarks: str(r['Fee Remarks']),
        fee_profile_type: str(r['Fee Profile Type']),
        bank_name: str(r['Bank Name']),
        ifsc_code: str(r['IFSC Code']),
        bank_account_no: str(r['Bank Account No']),

        // Misc
        food_habits: str(r['Food Habbits']),
        state_enrollment_no: str(r['State Enrollment No.']),
        birth_place: str(r['Birth Place']),
        language_spoken: str(r['Language Spoken']),
        sports: str(r['Sports']),
        second_language: str(r['II Language']),
        third_language: str(r['III Language']),

        // Previous school
        joining_class: str(r['Joining Class']),
        previous_school: str(r['Previous School']),
        previous_class: str(r['Previous Class']),
        previous_board: str(r['Previous Board of Education']),
        joining_academic_year: str(r['Joining Academic Year']),

        // Identification
        identification_marks_1: str(r['Identification Marks 1']),
        identification_marks_2: str(r['Identification Marks 2']),

        // Transport & documents
        transport_required: toBool(r['Transport Required']),
        description: str(r['Description']),
        tc_submitted: toBool(r['TC']),
        marksheet_submitted: toBool(r['Marksheet']),
        dob_certificate_submitted: toBool(r['DOB Certificate']),

        // WhatsApp & email
        whatsapp_no: studentWhatsapp,
        student_email: str(r['Student Email']),

        // Government IDs
        rte_student: toBool(r['RTE Student']),
        pen: str(r['PEN (Permanent Education Number']),
        udise: str(r['UDISE (Unified District Information System for Education Number']),
        apaar_id: str(r['APAAR ID']),

        // Medical
        is_asthmatic: toBool(r['Is the child Asthamatic']),
        allergies_medicine: str(r['Allergies (Medicine)']),
        allergies_food: str(r['Allergies (Food)']),
        vision: str(r['Vision']),
        medical_ailments: str(r['Any other Medical Ailments']),
        physical_handicap: str(r['Any Physical Handicap/Disability']),
        ongoing_treatment: str(r['Is the child undergoing any treatment such as cavities/braces etc']),
      };

      // Remove undefined values (so supabase doesn't send null for FK columns)
      for (const key of Object.keys(studentData)) {
        if (studentData[key] === undefined) delete studentData[key];
      }

      // ── 8. Insert (or update on duplicate admission_no) ──
      const { error: insertErr } = await supabase.from('students').insert(studentData);

      if (insertErr) {
        // If duplicate admission_no, try update instead
        if (
          insertErr.message?.includes('duplicate') ||
          insertErr.message?.includes('unique') ||
          insertErr.code === '23505'
        ) {
          const admissionNo = studentData.admission_no;
          if (admissionNo) {
            const { error: updateErr } = await supabase
              .from('students')
              .update(studentData)
              .eq('admission_no', admissionNo);
            if (updateErr) {
              console.error(`    [FAIL] Update also failed: ${updateErr.message}`);
              stats.failed++;
            } else {
              console.log(`    -> Updated (duplicate admission_no)`);
              stats.updated++;
            }
          } else {
            console.error(`    [FAIL] Duplicate but no admission_no to update by: ${insertErr.message}`);
            stats.failed++;
          }
        } else {
          console.error(`    [FAIL] ${insertErr.message}`);
          stats.failed++;
        }
      } else {
        stats.imported++;
      }
    } catch (err) {
      console.error(`    [ERROR] ${fullName} (SR ${srNumber}) — ${err.message}`);
      stats.failed++;
    }
  }

  // ── Summary ──
  console.log('\n════════════════════════════════════════════════');
  console.log('Import complete');
  console.log(`  Total rows:        ${total}`);
  console.log(`  Inserted:          ${stats.imported}`);
  console.log(`  Updated:           ${stats.updated}`);
  console.log(`  Failed:            ${stats.failed}`);
  console.log(`  Siblings detected: ${stats.siblingsDetected} (parent reuses)`);
  console.log(`  Unique parents:    ${phoneToParent.size} (by phone)`);
  console.log('════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
