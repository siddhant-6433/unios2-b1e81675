import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Phone, MessageSquare, Calendar, FileText, ArrowRight, Bot, UserCheck, Loader2,
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
  return (
    <Card className="border-border/60">
      <CardContent className="p-5 space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Actions</h3>
        <Button onClick={onCall} className="w-full justify-start gap-3 h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
          <Phone className="h-4 w-4" /> Call Now
        </Button>
        <Button onClick={onWhatsApp} variant="outline" className="w-full justify-start gap-3 h-11 rounded-xl">
          <MessageSquare className="h-4 w-4" /> Send WhatsApp
        </Button>
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
      </CardContent>
    </Card>
  );
}
