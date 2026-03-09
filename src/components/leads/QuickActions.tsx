import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Phone, MessageSquare, Calendar, FileText, ArrowRight, Bot, UserCheck, Loader2, ChevronDown, UserPlus,
} from "lucide-react";

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
}

export function QuickActions({
  onCall, onWhatsApp, onScheduleVisit, onInterview, onOffer, onConvert, onAiCall, aiCalling, onAddSecondaryCounsellor,
}: QuickActionsProps) {
  const [open, setOpen] = useState(false);

  const primaryActions = (
    <>
      <Button onClick={onCall} className="w-full justify-start gap-3 h-11 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground hover:from-primary/90 hover:to-primary/70 shadow-md shadow-primary/20">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/20"><Phone className="h-3.5 w-3.5" /></div> Call Now
      </Button>
      <Button onClick={onWhatsApp} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl hover:bg-green-50 dark:hover:bg-green-950/20 border-green-200 dark:border-green-800/40">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30"><MessageSquare className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /></div> Send WhatsApp
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
              <MessageSquare className="h-4 w-4 text-green-600" /> WhatsApp
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
