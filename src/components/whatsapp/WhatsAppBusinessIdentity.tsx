import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import {
  type WaSenderOption,
  WHATSAPP_BUSINESS_NAME,
  formatSenderNumber,
  senderHealthClass,
  formatPct,
} from "@/lib/waSenders";

export const WhatsAppBusinessIdentity = ({
  sender,
  selected,
  compact = false,
}: {
  sender: WaSenderOption;
  selected?: boolean;
  compact?: boolean;
}) => {
  const formattedNumber = formatSenderNumber(sender.businessNumber);
  const primaryLabel = formattedNumber || sender.label || "Default bulk route";
  const countryLabel = formattedNumber ? "🇮🇳 India" : "Default route";

  return (
    <div className={`flex w-full items-center gap-3 ${compact ? "py-1" : "rounded-md p-2"}`}>
      <Avatar className={compact ? "h-9 w-9 border bg-white" : "h-10 w-10 border bg-white"}>
        <AvatarImage
          src={sender.profilePictureUrl || nimtLogo}
          alt={sender.verifiedName || WHATSAPP_BUSINESS_NAME}
          className="object-contain p-1"
        />
        <AvatarFallback className="bg-success/5 text-[10px] font-semibold text-success">NIMT</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{primaryLabel}</p>
          {sender.provider === "meta" && (
            <Badge variant="outline" className="h-5 rounded-full px-1.5 text-[10px]">Meta</Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>{countryLabel}</span>
          <span className="hidden sm:inline">•</span>
          <span className="truncate">{sender.verifiedName || WHATSAPP_BUSINESS_NAME}</span>
          {!compact && <span>Name visible to customers</span>}
        </div>
        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge className={`border-0 text-[10px] ${senderHealthClass(sender.failedPct)}`}>
              7d failed {formatPct(sender.failedPct)}
            </Badge>
            <span className="text-[11px] text-muted-foreground">Read {formatPct(sender.readPct)}</span>
            {sender.total != null && (
              <span className="text-[11px] text-muted-foreground">{sender.total.toLocaleString("en-IN")} sends</span>
            )}
            {sender.qualityRiskLevel && (
              <span className="text-[11px] text-muted-foreground">Risk: {sender.qualityRiskLevel}</span>
            )}
          </div>
        )}
      </div>
      {selected && <Check className="h-4 w-4 shrink-0 text-success" />}
    </div>
  );
};
