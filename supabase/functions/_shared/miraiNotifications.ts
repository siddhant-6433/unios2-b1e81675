export async function notifyMiraiAdmissions(admin: any, input: { leadId: string; title: string; body: string; link?: string }) {
  const { data: profiles, error: profilesError } = await admin.from("profiles").select("user_id, campus");
  if (profilesError) throw profilesError;
  const profileIds = (profiles || []).filter((profile: any) => String(profile.campus || "").toLowerCase().includes("mirai"))
    .map((profile: any) => profile.user_id);
  const { data: superAdmins, error: adminsError } = await admin.from("user_roles").select("user_id").eq("role", "super_admin");
  if (adminsError) throw adminsError;
  const candidates = [...new Set([...profileIds, ...(superAdmins || []).map((row: any) => row.user_id)])];
  if (!candidates.length) return;
  const { data: roles, error: rolesError } = await admin.from("user_roles").select("user_id, role").in("user_id", candidates);
  if (rolesError) throw rolesError;
  const allowedRoles = new Set(["super_admin", "admission_head", "campus_admin"]);
  const userIds = [...new Set((roles || []).filter((row: any) => allowedRoles.has(row.role)).map((row: any) => row.user_id))];
  if (!userIds.length) return;
  const { error } = await admin.from("notifications").insert(userIds.map(user_id => ({
    user_id,
    type: "general",
    title: input.title,
    body: input.body,
    link: input.link || "/admissions",
    lead_id: input.leadId,
  })));
  if (error) throw error;
}
