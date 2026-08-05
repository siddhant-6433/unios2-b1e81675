// StudentAvatar — the candidate's photo, with initials as the fallback.
//
// Used wherever staff or a family needs to confirm they are looking at the
// right person: the cashier counter, the student dashboard, and the payment
// page. 234 of 328 students have a photo, so the initials path is a real state,
// not an edge case.
//
// photo_url is a public storage URL but the students row it hangs off is
// RLS-protected, so only someone who can already read the student sees it.

import { useState } from "react";

interface Props {
  /** students.photo_url (photo_processed_url is not populated in production). */
  src?: string | null;
  name?: string | null;
  /** Tailwind size + shape, e.g. "h-12 w-12 rounded-full". */
  className?: string;
}

export function StudentAvatar({ src, name, className = "h-12 w-12 rounded-full" }: Props) {
  // A stale or deleted storage object would otherwise render a broken-image
  // icon next to someone's fee bill.
  const [failed, setFailed] = useState(false);

  const initials = (name || "")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name || "Student photo"}
        onError={() => setFailed(true)}
        className={`shrink-0 border border-border object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-primary/10 font-bold text-primary ${className}`}
      aria-label={name || undefined}
    >
      {initials || "—"}
    </div>
  );
}
