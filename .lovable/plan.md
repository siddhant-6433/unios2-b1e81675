

## Plan: Imitate Reference UI Style

The reference screenshots show a polished "Orchid CRM"-style UI with several key differences from the current app. Here is what needs to change:

### 1. Sidebar Restructure (`src/components/layout/AppSidebar.tsx`)
- Add a **campus selector dropdown** below the logo (e.g., "NIMT Greater Noida" with a chevron)
- Reorganize navigation into three labeled sections:
  - **MAIN MENU**: Overview, Admissions, Attendance, Exams, CRM, Schedule, Students, Messages (with unread badge count), Finance, Reports
  - **SETTINGS AND NEWS**: Campus News
  - **ACCOUNT**: User avatar + name + role at the bottom
- Change **active state** from filled teal (`bg-primary`) to a subtle left-border accent or light background highlight (matching the reference's understated active style)
- Use `Phone` icon for CRM, `Calendar` icon for Schedule, `MessageSquare` for Messages

### 2. Sidebar Active Style Update
- Replace the current `!bg-primary !text-primary-foreground` active class with a softer style: left border accent + light background (`border-l-2 border-primary bg-muted/50 text-foreground font-semibold`)

### 3. Student Profile Page (`src/pages/StudentProfile.tsx`)
- Add a **student header** with large avatar, name with dropdown chevron, and subtitle "Here's a look at your performance and analytics."
- Add a **Filter** button in the top-right
- Replace current stats layout with **3 horizontal stat cards** in a row:
  - **Growth**: "+10% Students in total" with a mini sparkline
  - **Exams**: "19.32 Average score" with mini bar chart
  - **Activity**: "8 Present, 3 Absent, 12 Events" with color-coded dots
- Add an **Assignments section** with 4 summary cards (Not-checked, Not-delivered, Not-completed, Completed) showing counts
- Add a **Last assignments table** with columns: Assignment name, Time, Status (color-coded badges)

### 4. Attendance Page (`src/pages/Attendance.tsx`)
- Restructure into a **2-column layout**:
  - **Left**: Calendar month view (using a grid-based calendar component) + attendance/absence summary bars below
  - **Right**: Scrollable student list with colored avatar circles and chevrons
- Calendar should highlight today with primary color circle, show dots for days with attendance data
- Attendance summary shows green bar for attendance (e.g., "23/24") and red/orange bar for absences ("1/24")

### 5. Global Style Tweaks (`src/index.css`)
- Slightly adjust the background to be warmer/lighter to match the reference's clean white aesthetic
- Ensure cards have minimal shadow (already mostly done)

### 6. Header Update (`src/components/layout/AppLayout.tsx`)
- Keep current breadcrumb style (already matches well)
- Ensure notification/message/search icons are in the top-right (already done)

### Files to modify:
1. `src/components/layout/AppSidebar.tsx` - Restructure nav, add campus selector, update active style
2. `src/pages/StudentProfile.tsx` - New stats cards, assignments section, profile header
3. `src/pages/Attendance.tsx` - Calendar + student list 2-column layout, summary bars
4. `src/index.css` - Minor background/spacing tweaks

