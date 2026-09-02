import { describeWhatsAppError } from "@/lib/whatsappErrorText";

export type WhatsAppDeliveryOutcome =
  | { status: "delivered" | "read" }
  | { status: "failed"; errorText: string }
  | { status: "timeout" };

type MessageRow = {
  status: string | null;
  status_error: unknown;
  read_at: string | null;
};

const SUCCESS = new Set(["delivered", "read"]);

export function interpretWhatsAppMessageStatus(row: MessageRow | null): WhatsAppDeliveryOutcome | "pending" {
  if (!row) return "pending";
  const status = String(row.status || "").toLowerCase();
  if (status === "failed") {
    return {
      status: "failed",
      errorText: describeWhatsAppError(row.status_error)?.text || "Meta reported the test as failed.",
    };
  }
  if (SUCCESS.has(status) || row.read_at) {
    return { status: status === "read" ? "read" : "delivered" };
  }
  return "pending";
}

/**
 * Poll the outbound row until Meta's webhook marks it delivered/read/failed.
 * Receipts usually arrive in a few seconds; some numbers never send them.
 */
export async function waitForWhatsAppDelivery(
  lookup: (waMessageId: string) => Promise<MessageRow | null>,
  waMessageId: string,
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<WhatsAppDeliveryOutcome> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (options.signal?.aborted) return { status: "timeout" };
    const row = await lookup(waMessageId);
    const result = interpretWhatsAppMessageStatus(row);
    if (result !== "pending") return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const last = await lookup(waMessageId);
  const result = interpretWhatsAppMessageStatus(last);
  return result === "pending" ? { status: "timeout" } : result;
}
