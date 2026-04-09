import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://deylhigsisuexszsmypq.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3ODQwOCwiZXhwIjoyMDg4MzU0NDA4fQ.wjV_8veUrjdJO__Uv1and4Ij5LiB5My9DEWrhyM9Jr8';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
  global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
});

const consultants = [
  { name: 'Vicky Prajapati', phone: '7836888381', city: 'Jalpura Gr. Noida' },
  { name: 'Imran', phone: '9911259934', city: 'Delhi' },
  { name: 'Prasannjeet Kumar', phone: '9971262737', city: 'Vashali Sec - 4' },
  { name: 'Santosh Public School', phone: '9818992096', city: 'Bisrakh Gr. Noida' },
  { name: 'Anuj Sharma', phone: '9910747594', city: 'Haldoni, Kuleshara' },
  { name: 'Gargee Global Computer', phone: '8178599981', city: 'Surajpur Gr.Noida' },
  { name: 'Shivam Sharma', phone: '8510001813', city: 'Jagat farm' },
  { name: 'Student help corner', phone: '9546369339', city: 'Alpha-2' },
  { name: 'Peaveen kumar', phone: '6398364096', city: 'Alpha-1' },
  { name: 'English Master', phone: '7042249521', city: 'Bulandsher' },
  { name: 'Anant Institute & Education', phone: '8527810536', city: 'Ghaziabad' },
  { name: 'A.K. Royal Jan Siva Kindra', phone: '8510001290', city: 'Bisrakh Gr. Noida' },
  { name: 'Anshu Dixit', phone: '9598689216', city: 'Alpha-1' },
  { name: 'Navneet Singh', phone: '7011079660', city: 'Bhangel Noida' },
  { name: 'Dr. Shahabuddin Usmani', phone: '9810842729', city: 'New Delhi' },
  { name: 'Bright Institute', phone: '9310012005', city: 'Surajpur Gr.Noida' },
  { name: 'Excellet Education Hub', phone: '9999222214', city: 'Haldoni, Kuleshara' },
  { name: 'Global computer', phone: '9953932693', city: 'Saqlarpur Gr. Noida' },
  { name: 'Kashvi Chauhan', phone: '8700724754', city: 'Sec-53' },
  { name: 'Deepak kr Singh', phone: '9999323310', city: 'Dharam Plaza Sec-1' },
  { name: 'Vikash Kumar Jha', phone: '9819189790', city: 'Sadarpur Sec-45' },
  { name: 'Avinash Mishra', phone: '7546007584', city: 'Jalpura Gr. Noida' },
  { name: 'Raj pathak Sir', phone: '9625180677', city: 'Jalpura Gr. Noida' },
  { name: 'Satish kr', phone: '8544144687', city: 'Patna' },
  { name: 'Lovely choudhary', phone: '9319137076', city: 'Bulandsher' },
  { name: 'Gyan Niketan High school', phone: '6299289688', city: 'Gola road patna' },
  { name: 'Saraswati Library', phone: '8057186503', city: 'Bulandsahar' },
  { name: 'Balraj singh sir', phone: '9536516704', city: 'Bulandsahar' },
  { name: 'Shaneen Academy Noida', phone: '9711414250', city: 'Kulesara' },
  { name: 'S S Library', phone: '8527838953', city: 'Bhangel Noida' },
  { name: 'Saraswati Library (Bhangel)', phone: '8920791250', city: 'Bhangel Noida' },
  { name: 'Lal Bahadur training institue', phone: '8077035319', city: 'Dadri' },
  { name: 'OM CTI', phone: '9289482081', city: 'Sadarpur Sec-45' },
  { name: 'Guru jee commerce Class', phone: '8383969908', city: 'Sadarpur Sec-45' },
  { name: 'A 2 Z Education Consultancy', phone: '9910313236', city: 'Sadarpur Sec-45' },
  { name: 'Genius Computer Classes', phone: '9319058612', city: 'Kulesara' },
  { name: 'Genius coaching classes', phone: '8271223170', city: 'Bhangel Noida' },
  { name: 'Chandan Kumar sir', phone: '7838160814', city: 'Kulesara' },
  { name: 'Mustakeem Malik', phone: '9818889588', city: 'Dadri' },
  { name: 'Build skill Acedemy', phone: '8799708172', city: 'Haldoni, Kuleshara' },
  { name: 'Shruansh Sir', phone: '7052440018', city: 'Noida sec 45' },
  { name: 'Vishal commece classes', phone: '9889999391', city: 'Jankipuram laknow' },
  { name: 'Amit Sir', phone: '9214094848', city: 'Jankipuram laknow' },
  { name: 'Rahul Pandey', phone: '9305494408', city: 'Jankipuram laknow' },
  { name: 'G N S Education', phone: '9005098484', city: 'Noida suraj pur' },
  { name: 'JBS Enterprises Surajpur', phone: '9990272932', city: 'Surajpur Gr.Noida' },
  { name: 'Ishtiyaq Ahamad', phone: '9958086009', city: 'Gr Noida' },
  { name: 'Imran Sir', phone: '9911259934', city: 'Janakpuri Delhi' },
  { name: 'Khushi Digital seva kendra', phone: '9319780398', city: 'Sadarpur Sec-45' },
  { name: 'Raj Cyber café', phone: '9015932549', city: 'Surajpur Gr.Noida' },
  { name: 'Bhagat singh Comp Instute', phone: '9412610275', city: 'Khurja' },
  { name: 'Kartik Cyber café', phone: '9058195434', city: 'Noida' },
  { name: 'S K Foundation', phone: '9758363431', city: 'Noida' },
  { name: 'Gigorial Startup', phone: '9910796075', city: 'Noida' },
  { name: 'Admission Service PVT Ltd', phone: '8588082989', city: 'Noida' },
  { name: 'Manglam cyber café', phone: '9410003637', city: 'Ghaziabad' },
  { name: 'Star coaching Center', phone: '9675279284', city: 'Dadri' },
  { name: 'Bageshwari public school', phone: '9716614180', city: 'Sadarpur Sec-45' },
  { name: 'Jeet Acedemy', phone: '9971650193', city: 'Govind puram' },
  { name: 'Gyandeep Acedemy', phone: '7428346440', city: 'Govindpuram ghaziabaad' },
  { name: 'New Tech Computer', phone: '9927008616', city: 'Bulandsahar' },
  { name: 'Royal Cyber café', phone: '9837555442', city: null },
];

async function main() {
  // Check for existing consultants by phone to avoid duplicates
  const { data: existing } = await supabase
    .from('consultants')
    .select('phone');

  const existingPhones = new Set((existing || []).map(c => c.phone).filter(Boolean));

  const toInsert = consultants
    .filter(c => !existingPhones.has(c.phone))
    .map(c => ({
      name: c.name,
      phone: c.phone,
      city: c.city,
      stage: 'active',
      commission_type: 'percentage',
      commission_value: 0,
    }));

  if (toInsert.length === 0) {
    console.log('All consultants already exist. Nothing to insert.');
    return;
  }

  console.log(`Inserting ${toInsert.length} new consultants (${consultants.length - toInsert.length} already exist)...`);

  const { data, error } = await supabase
    .from('consultants')
    .insert(toInsert)
    .select('id, name, phone, city');

  if (error) {
    console.error('Insert error:', error);
    process.exit(1);
  }

  console.log(`Successfully added ${data.length} consultants:`);
  data.forEach(c => console.log(`  - ${c.name} (${c.phone}) — ${c.city}`));
}

main().catch(console.error);
