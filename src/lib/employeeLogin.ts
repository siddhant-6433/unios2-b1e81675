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
  { value: "hr_executive", label: "HR Executive" },
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

/** Every role a user currently holds (additive). */
export async function getUserRoles(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { role: string }).role);
}

/** Add a role (idempotent). Writes are super_admin-only by RLS. */
export async function addUserRole(userId: string, role: string): Promise<void> {
  const { error } = await supabase
    .from("user_roles")
    .upsert({ user_id: userId, role } as never, { onConflict: "user_id,role", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/** Remove one role. Writes are super_admin-only by RLS. */
export async function removeUserRole(userId: string, role: string): Promise<void> {
  const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role as never);
  if (error) throw new Error(error.message);
}

export interface ExistingUserMatch {
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
}

/**
 * Link an existing auth user to an employee_profiles row (the "map" operation).
 * .select() so an RLS-filtered no-op surfaces as 0 rows instead of a silent
 * success. Throws on failure.
 */
export async function linkEmployeeLogin(employeeProfileId: string, userId: string): Promise<void> {
  const { data: linked, error: linkErr } = await supabase
    .from("employee_profiles")
    .update({ user_id: userId } as never)
    .eq("id", employeeProfileId)
    .select("id");
  if (linkErr || !linked?.length) {
    throw new Error("Could not link the account to this employee.");
  }
}

/**
 * Detect an existing account for this email OR phone before creating a
 * duplicate. Goes through invite-user's lookup mode because the underlying RPC
 * is service-role only. Returns the match, or null if none.
 */
export async function lookupExistingUser(args: {
  email: string;
  phone?: string;
  role: string;
}): Promise<ExistingUserMatch | null> {
  const { data, error } = await supabase.functions.invoke("invite-user", {
    body: { lookup: true, email: args.email, phone: args.phone || undefined, role: args.role },
  });
  if (error) throw new Error(error.message || "Could not check for an existing account.");
  const res = data as { existing?: boolean } & ExistingUserMatch | null;
  return res?.existing ? { user_id: res.user_id, display_name: res.display_name, email: res.email, phone: res.phone, role: res.role } : null;
}

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
  notify?: boolean; // send the WhatsApp + email welcome (default true, invite-user side)
}): Promise<string> {
  const { data: inv, error: invErr } = await supabase.functions.invoke("invite-user", {
    body: {
      email: args.email,
      role: args.role,
      display_name: args.displayName || undefined,
      phone: args.phone || undefined,
      campus: args.campus || undefined,
      notify: args.notify,
    },
  });
  const newUserId = (inv as { user_id?: string } | null)?.user_id;
  if (invErr || !newUserId) {
    throw new Error(invErr?.message || "Could not create the account. Check the email and your permission to invite users.");
  }

  await linkEmployeeLogin(args.employeeProfileId, newUserId);
  return newUserId;
}

/**
 * Re-send the "your login is ready" WhatsApp + email to an existing user.
 * Callable by super_admin or hr:employees_edit (enforced server-side).
 */
export async function resendLoginNotice(userId: string): Promise<{ whatsapp_sent: boolean; email_sent: boolean }> {
  const { data, error } = await supabase.functions.invoke("resend-login-notice", {
    body: { user_id: userId },
  });
  if (error) throw new Error(error.message || "Could not resend the login notification.");
  const res = (data as { whatsapp_sent?: boolean; email_sent?: boolean } | null) ?? {};
  return { whatsapp_sent: !!res.whatsapp_sent, email_sent: !!res.email_sent };
}
