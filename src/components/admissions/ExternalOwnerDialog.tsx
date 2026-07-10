import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Handshake, Loader2, School } from "lucide-react";

type OwnerType = "consultant" | "academic_partner" | "none";

type ConsultantOption = {
  id: string;
  name: string;
  organization: string | null;
};

type AcademicPartnerOption = {
  id: string;
  name: string;
  organization: string | null;
};

type CurrentOwner = {
  type: OwnerType;
  id: string | null;
  label: string;
};

type AssignOwnerRpcClient = {
  rpc: (
    fn: "assign_lead_external_owner",
    args: {
      _lead_id: string;
      _owner_type: OwnerType;
      _consultant_id: string | null;
      _academic_partner_id: string | null;
    },
  ) => Promise<{ error: { message: string } | null }>;
};

interface ExternalOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  currentOwner: CurrentOwner;
  onSuccess: () => void;
}

export function ExternalOwnerDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  currentOwner,
  onSuccess,
}: ExternalOwnerDialogProps) {
  const { toast } = useToast();
  const [ownerType, setOwnerType] = useState<OwnerType>(currentOwner.type);
  const [selectedOwnerId, setSelectedOwnerId] = useState(currentOwner.id || "");
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);
  const [academicPartners, setAcademicPartners] = useState<AcademicPartnerOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOwnerType(currentOwner.type);
    setSelectedOwnerId(currentOwner.id || "");
  }, [currentOwner.id, currentOwner.type, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setLoadingOptions(true);
      const [consultantsRes, partnersRes] = await Promise.all([
        supabase
          .from("consultants")
          .select("id, name, organization, stage")
          .neq("stage", "inactive")
          .order("name", { ascending: true }),
        supabase
          .from("academic_partners")
          .select("id, name, organization, status")
          .eq("status", "active")
          .order("name", { ascending: true }),
      ]);

      if (cancelled) return;
      if (consultantsRes.error || partnersRes.error) {
        toast({
          title: "Could not load owners",
          description: consultantsRes.error?.message || partnersRes.error?.message,
          variant: "destructive",
        });
      } else {
        setConsultants((consultantsRes.data || []).map(({ id, name, organization }) => ({ id, name, organization })));
        setAcademicPartners((partnersRes.data || []).map(({ id, name, organization }) => ({ id, name, organization })));
      }
      setLoadingOptions(false);
    })();

    return () => { cancelled = true; };
  }, [open, toast]);

  const options = ownerType === "consultant" ? consultants : academicPartners;
  const selectedOwner = useMemo(
    () => options.find((option) => option.id === selectedOwnerId),
    [options, selectedOwnerId],
  );
  const replacingOtherOwner =
    currentOwner.type !== "none" &&
    ownerType !== "none" &&
    currentOwner.type !== ownerType;

  const handleSave = async () => {
    if (ownerType !== "none" && !selectedOwnerId) return;
    setSaving(true);
    const assignOwnerClient = supabase as unknown as AssignOwnerRpcClient;
    const { error } = await assignOwnerClient.rpc("assign_lead_external_owner", {
      _lead_id: leadId,
      _owner_type: ownerType,
      _consultant_id: ownerType === "consultant" ? selectedOwnerId : null,
      _academic_partner_id: ownerType === "academic_partner" ? selectedOwnerId : null,
    });

    if (error) {
      toast({ title: "Owner assignment failed", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: ownerType === "none" ? "External owner cleared" : "External owner assigned",
        description: ownerType === "none"
          ? `${leadName} no longer has a consultant or academic partner owner.`
          : `${leadName} is now assigned to ${selectedOwner?.name || "the selected owner"}.`,
      });
      onOpenChange(false);
      onSuccess();
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ownerType === "academic_partner" ? <School className="h-5 w-5 text-primary" /> : <Handshake className="h-5 w-5 text-primary" />}
            Assign External Owner
          </DialogTitle>
          <DialogDescription>
            This controls consultant or academic partner attribution only. It does not change the assigned admissions counsellor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Current owner: <span className="font-medium text-foreground">{currentOwner.label}</span>
          </div>

          <div className="space-y-2">
            <Label>Owner Type</Label>
            <Select
              value={ownerType}
              onValueChange={(value) => {
                const next = value as OwnerType;
                setOwnerType(next);
                setSelectedOwnerId(next === currentOwner.type ? currentOwner.id || "" : "");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consultant">Consultant</SelectItem>
                <SelectItem value="academic_partner">Academic Partner</SelectItem>
                <SelectItem value="none">Clear external owner</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {ownerType !== "none" && (
            <div className="space-y-2">
              <Label>{ownerType === "consultant" ? "Consultant" : "Academic Partner"}</Label>
              <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId} disabled={loadingOptions}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingOptions ? "Loading owners..." : "Select owner"} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}{option.organization ? ` - ${option.organization}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {replacingOtherOwner && (
            <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning-foreground">
              Saving will replace {currentOwner.label}. A lead can have only one external owner.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loadingOptions || (ownerType !== "none" && !selectedOwnerId)}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
