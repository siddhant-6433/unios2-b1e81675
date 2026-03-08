import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Phone, X, ChevronDown } from "lucide-react";

const COUNTRY_CODES = [
  { code: "+91", flag: "🇮🇳", name: "India", digits: 10 },
  { code: "+1", flag: "🇺🇸", name: "USA", digits: 10 },
  { code: "+44", flag: "🇬🇧", name: "UK", digits: 10 },
  { code: "+971", flag: "🇦🇪", name: "UAE", digits: 9 },
  { code: "+966", flag: "🇸🇦", name: "Saudi Arabia", digits: 9 },
  { code: "+65", flag: "🇸🇬", name: "Singapore", digits: 8 },
  { code: "+61", flag: "🇦🇺", name: "Australia", digits: 9 },
  { code: "+977", flag: "🇳🇵", name: "Nepal", digits: 10 },
  { code: "+880", flag: "🇧🇩", name: "Bangladesh", digits: 10 },
];

interface EditPhoneDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: string;
  userName: string;
  currentPhone: string | null;
}

const parseExistingPhone = (phone: string | null) => {
  if (!phone) return { countryCode: "+91", number: "" };
  const trimmed = phone.replace(/[\s\-]/g, "");
  const match = COUNTRY_CODES.find((c) => trimmed.startsWith(c.code));
  if (match) return { countryCode: match.code, number: trimmed.slice(match.code.length) };
  // If starts with 0, strip it
  if (trimmed.startsWith("0")) return { countryCode: "+91", number: trimmed.slice(1) };
  return { countryCode: "+91", number: trimmed };
};

const EditPhoneDialog = ({ open, onClose, onSuccess, userId, userName, currentPhone }: EditPhoneDialogProps) => {
  const parsed = parseExistingPhone(currentPhone);
  const [countryCode, setCountryCode] = useState(parsed.countryCode);
  const [number, setNumber] = useState(parsed.number);
  const [saving, setSaving] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { toast } = useToast();

  if (!open) return null;

  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) || COUNTRY_CODES[0];
  const digitsOnly = number.replace(/\D/g, "");
  const isValid = digitsOnly.length === selectedCountry.digits;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      toast({ title: "Invalid number", description: `Enter exactly ${selectedCountry.digits} digits for ${selectedCountry.name}.`, variant: "destructive" });
      return;
    }

    const fullPhone = `${countryCode}${digitsOnly}`;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ phone: fullPhone })
        .eq("user_id", userId);
      if (error) throw error;

      toast({ title: "Phone updated", description: `Mobile number set to ${countryCode} ${digitsOnly} for ${userName}.` });
      onSuccess();
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-card card-shadow p-6 mx-4 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Edit Mobile Number</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          This number is used for <span className="font-semibold text-foreground">WhatsApp OTP login</span> for {userName}.
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Mobile Number <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2">
              {/* Country Code Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-1.5 rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors min-w-[100px]"
                >
                  <span className="text-base">{selectedCountry.flag}</span>
                  <span className="font-medium">{selectedCountry.code}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                </button>

                {dropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 z-20 w-56 rounded-xl border border-border bg-card card-shadow overflow-hidden">
                      {COUNTRY_CODES.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => { setCountryCode(c.code); setDropdownOpen(false); }}
                          className={`flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left ${
                            c.code === countryCode ? "bg-primary/10 text-primary" : "text-foreground"
                          }`}
                        >
                          <span className="text-base">{c.flag}</span>
                          <span className="flex-1">{c.name}</span>
                          <span className="text-muted-foreground font-mono text-xs">{c.code}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Number Input */}
              <input
                type="tel"
                required
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, selectedCountry.digits))}
                placeholder={"0".repeat(selectedCountry.digits)}
                className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 font-mono tracking-wider"
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {digitsOnly.length}/{selectedCountry.digits} digits
              {isValid && <span className="text-primary ml-1">✓ Valid</span>}
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !isValid}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditPhoneDialog;
