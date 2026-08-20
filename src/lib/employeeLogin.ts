// Provision an auth login for an HR employee: invite-user creates the account,
// then we back-fill employee_profiles.user_id so the employee shows up in the
// admin panel. Used from the verify queue (on verify) and the employee profile
// dialog (on demand, for already-verified staff).

import { supabase } from "@/integrations/supabase/client";

// Roles a login may be provisioned for. Deliberately excludes super_admin /
// campus_admin so an HR editor can't mint an admin — invite-user enforces the
// SAME allow-list server-side for non-super-admin callers
// (supabase/functions/invite-user/index.ts). Keep the two in sync.
export const PROVISIONABLE_ROLES: { value: string; label: string }[] = [
  { value: "principal", label: "Principal" },
  { value: "admission_head", label: "Admission Head" },
  { value: "counsellor", label: "Counsellor" },
  { value: "accountant", label: "Accountant" },
  { value: "faculty", label: "Faculty" },
  { value: "teacher", label: "Teacher" },
  { value: "data_entry", label: "Data Entry" },
  { value: "office_admin", label: "Office Administrator" },
  { value: "office_assistant", label: "Office Assistant" },
  { value: "school_coordinator", label: "School Coordinator" },
  { value: "hostel_warden", label: "Hostel Warden" },
  { value: "librarian", label: "Librarian" },
];

/**
 * Create an auth login for an employee and link it back to their
 * employee_profiles row. Returns the new user_id. Throws with a human-readable
 * message on any failure (invite failed, or the back-fill hit RLS).
 */
export async function provisionEmployeeLogin(args: {
  employeeProfileId: string;
  email: string;
  role: string;
  displayName?: string;
  phone?: string;
  campus?: string;
}): Promise<string> {
  const { data: inv, error: invErr } = await supabase.functions.invoke("invite-user", {
    body: {
      email: args.email,
      role: args.role,
      display_name: args.displayName || undefined,
      phone: args.phone || undefined,
      campus: args.campus || undefined,
    },
  });
  const newUserId = (inv as { user_id?: string } | null)?.user_id;
  if (invErr || !newUserId) {
    throw new Error(invErr?.message || "Could not create the account. Check the email and your permission to invite users.");
  }

  // Back-fill the link. .select() so an RLS-filtered no-op surfaces as 0 rows
  // instead of a silent success.
  const { data: linked, error: linkErr } = await supabase
    .from("employee_profiles")
    .update({ user_id: newUserId } as never)
    .eq("id", args.employeeProfileId)
    .select("id");
  if (linkErr || !linked?.length) {
    throw new Error("The account was created but could not be linked to this employee.");
  }
  return newUserId;
}
