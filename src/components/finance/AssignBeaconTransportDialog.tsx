import { useEffect, useMemo, useState } from "react";
import { Bus, Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldShell } from "@/components/ui/state-fields";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  BEACON_ACADEMIC_MONTHS,
  BEACON_TRANSPORT_RATES,
  beaconTransportQuarterDueDate,
  beaconTransportQuarterTotals,
  type BeaconTransportZone,
} from "@/lib/beaconTransportFees";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  onAssigned: () => void;
}

const ZONES: { value: BeaconTransportZone; label: string }[] = [
  { value: "zone_1", label: "Within 5 km" },
  { value: "zone_2", label: "5–10 km" },
  { value: "zone_3", label: "Over 10 km" },
];

const QUARTER_LABELS = { q1: "Q1 · 10 Apr", q2: "Q2 · 10 Jul", q3: "Q3 · 10 Oct", q4: "Q4 · 10 Jan" };

export function AssignBeaconTransportDialog({ open, onOpenChange, studentId, onAssigned }: Props) {
  const { toast } = useToast();
  const [zone, setZone] = useState<BeaconTransportZone>("zone_1");
  const [oneWay, setOneWay] = useState(false);
  const [monthlyAmount, setMonthlyAmount] = useState("2000");
  const [selectedMonths, setSelectedMonths] = useState<number[]>(BEACON_ACADEMIC_MONTHS.map(({ month }) => month));
  const [rates, setRates] = useState<Record<BeaconTransportZone, number> | null>(null);
  const [sessionName, setSessionName] = useState("2027-28");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !studentId) return;
    let cancelled = false;
    setLoading(true);
    (supabase.rpc as any)("beacon_transport_fee_options", { _student_id: studentId }).then(({ data, error }: any) => {
      if (cancelled) return;
      setLoading(false);
      if (error || !data?.monthly_rates) {
        setRates(null);
        toast({ title: "Transport rates unavailable", description: error?.message || "No Beacon transport rates were found for this student's session.", variant: "destructive" });
        return;
      }
      setRates(data.monthly_rates);
      setSessionName(data.session_name || "2027-28");
      const currentZone = zone;
      setMonthlyAmount(String(Number(data.monthly_rates[currentZone]) || 0));
    }).catch((error: unknown) => {
      if (cancelled) return;
      setLoading(false);
      setRates(null);
      toast({ title: "Transport rates unavailable", description: error instanceof Error ? error.message : "Could not load the student's fee structure.", variant: "destructive" });
    });
    return () => { cancelled = true; };
  }, [open, studentId, toast]);

  const defaultAmount = useMemo(() => {
    const full = Number(rates?.[zone] || BEACON_TRANSPORT_RATES[zone].monthly);
    return oneWay ? full / 2 : full;
  }, [oneWay, rates, zone]);
  const quarterTotals = beaconTransportQuarterTotals(selectedMonths, Number(monthlyAmount) || 0);
  const academicYearStart = Number(sessionName.slice(0, 4)) || 2027;

  const setDirection = (nextOneWay: boolean) => {
    setOneWay(nextOneWay);
    const full = Number(rates?.[zone] || BEACON_TRANSPORT_RATES[zone].monthly);
    setMonthlyAmount(String(nextOneWay ? full / 2 : full));
  };

  const setZoneAndDefault = (nextZone: BeaconTransportZone) => {
    setZone(nextZone);
    const full = Number(rates?.[nextZone] || BEACON_TRANSPORT_RATES[nextZone].monthly);
    setMonthlyAmount(String(oneWay ? full / 2 : full));
  };

  const toggleMonth = (month: number) => setSelectedMonths((current) =>
    current.includes(month) ? current.filter((value) => value !== month) : [...current, month].sort((a, b) =>
      BEACON_ACADEMIC_MONTHS.findIndex((item) => item.month === a) - BEACON_ACADEMIC_MONTHS.findIndex((item) => item.month === b)),
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setZone("zone_1");
      setOneWay(false);
      setMonthlyAmount(String(Number(rates?.zone_1) || BEACON_TRANSPORT_RATES.zone_1.monthly));
      setSelectedMonths(BEACON_ACADEMIC_MONTHS.map(({ month }) => month));
    }
    onOpenChange(nextOpen);
  };

  const assign = async () => {
    const amount = Number(monthlyAmount);
    if (!selectedMonths.length) {
      toast({ title: "Select at least one month", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > defaultAmount) {
      toast({ title: "Enter a valid reduced monthly amount", description: `Amount must be greater than ₹0 and no more than ₹${defaultAmount.toLocaleString("en-IN")}.`, variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("assign_beacon_transport_fee", {
      _student_id: studentId,
      _zone: zone,
      _one_way: oneWay,
      _months: selectedMonths,
      _monthly_amount: amount,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not assign transport fee", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Transport fee assigned", description: `${data?.rows_created || 0} quarterly charge${data?.rows_created === 1 ? "" : "s"} added for ${selectedMonths.length} month${selectedMonths.length === 1 ? "" : "s"}.` });
    handleOpenChange(false);
    onAssigned();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bus className="h-4 w-4 text-primary" /> Assign Transport Fee</DialogTitle>
        </DialogHeader>

        {loading ? <div className="flex h-32 items-center justify-center"><ButtonOrb state="working" /></div> : (
          <div className="space-y-4 py-2">
            <FieldShell label="Route / distance zone">
              <select className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" value={zone} onChange={(event) => setZoneAndDefault(event.target.value as BeaconTransportZone)}>
                {ZONES.map((item) => <option key={item.value} value={item.value}>{item.label} · ₹{Number(rates?.[item.value] || BEACON_TRANSPORT_RATES[item.value].monthly).toLocaleString("en-IN")}/month</option>)}
              </select>
            </FieldShell>

            <div className="grid grid-cols-2 gap-2">
              {[{ value: false, label: "Round trip" }, { value: true, label: "One way" }].map((option) => (
                <button key={option.label} type="button" onClick={() => setDirection(option.value)} className={`rounded-lg border px-3 py-2 text-sm font-medium ${oneWay === option.value ? "border-primary bg-primary/5 text-primary" : "border-input text-muted-foreground hover:bg-muted/40"}`}>
                  {oneWay === option.value && <Check className="mr-1.5 inline h-3.5 w-3.5" />}{option.label}
                </button>
              ))}
            </div>
            <p className="-mt-2 text-[11px] text-muted-foreground">{oneWay ? "One-way default is half the round-trip rate." : `Default rate from the ${sessionName} fee structure.`}</p>

            <FieldShell label="Monthly amount (₹)">
              <Input type="number" min="1" max={defaultAmount} step="0.01" value={monthlyAmount} onChange={(event) => setMonthlyAmount(event.target.value)} />
            </FieldShell>
            <p className="-mt-3 text-[11px] text-muted-foreground">Default ₹{defaultAmount.toLocaleString("en-IN")}/month. Reduce it for this student as needed.</p>

            <div className="rounded-xl border border-border/70 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Months to charge · {sessionName}</p>
                  <p className="text-[11px] text-muted-foreground">Quarterly payable; select the months that apply.</p>
                </div>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelectedMonths(selectedMonths.length === 12 ? [] : BEACON_ACADEMIC_MONTHS.map(({ month }) => month))}>
                  {selectedMonths.length === 12 ? "Clear" : "Select all"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {BEACON_ACADEMIC_MONTHS.map((item) => (
                  <label key={item.month} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50">
                    <input type="checkbox" checked={selectedMonths.includes(item.month)} onChange={() => toggleMonth(item.month)} className="h-3.5 w-3.5 accent-primary" />
                    {item.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium">Quarterly charges</p>
              <div className="space-y-1.5">
                {Object.entries(quarterTotals).map(([quarter, total]) => (
                  <div key={quarter} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{QUARTER_LABELS[quarter as keyof typeof QUARTER_LABELS]} {beaconTransportQuarterDueDate(quarter as keyof typeof QUARTER_LABELS, academicYearStart).slice(0, 4)} · {selectedMonths.filter((month) => BEACON_ACADEMIC_MONTHS.find((item) => item.month === month)?.quarter === quarter).length} months</span>
                    <span className="font-medium">₹{total.toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">Existing unpaid transport charges will be replaced. Assignment is blocked if a transport charge has any payment.</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={assign} disabled={saving || loading || !rates || selectedMonths.length === 0} className="gap-1.5">
            {saving ? <ButtonOrb state="working" onFilled /> : <Save className="h-4 w-4" />} Assign transport
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
