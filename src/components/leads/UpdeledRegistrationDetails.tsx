import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUpdeledRegisteredAt, type UpdeledRegistrationDetails as UpdeledRegistrationDetailsType } from "@/lib/updeled";
import { CheckCircle2, ExternalLink, FileText, GraduationCap } from "lucide-react";

interface Props {
  registration: UpdeledRegistrationDetailsType | null | undefined;
  className?: string;
  compact?: boolean;
}

export function UpdeledRegistrationDetails({ registration, className, compact }: Props) {
  if (!registration) return null;
  const registeredAt = formatUpdeledRegisteredAt(registration.registered_at);
  const documentUrl = registration.document_signed_url || registration.document_url;

  if (compact) {
    return (
      <div className={`rounded-lg border border-primary/20 bg-primary/5/70 px-3 py-2 text-xs ${className || ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-0 bg-primary text-white text-[10px]">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            UPDELED registered
          </Badge>
          <span className="font-mono font-semibold text-primary">{registration.registration_no}</span>
          {registeredAt && <span className="text-primary/70">{registeredAt}</span>}
          {documentUrl && (
            <a href={documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Proof <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {registration.notes && <p className="mt-1 text-[11px] text-primary/80">{registration.notes}</p>}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-primary/20 bg-primary/5/70 p-3 ${className || ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
            <GraduationCap className="h-3.5 w-3.5 text-primary" />
            UPDELED registration
          </p>
          <p className="mt-1 text-sm font-mono font-semibold text-foreground truncate">
            {registration.registration_no}
          </p>
          {registeredAt && <p className="mt-0.5 text-[11px] text-muted-foreground">Registered: {registeredAt}</p>}
          {registration.notes && <p className="mt-1.5 text-[11px] text-primary/80">{registration.notes}</p>}
        </div>
        {documentUrl ? (
          <Button asChild variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs border-primary/25 text-primary hover:bg-primary/10">
            <a href={documentUrl} target="_blank" rel="noreferrer">
              <FileText className="h-3.5 w-3.5" />
              Proof
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">No proof attached</span>
        )}
      </div>
    </div>
  );
}
