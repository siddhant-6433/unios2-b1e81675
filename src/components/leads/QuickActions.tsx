import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Phone, Calendar, FileText, ArrowRight, Bot, UserCheck, Loader2, ChevronDown, UserPlus, IndianRupee, Mail,
} from "lucide-react";

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

interface QuickActionsProps {
  onCall: () => void;
  onWhatsApp: () => void;
  onScheduleVisit: () => void;
  onInterview: () => void;
  onOffer: () => void;
  onConvert: () => void;
  onAiCall: () => void;
  aiCalling: boolean;
  onAddSecondaryCounsellor?: () => void;
  onRecordPayment?: () => void;
  onSendEmail?: () => void;
}

export function QuickActions({
  onCall, onWhatsApp, onScheduleVisit, onInterview, onOffer, onConvert, onAiCall, aiCalling, onAddSecondaryCounsellor, onRecordPayment, onSendEmail,
}: QuickActionsProps) {
  const [open, setOpen] = useState(false);

  const primaryActions = (
    <>
      <Button onClick={onCall} className="w-full justify-start gap-3 h-11 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground hover:from-primary/90 hover:to-primary/70 shadow-md shadow-primary/20">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/20"><Phone className="h-3.5 w-3.5" /></div> Call Now
      </Button>
      <Button onClick={onWhatsApp} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-green-50 dark:hover:bg-green-950/20 border-green-200 dark:border-green-800/40">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30"><WhatsAppIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /></div> Send WhatsApp
      </Button>
    </>
  );

  const secondaryActions = (
    <>
      <Button onClick={onScheduleVisit} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-violet-50 dark:hover:bg-violet-950/20">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30"><Calendar className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" /></div> Schedule Visit
      </Button>
      <Button onClick={onOffer} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-950/20">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30"><FileText className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" /></div> Generate Offer
      </Button>
      <Button onClick={onAiCall} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-950/20" disabled={aiCalling}>
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
          {aiCalling ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" /> : <Bot className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
        </div> AI Call
      </Button>
      <Button onClick={onInterview} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-950/20">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30"><UserCheck className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" /></div> Interview Score
      </Button>
      {onSendEmail && (
        <Button onClick={onSendEmail} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-950/20">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30"><Mail className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" /></div> Send Email
        </Button>
      )}
      {onRecordPayment && (
        <Button onClick={onRecordPayment} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/20">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><IndianRupee className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /></div> Record Payment
        </Button>
      )}
      <Button onClick={onConvert} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl border-primary/30 text-primary hover:bg-primary/5">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10"><ArrowRight className="h-3.5 w-3.5 text-primary" /></div> Convert to Student
      </Button>
      {onAddSecondaryCounsellor && (
        <Button onClick={onAddSecondaryCounsellor} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-pink-50 dark:hover:bg-pink-950/20">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-pink-100 dark:bg-pink-900/30"><UserPlus className="h-3.5 w-3.5 text-pink-600 dark:text-pink-400" /></div> Add Secondary Counsellor
        </Button>
      )}
    </>
  );

  return (
    <Card className="border-border/60">
      <CardContent className="p-5 space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Actions</h3>

        {/* Mobile: primary + collapsible secondary */}
        <div className="lg:hidden space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={onCall} className="justify-center gap-2 h-11 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20 text-sm">
              <Phone className="h-4 w-4" /> Call
            </Button>
            <Button onClick={onWhatsApp} variant="outline" className="justify-center gap-2 h-11 rounded-xl text-sm border-green-200 dark:border-green-800/40">
              <WhatsAppIcon className="h-4 w-4 text-green-600" /> WhatsApp
            </Button>
          </div>
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-center gap-2 h-9 text-xs text-muted-foreground hover:text-foreground">
                {open ? "Show less" : "More actions"}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-1">
              {secondaryActions}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Desktop: all actions visible */}
        <div className="hidden lg:block space-y-2">
          {primaryActions}
          {secondaryActions}
        </div>
      </CardContent>
    </Card>
  );
}
