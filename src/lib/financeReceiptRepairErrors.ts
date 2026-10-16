export type ReceiptRepairRetryAction = "retry" | "reload" | null;

export function classifyReceiptRepairError(error: unknown): {
  message: string;
  action: ReceiptRepairRetryAction;
} {
  const details = error && typeof error === "object"
    ? error as { message?: unknown; code?: unknown }
    : {};
  const message = typeof details.message === "string" && details.message.trim()
    ? details.message
    : "Please try again.";
  const normalizedMessage = message.toLowerCase();
  const code = typeof details.code === "string" ? details.code.toUpperCase() : "";

  if (normalizedMessage.includes("matches multiple students")
    || normalizedMessage.includes("cannot be uniquely verified")
    || normalizedMessage.includes("multiple active students")) {
    return {
      message: "More than one student matches these application details. Ask Admissions to resolve the duplicate student records before linking this receipt.",
      action: null,
    };
  }

  if (code === "40001" || normalizedMessage.includes("changed") || normalizedMessage.includes("out of date")) {
    return {
      message: "The receipt details changed while this review was open. Reload the receipt and verify the student again.",
      action: "reload",
    };
  }

  const retryableCode = code.startsWith("08")
    || code.startsWith("40")
    || code === "55P03"
    || code.startsWith("57")
    || ["PGRST000", "PGRST001", "PGRST002", "PGRST003"].includes(code);
  const transientMessage = /failed to fetch|network|timed? ?out|temporar|connection (?:reset|refused|closed)|service unavailable|\b50[234]\b/i.test(message);

  return { message, action: retryableCode || transientMessage ? "retry" : null };
}
