import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { canUnmaskContact, displayPhone } from "@/lib/maskContact";

/**
 * CRM display helper: counsellors and other staff see 981****892.
 * Super admins (real role, ignoring impersonation) see the stored number.
 * Search/call/WhatsApp still use the real value from the row — this only
 * formats what is painted on screen.
 */
export function useDisplayPhone() {
  const { realRole } = useAuth();
  const unmask = canUnmaskContact(realRole);
  return useCallback(
    (value: string | null | undefined) => displayPhone(value, unmask),
    [unmask],
  );
}
