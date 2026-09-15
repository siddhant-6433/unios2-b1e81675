import { useCallback } from "react";
import { displayPhone } from "@/lib/maskContact";

/**
 * CRM display helper: every staff view (counsellors, impersonation, and
 * super admins) paints 981****892. Search/call/WhatsApp still use the
 * stored number — this only formats what is on screen. Exports still
 * unmask for super_admin via maskContact's unmask flag.
 */
export function useDisplayPhone() {
  return useCallback(
    (value: string | null | undefined) => displayPhone(value, false),
    [],
  );
}
