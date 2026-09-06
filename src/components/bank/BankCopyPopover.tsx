// Per-field copy of a payee's bank details, for pasting into Zoho's "Add Bank
// Account" form (which has separate fields and no import API). Renders nothing
// when there are no bank details. Shared by refunds, video bills and consultant
// payouts.
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Copy } from "lucide-react";

export type BankInfo = {
  accountName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  bankName?: string | null;
  upi?: string | null;
};

export function BankCopyPopover({
  bank,
  label = "Bank",
  align = "end",
}: {
  bank: BankInfo;
  label?: string;
  align?: "start" | "center" | "end";
}) {
  const { toast } = useToast();

  const fields = ([
    ["Account Holder", bank.accountName],
    ["Bank Name", bank.bankName],
    ["Account Number", bank.accountNumber],
    ["IFSC", bank.ifsc],
    ["UPI", bank.upi],
  ] as [string, string | null | undefined][]).filter((f): f is [string, string] => !!f[1]);

  if (!bank.accountNumber || fields.length === 0) return null;

  const copy = async (name: string, value: string) => {
    try { await navigator.clipboard.writeText(value); toast({ title: `${name} copied` }); }
    catch { toast({ title: "Copy failed", description: value, variant: "destructive" }); }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1 h-7 px-2 text-xs" title="Copy payee bank details, field by field, for Zoho">
          <Copy className="h-3 w-3" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-2">
        <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">Copy for Zoho · Add Bank Account</p>
        <div className="space-y-0.5">
          {fields.map(([name, value]) => (
            <button
              key={name}
              type="button"
              onClick={() => copy(name, value)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60"
              title={`Copy ${name}`}
            >
              <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="w-24 shrink-0 text-[10px] text-muted-foreground">{name}</span>
              <span className="flex-1 truncate font-medium text-foreground">{value}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
