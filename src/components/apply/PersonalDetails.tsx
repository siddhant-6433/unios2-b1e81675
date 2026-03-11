import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApplicationData } from "./types";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  saving: boolean;
}

const inputCls = "w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

export function PersonalDetails({ data, onChange, onNext, saving }: Props) {
  const address = data.address || {};

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">Personal Details</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Full Name *</label>
          <input value={data.full_name} onChange={e => onChange({ full_name: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Gender</label>
          <select value={data.gender} onChange={e => onChange({ gender: e.target.value })} className={inputCls}>
            <option value="">Select</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Date of Birth</label>
          <input type="date" value={data.dob} onChange={e => onChange({ dob: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Nationality</label>
          <input value={data.nationality} onChange={e => onChange({ nationality: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Category</label>
          <select value={data.category} onChange={e => onChange({ category: e.target.value })} className={inputCls}>
            <option value="">Select</option>
            {["General", "OBC", "SC", "ST", "EWS"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Aadhaar (optional)</label>
          <input value={data.aadhaar} onChange={e => onChange({ aadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) })} placeholder="12-digit number" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone *</label>
          <input value={data.phone} disabled className={`${inputCls} opacity-60`} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
          <input type="email" value={data.email} onChange={e => onChange({ email: e.target.value })} className={inputCls} />
        </div>
      </div>

      {/* APAAR / PEN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">APAAR ID (optional)</label>
          <input value={data.apaar_id} onChange={e => onChange({ apaar_id: e.target.value.replace(/\D/g, '').slice(0, 12) })} placeholder="12-digit Academic Bank ID" className={inputCls} />
        </div>
        {data.program_category === 'school' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">PEN Number (optional)</label>
            <input value={data.pen_number} onChange={e => onChange({ pen_number: e.target.value })} className={inputCls} />
          </div>
        )}
      </div>

      {/* Address */}
      <h3 className="text-sm font-semibold text-foreground mt-2">Address</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Address Line</label>
          <input value={address.line1 || ''} onChange={e => onChange({ address: { ...address, line1: e.target.value } })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">City</label>
          <input value={address.city || ''} onChange={e => onChange({ address: { ...address, city: e.target.value } })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">State</label>
          <input value={address.state || ''} onChange={e => onChange({ address: { ...address, state: e.target.value } })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Country</label>
          <input value={address.country || 'India'} onChange={e => onChange({ address: { ...address, country: e.target.value } })} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">PIN Code</label>
          <input value={address.pin_code || ''} onChange={e => onChange({ address: { ...address, pin_code: e.target.value.replace(/\D/g, '').slice(0, 6) } })} className={inputCls} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={saving || !data.full_name.trim()} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
