const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load .env manually as we're running a raw node script
const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) env[key.trim()] = value.trim().replace(/"/g, '');
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
  console.log('--- CAMPUSES ---');
  const { data: campuses, error: cErr } = await supabase.from('campuses').select('id, name');
  if (cErr) console.error('Campuses Error:', cErr);
  else console.log(campuses);

  console.log('\n--- INSTITUTIONS ---');
  const { data: insts, error: iErr } = await supabase.from('institutions').select('id, name, campus_id, type');
  if (iErr) console.error('Institutions Error:', iErr);
  else console.log(insts);

  console.log('\n--- COURSES (First 50) ---');
  const { data: courses, error: coErr } = await supabase.from('courses').select('id, name, code, department_id').limit(50);
  if (coErr) console.error('Courses Error:', coErr);
  else console.log(courses);
}

checkData();
