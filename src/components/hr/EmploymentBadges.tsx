// The pills next to an employee's name. Logic lives in src/lib/employmentBadges.
import { employmentBadges, TONE_CLASS, type BadgeInput } from "@/lib/employmentBadges";

export function EmploymentBadges({ compact, ...input }: BadgeInput & { compact?: boolean }) {
  const badges = employmentBadges(input);
  if (!badges.length) return null;

  return (
    <>
      {badges.map((b) => (
        <span key={b.kind}
          title={b.detail}
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[b.tone]}`}>
          {b.label}
          {/* The detail is the useful half — how long is left — so it stays visible
              wherever there is room, and collapses to a tooltip in a dense list. */}
          {!compact && b.detail && (
            <span className="ml-1 font-normal opacity-80">{b.detail}</span>
          )}
        </span>
      ))}
    </>
  );
}

export default EmploymentBadges;
