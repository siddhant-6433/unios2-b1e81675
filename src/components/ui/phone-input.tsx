import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

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

export const parsePhone = (phone: string | null) => {
  if (!phone) return { countryCode: "+91", number: "" };
  const trimmed = phone.replace(/[\s\-]/g, "");
  const match = COUNTRY_CODES.find((c) => trimmed.startsWith(c.code));
  if (match) return { countryCode: match.code, number: trimmed.slice(match.code.length) };
  if (trimmed.startsWith("0")) return { countryCode: "+91", number: trimmed.slice(1) };
  return { countryCode: "+91", number: trimmed };
};

export const formatFullPhone = (countryCode: string, number: string) => {
  const digits = number.replace(/\D/g, "");
  return digits ? `${countryCode}${digits}` : "";
};

interface PhoneInputProps {
  value: string;
  onChange: (fullPhone: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}

export function PhoneInput({ value, onChange, placeholder, required, className, disabled }: PhoneInputProps) {
  const parsed = parsePhone(value);
  const [countryCode, setCountryCode] = useState(parsed.countryCode);
  const [number, setNumber] = useState(parsed.number);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) || COUNTRY_CODES[0];

  // Sync from external value changes
  useEffect(() => {
    const p = parsePhone(value);
    setCountryCode(p.countryCode);
    setNumber(p.number);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleNumberChange = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, selectedCountry.digits);
    setNumber(digits);
    onChange(formatFullPhone(countryCode, digits));
  };

  const handleCountryChange = (code: string) => {
    setCountryCode(code);
    setDropdownOpen(false);
    const country = COUNTRY_CODES.find((c) => c.code === code) || COUNTRY_CODES[0];
    const digits = number.replace(/\D/g, "").slice(0, country.digits);
    setNumber(digits);
    onChange(formatFullPhone(code, digits));
  };

  const digitsOnly = number.replace(/\D/g, "");

  return (
    <div className={`flex gap-1.5 min-w-0 ${disabled ? 'opacity-60 pointer-events-none' : ''} ${className || ""}`}>
      {/* Country code dropdown */}
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => !disabled && setDropdownOpen(!dropdownOpen)}
          disabled={disabled}
          className="flex items-center gap-1 rounded-xl border border-input bg-background px-2 py-2.5 text-sm text-foreground hover:bg-muted transition-colors h-full"
        >
          <span className="text-base leading-none">{selectedCountry.flag}</span>
          <span className="font-medium text-xs">{selectedCountry.code}</span>
          {!disabled && <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" />}
        </button>

        {dropdownOpen && !disabled && (
          <div className="absolute top-full left-0 mt-1 z-50 w-52 rounded-xl border border-border bg-card shadow-lg overflow-hidden animate-fade-in">
            {COUNTRY_CODES.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => handleCountryChange(c.code)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-left ${
                  c.code === countryCode ? "bg-primary/10 text-primary" : "text-foreground"
                }`}
              >
                <span className="text-base">{c.flag}</span>
                <span className="flex-1 text-xs">{c.name}</span>
                <span className="text-muted-foreground font-mono text-[11px]">{c.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Number input */}
      <input
        type="tel"
        required={required}
        disabled={disabled}
        value={number}
        onChange={(e) => handleNumberChange(e.target.value)}
        placeholder={placeholder || "0".repeat(selectedCountry.digits)}
        className="flex-1 min-w-0 rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed"
      />
    </div>
  );
}

export { COUNTRY_CODES };
