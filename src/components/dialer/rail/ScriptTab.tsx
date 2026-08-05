import { getCourseScript, getCourseHighlights, getCourseNudges } from "@/lib/dialerScript";
import type { QueueLead } from "@/lib/dialerQueue";

interface Props {
  lead: QueueLead;
  counsellorDisplayName: string;
}

/**
 * Stacked in the rail rather than three columns — at 380px the old
 * lg:grid-cols-3 card collapsed to one column anyway, and in the rail the
 * script stays on screen for the whole call instead of scrolling away.
 */
export function ScriptTab({ lead, counsellorDisplayName }: Props) {
  const hasCourse = lead.course_name !== "—";

  return (
    <div className="space-y-4 text-xs">
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-info-foreground">💬 Call Script</p>
        <div className="space-y-2 leading-relaxed text-muted-foreground">
          <p className="italic">
            "Hello, am I speaking with <b>{lead.name.split(" ")[0]}</b>?
            This is {counsellorDisplayName} from NIMT Educational Institutions.
            {hasCourse
              ? <> I see you've enquired about <b>{lead.course_name}</b>. Can you confirm this is the course you're interested in?</>
              : " I'm calling regarding your enquiry. Could you tell me which course you're interested in?"}
            "
          </p>
          <p className="text-[9px] font-semibold text-warning-foreground">⚠️ Confirm name and course before proceeding</p>
          {hasCourse && (
            <p className="italic">
              "Great! Let me tell you about {lead.course_name} at our {lead.campus_name}.
              {getCourseScript(lead.course_name)}"
            </p>
          )}
          <p className="text-[9px] text-muted-foreground/60">💡 Open the Course tab for the exact fee structure</p>
        </div>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-info-foreground">🏛️ About NIMT</p>
        <ul className="space-y-1 leading-relaxed text-muted-foreground">
          <li>• Est. 1987 — <b>37+ years</b> in education</li>
          <li>• 5 campuses, 36+ programmes, 21 colleges</li>
          <li>• AICTE, UGC, BCI, NCTE, INC, PCI approved</li>
          <li>• Placements: <b>₹18.75 LPA highest</b>, ₹5.40 LPA avg</li>
          <li>• 1,200+ recruiters: KPMG, Wipro, Deloitte, TCS</li>
          <li>• 6 NIRF ranked institutions (2025)</li>
          {getCourseHighlights(lead.course_name).map((h, i) => <li key={i}>• {h}</li>)}
        </ul>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-info-foreground">🎯 Nudge Checklist</p>
        <ul className="space-y-1 leading-relaxed text-muted-foreground">
          {getCourseNudges(lead.course_name).map((n, i) => <li key={i}>☐ {n}</li>)}
          <li>☐ Scholarships (merit/SC/ST/OBC/sports)</li>
          <li>☐ Apply online: <b>apply.nimt.ac.in</b></li>
          <li>☐ Invite for campus visit</li>
          <li>☐ Hostel: 600+ beds, AC/non-AC</li>
          <li>☐ Transport facility available</li>
          <li>☐ Send WhatsApp with course details</li>
        </ul>
      </section>
    </div>
  );
}
