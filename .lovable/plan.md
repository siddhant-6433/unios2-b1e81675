

## Plan: Insert Eligibility Rules & Upgrade Subject/Degree Input

### 1. Insert Eligibility Rules into Database

Insert rules for all non-school courses using the data migration tool. Here is the mapping from the sheet:

| Course | Code | 12th Min % | Grad Min % | Requires Grad | Min Age | Max Age | Subject Prereqs | Entrance Exam | Mandatory |
|---|---|---|---|---|---|---|---|---|---|
| BMRIT | BMRIT | — | — | No | 17 | — | PCB | CPET | Yes |
| MMRIT | MMRIT | — | 50 | Yes | 17 | — | — | CPMET | No |
| DPT | DPT | 35 | — | No | 17 | — | PCB, PCM | NEET, NAT | No |
| BPT | BPT | 50 | — | No | 17 | — | PCB | CPET | Yes |
| MPT | MPT | — | 50 | Yes | 17 | — | — | CPMET | No |
| OTT | OTT | 35 | — | No | 17 | — | PCB, PCM | NEET, NAT | No |
| D.Pharma | DPHAR | — | — | No | — | — | PCB, PCM | JEECUP, NAT | Yes |
| B.Sc Nursing | BSCN | 45 | — | No | 17 | 35 | PCB | CNET | Yes |
| GNM | GNM | 40 | — | No | 17 | 35 | Any Stream (English Mandatory) | UPGET | Yes |
| B.Ed GN | BED-GN | — | 50 | Yes | — | — | — | JEEB.Ed | Yes |
| B.Ed SN | BED-SN | — | 50 | Yes | — | — | — | JEEB.Ed | Yes |
| B.Ed KP | BED-KP | — | 50 | Yes | — | — | — | PTET | Yes |
| D.El.Ed | DELED | — | — | Yes | — | — | — | UP D.El.Ed Counselling | Yes |
| BALLB | BALLB | 44.5 | — | No | — | — | Any Stream | CLAT, LSAT, NAT | No |
| LLB GN | LLB-GN | — | 45 | Yes | — | — | — | CLAT, LSAT, NAT | No |
| LLB KP | LLB-KP | — | 45 | Yes | — | — | — | CLAT, LSAT, NAT | No |
| MBA | MBA | — | 50 | Yes | — | — | — | CAT, MAT, UPSEE, GMAT | No |
| PGDM GN | PGDM-GN | — | 50 | Yes | — | — | — | CAT, MAT, GMAT | No |
| PGDM KP | PGDM-KP | — | 50 | Yes | — | — | — | CAT, MAT, GMAT | No |
| BBA | BBA | — | — | No | — | — | Any Stream | CUET UG | No |
| BCA | BCA | — | — | No | — | — | Any Stream | CUET UG | No |

Notes will include category-specific relaxations (SC/ST/OBC) from the sheet.

### 2. Upgrade Class 12 Subject Input to Multi-Select Tags

**`src/components/apply/AcademicDetails.tsx`**
- Replace the free-text "Subjects / Stream" `<input>` with a **tag/bubble multi-select** component
- Predefined subject list: Physics, Chemistry, Biology, Mathematics, English, Hindi, Economics, Accountancy, Business Studies, History, Political Science, Geography, Computer Science, Sociology, Psychology, Physical Education, Home Science
- Allow typing to filter + add custom subjects not in the list
- Store selected subjects as a comma-separated string in `academic_details.class_12.subjects` (backward compatible)

### 3. Upgrade Graduation Degree Input to Predefined + Custom

**`src/components/apply/AcademicDetails.tsx`**
- Replace the free-text "Degree" field in the graduation block with a **searchable dropdown with custom entry**
- Predefined degrees: B.A., B.Sc., B.Com., BBA, B.Tech., B.E., BCA, BPT, B.Sc. Nursing, B.Pharm., LLB, B.Ed., MBBS, Any other
- Allow typing a custom degree name if not in the list

### 4. Update Validation Logic for Subject Matching

**`src/components/apply/eligibilityRules.ts`**
- Add a subject group expansion map:
  - `PCB` → requires Physics, Chemistry, Biology
  - `PCM` → requires Physics, Chemistry, Mathematics
  - `Any Stream` → no restriction (always passes)
- Update `validateAcademicEligibility` to expand prerequisite groups and check if the applicant's selected subjects contain all required subjects for at least one group
- Example: prerequisite `["PCB", "PCM"]` means student needs either (Physics+Chemistry+Biology) OR (Physics+Chemistry+Mathematics)

### 5. New Reusable Component

**`src/components/apply/SubjectTagInput.tsx`** (new)
- A tag/bubble input component with:
  - Clickable predefined subject chips
  - Search/filter as you type
  - Remove tags by clicking X
  - Support for adding custom values
- Used for both Class 12 subjects and potentially graduation subjects

