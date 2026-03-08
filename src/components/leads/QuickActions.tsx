import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Phone, MessageSquare, Calendar, FileText, ArrowRight, Bot, UserCheck, Loader2, ChevronDown,
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
}

export function QuickActions({
  onCall, onWhatsApp, onScheduleVisit, onInterview, onOffer, onConvert, onAiCall, aiCalling,
}: QuickActionsProps) {
  const [open, setOpen] = useState(false);

  // Primary actions always visible
  const primaryActions = (
    <>
      <Button onClick={onCall} className="w-full justify-start gap-3 h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
        <Phone className="h-4 w-4" /> Call Now
      </Button>
      <Button onClick={onWhatsApp} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl">
        <MessageSquare className="h-4 w-4" /> Send WhatsApp
      </Button>
    </>
  );

  // Secondary actions collapsible on mobile
  const secondaryActions = (
    <>
      <Button onClick={onScheduleVisit} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl">
        <Calendar className="h-4 w-4" /> Schedule Visit
      </Button>
      <Button onClick={onOffer} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl">
        <FileText className="h-4 w-4" /> Generate Offer
      </Button>
      <Button onClick={onAiCall} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl" disabled={aiCalling}>
        {aiCalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} AI Call
      </Button>
      <Button onClick={onInterview} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl">
        <UserCheck className="h-4 w-4" /> Interview Score
      </Button>
      <Button onClick={onConvert} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl border-primary/30 text-primary hover:bg-primary/5">
        <ArrowRight className="h-4 w-4" /> Convert to Student
      </Button>
    </>
  );

  return (
    <Card className="border-border/60">
      <CardContent className="p-5 space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Actions</h3>

        {/* Mobile: primary + collapsible secondary */}
        <div className="lg:hidden space-y-2">
          {/* Primary row as horizontal buttons on mobile */}
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={onCall} className="justify-center gap-2 h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm">
              <Phone className="h-4 w-4" /> Call
            </Button>
            <Button onClick={onWhatsApp} variant="outline" className="justify-center gap-2 h-11 rounded-xl text-sm">
              <MessageSquare className="h-4 w-4" /> WhatsApp
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
