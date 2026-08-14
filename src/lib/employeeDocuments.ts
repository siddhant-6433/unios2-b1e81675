// Document state, as pure functions.
//
// The interesting logic is not the upload — it's deciding what a person still owes
// and what is about to lapse, which is what Keka's left rail counts. Kept out of the
// component so it can be tested without a browser or a database.

export type DocStatus = "missing" | "pending" | "verified" | "rejected";

export interface DocType {
  code: string;
  name: string;
  folder: string;
  is_mandatory: boolean;
  has_expiry: boolean;
  sort_order: number;
}

export interface DocRow {
  id: string;
  doc_key: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  status: string;
  review_note: string | null;
  issued_on: string | null;
  expires_on: string | null;
  uploaded_at: string;
}

export interface DocSlot {
  type: DocType;
  doc: DocRow | null;
  status: DocStatus;
  /** Days until expiry; null when it never expires or hasn't been uploaded. */
  daysToExpiry: number | null;
  expiry: "none" | "valid" | "expiring" | "expired";
}

/** Whole days from today to an ISO date. Negative once it's in the past. */
export function daysUntil(iso: string | null | undefined, today = new Date()): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d).getTime();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - start) / 86_400_000);
}

/** Anything inside 30 days is worth flagging — the same window MyDocs uses. */
export function expiryState(days: number | null): DocSlot["expiry"] {
  if (days === null) return "none";
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "valid";
}

/**
 * One slot per catalogue entry, whether or not a file exists. A missing document
 * has to be as visible as a rejected one — "nothing uploaded" is the common case
 * and the whole point of the pending list.
 */
export function buildSlots(types: DocType[], docs: DocRow[], today = new Date()): DocSlot[] {
  const byKey = new Map(docs.map((d) => [d.doc_key, d]));
  return [...types]
    .sort((a, b) => Number(b.is_mandatory) - Number(a.is_mandatory) || a.sort_order - b.sort_order)
    .map((type) => {
      const doc = byKey.get(type.code) ?? null;
      const status = (doc ? doc.status : "missing") as DocStatus;
      const daysToExpiry = doc ? daysUntil(doc.expires_on, today) : null;
      return { type, doc, status, daysToExpiry, expiry: expiryState(daysToExpiry) };
    });
}

/** Still owed: never uploaded, or sent back. A pending review is not outstanding. */
export function outstanding(slots: DocSlot[]): DocSlot[] {
  return slots.filter((s) => s.status === "missing" || s.status === "rejected");
}

export function mandatoryOutstanding(slots: DocSlot[]): DocSlot[] {
  return outstanding(slots).filter((s) => s.type.is_mandatory);
}

/** Folder → slots, in catalogue order, skipping folders with nothing in them. */
export function byFolder(slots: DocSlot[]): { folder: string; slots: DocSlot[]; uploaded: number }[] {
  const map = new Map<string, DocSlot[]>();
  for (const s of slots) {
    const list = map.get(s.type.folder);
    if (list) list.push(s);
    else map.set(s.type.folder, [s]);
  }
  return [...map.entries()]
    .map(([folder, list]) => ({
      folder,
      slots: list,
      uploaded: list.filter((s) => s.doc).length,
    }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

export const STATUS_LABEL: Record<DocStatus, string> = {
  missing: "Not uploaded",
  pending: "Awaiting review",
  verified: "Verified",
  rejected: "Rejected",
};

/** `<employee_profile_id>/<doc_key>-<stamp>.<ext>` — the folder is the RLS key. */
export function documentPath(employeeProfileId: string, docKey: string, fileName: string, stamp: number): string {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "bin";
  return `${employeeProfileId}/${docKey}-${stamp}.${ext}`;
}
