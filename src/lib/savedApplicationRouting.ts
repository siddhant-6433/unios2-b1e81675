import type { PortalId } from "@/components/apply/portalConfig";

/** Legacy applications must be classified from saved ownership, never the host. */
export async function selectSavedApplications<T extends { application_id: string; lead_id?: string; flags?: string[] }>(
  applications: T[], portal: PortalId,
  resolve: (application: T) => Promise<{ portal: PortalId; mirai_rollout_enabled: boolean }>,
) {
  const rows = await Promise.all(applications.map(async application => {
    const result = await resolve(application);
    return { application, owner: result.portal, enabled: result.mirai_rollout_enabled };
  }));
  const matching = rows.filter(row => row.owner === portal).map(row => row.application);
  const foreign = new Set(rows.map(row => row.owner));
  return {
    applications: matching,
    redirectPortal: !matching.length && foreign.size === 1 && rows.every(row => row.enabled)
      ? rows[0]?.owner : undefined,
  };
}
