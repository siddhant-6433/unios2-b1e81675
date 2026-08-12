import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  IndianRupee, MessageCircle, FileText, Calendar, Footprints, MoreHorizontal,
} from "lucide-react";

export type DialerAction = "payment" | "whatsapp" | "apply" | "visit" | "proposal" | "walkin";

const ACTIONS: { key: DialerAction; label: string; icon: typeof FileText }[] = [
  { key: "payment", label: "Payment link", icon: IndianRupee },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "apply", label: "Login link", icon: FileText },
  { key: "visit", label: "Schedule visit", icon: Calendar },
  { key: "proposal", label: "Fee proposal", icon: FileText },
  { key: "walkin", label: "Log walk-in", icon: Footprints },
];

/** How many actions stay inline before the rest fold into "More". */
const INLINE = 4;

interface Props {
  onAction: (action: DialerAction) => void;
  canCreateProposal: boolean;
  leadId: string;
}

/**
 * Available before, during and after a call — a lead who asks for the payment
 * link mid-call shouldn't force the counsellor to hang up first. Overflow goes
 * into a popover so the row never wraps to a second line.
 */
export function DialerActionRow({ onAction, canCreateProposal, leadId }: Props) {
  const actions = ACTIONS.filter(a => a.key !== "proposal" || canCreateProposal);
  const inline = actions.slice(0, INLINE);
  const overflow = actions.slice(INLINE);

  return (
    <div className="flex items-center gap-1.5">
      {inline.map(({ key, label, icon: Icon }) => (
        <Button key={key} size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onAction(key)}>
          <Icon className="mr-1 h-3 w-3" />{label}
        </Button>
      ))}
      {overflow.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-1">
            {overflow.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => onAction(key)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted">
                <Icon className="h-3 w-3" />{label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      <a href={`/admissions/${leadId}`} target="_blank" rel="noreferrer"
        className="ml-auto inline-flex h-7 items-center rounded-md border border-input px-2 text-[11px] font-medium hover:bg-muted">
        Open lead →
      </a>
    </div>
  );
}
