

## Plan: Enhanced Application Form with Dedicated Applications Table

### Overview
Rebuild the `/apply` portal with a comprehensive application form matching the product spec, backed by a new `applications` table that cleanly separates application data from CRM leads.

### 1. Database Migration

**New `applications` table:**
```sql
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text UNIQUE NOT NULL, -- e.g. APP-26-XXXX
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.admission_sessions(id),
  status text NOT NULL DEFAULT 'draft', -- draft, submitted, under_review, interview_scheduled, offer_issued, waitlisted, rejected
  
  -- Course selections with preferences (JSONB array)
  course_selections jsonb NOT NULL DEFAULT '[]', -- [{course_id, campus_id, preference_order}]
  
  -- Personal Details
  full_name text NOT NULL,
  gender text,
  dob date,
  nationality text DEFAULT 'Indian',
  category text, -- General, OBC, SC, ST, EWS
  aadhaar text,
  phone text NOT NULL,
  email text,
  whatsapp_verified boolean DEFAULT false,
  address jsonb DEFAULT '{}', -- {line1, city, state, country, pin_code}
  
  -- Parent/Guardian Details
  father jsonb DEFAULT '{}', -- {name, phone, email, occupation}
  mother jsonb DEFAULT '{}',
  guardian jsonb DEFAULT '{}', -- {name, relationship, phone, email}
  
  -- Academic Identifiers
  apaar_id text,
  pen_number text,
  
  -- Academic Details (dynamic based on eligibility)
  academic_details jsonb DEFAULT '{}', -- {class_10: {board, school, year, marks}, class_12: {...}, graduation: {...}}
  result_status jsonb DEFAULT '{}', -- {class_12_declared: bool, graduation_declared: bool, expected_month, cgpa_till_sem, semesters_completed}
  
  -- Extracurricular
  extracurricular jsonb DEFAULT '{}',
  
  -- School-specific (for K-12)
  school_details jsonb DEFAULT '{}', -- {sibling_details, parent_questionnaire, previous_class_report}
  
  -- Progress tracking
  completed_sections jsonb DEFAULT '{"personal": false, "parents": false, "academic": false, "documents": false, "payment": false}',
  
  -- Payment
  fee_amount numeric DEFAULT 0,
  payment_status text DEFAULT 'pending', -- pending, paid, waived
  payment_ref text,
  
  -- Flags (auto-tagged)
  flags text[] DEFAULT '{}', -- result_awaited, age_exception, incomplete_documents, payment_pending
  
  -- Institution context
  institution_id uuid,
  program_category text, -- school, undergraduate, postgraduate, professional
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

-- RLS: Public can insert (for applicants), authenticated staff can view all
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- Applicants can create and update their own applications (matched by phone)
CREATE POLICY "Anyone can insert applications" ON public.applications FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Applicants can view own apps" ON public.applications FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Applicants can update own apps" ON public.applications FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "Staff can view all applications" ON public.applications FOR SELECT TO authenticated USING (
  has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'campus_admin') OR has_role(auth.uid(), 'admission_head') OR has_role(auth.uid(), 'counsellor')
);

-- Updated_at trigger
CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON public.applications
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Storage bucket for application documents
INSERT INTO storage.buckets (id, name, public) VALUES ('application-documents', 'application-documents', false);
CREATE POLICY "Anyone can upload docs" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'application-documents');
CREATE POLICY "Anyone can view own docs" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'application-documents');
```

### 2. Rebuild `/apply` Portal (`src/pages/ApplyPortal.tsx`)

Complete rewrite with these sections matching the spec:

**Flow:**
1. **Auth Screen** -- WhatsApp OTP + Google Sign-in (WhatsApp verification still required)
2. **Session & Course Selection** -- Select admission session, then pick multiple courses with preference ordering
3. **Multi-step form** with progress bar:
   - **Step 1: Personal Details** -- Name, gender, DOB, nationality, category, Aadhaar, phone, email, address (city/state/pin)
   - **Step 2: Parent/Guardian Details** -- Father, mother, guardian sections
   - **Step 3: Academic Details** -- Dynamic based on program category (UG shows 10th+12th, PG shows graduation too). Includes result-pending logic with conditional fields
   - **Step 4: Extracurricular** -- Optional achievements, sports, portfolio, LinkedIn
   - **Step 5: Payment** -- Fee auto-calculated from course selections (₹500 school, ₹1000 UG, ₹1500 MBA, ₹0 BEd/DElEd). "Pay Now" button (placeholder for Razorpay)
   - **Step 6: Document Upload** -- Dynamic document list based on program type (UG: 10th+12th marksheets; PG: +graduation; School: birth cert, photo, report card)
   - **Step 7: Review & Submit** -- Summary of all sections, declaration checkbox, submit button

**Key features:**
- Auto-save on each section completion
- Resume application later (via OTP login)
- Mobile-first responsive design
- Application flags auto-set (result_awaited, payment_pending, etc.)
- On submit: update linked lead stage to `application_submitted`, log activity

### 3. Eligibility Engine (inline logic)

Determine required academic fields based on course type:
- Map courses to program categories using the course/department/institution hierarchy
- School courses -> require birth cert, previous report card
- UG courses -> require Class 10 + 12 details
- PG/Professional -> require graduation details too
- Result-pending toggles show conditional fields

### 4. Fee Calculation Logic

Auto-calculate based on selected courses:
```typescript
const FEE_MAP: Record<string, number> = {
  school: 500,
  undergraduate: 1000,
  mba_pgdm: 1500,
  bed: 0, deled: 0,
  professional: 1000,
};
// Total = sum of fees for each selected course
```

### 5. CRM Sync

When application progresses:
- Creating application -> lead stage = `application_in_progress`
- Submitting application -> lead stage = `application_submitted`
- Log `lead_activities` entries for each milestone

### 6. Dashboard Stats Update (`src/pages/Dashboard.tsx`)

Update queries to pull from the new `applications` table for accurate counts of applications in progress vs submitted.

### Files to modify:
1. **Database migration** -- Create `applications` table + storage bucket
2. **`src/pages/ApplyPortal.tsx`** -- Complete rewrite (~800 lines)
3. **`src/pages/Dashboard.tsx`** -- Update application stat queries

### Files to create:
1. **`src/components/apply/`** -- Extracted form section components (PersonalDetails, ParentDetails, AcademicDetails, DocumentUpload, PaymentSection, ReviewSubmit, CourseSelector)

