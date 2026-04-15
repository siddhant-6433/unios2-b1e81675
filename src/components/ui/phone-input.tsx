import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";
import { COUNTRIES } from "@/components/apply/countries";

// Re-export for backward compatibility
export const COUNTRY_CODES = COUNTRIES;

export const parsePhone = (phone: string | null) => {
  if (!phone) return { countryCode: "+91", number: "" };
  const trimmed = phone.replace(/[\s\-]/g, "");
  // Try longest codes first (e.g. +971 before +97)
  const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  const match = sorted.find((c) => trimmed.startsWith(c.code));
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
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedCountry = COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];

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
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (dropdownOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [dropdownOpen]);

  const handleNumberChange = (val: string) => {
    // Strip all non-digits
    let digits = val.replace(/\D/g, "");
    let resolvedCode = countryCode;

    // Smart ISD code detection: if pasted value looks like it has a country code, strip it
    // e.g. "919555192192" (12 digits starting with 91) → "9555192192"
    if (digits.length > selectedCountry.digits) {
      // Try to match the currently selected country code (without the +)
      const codeDigits = resolvedCode.replace("+", "");
      if (digits.startsWith(codeDigits)) {
        digits = digits.slice(codeDigits.length);
      } else {
        // Try all country codes, longest first
        const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
        for (const c of sorted) {
          const cd = c.code.replace("+", "");
          if (digits.startsWith(cd) && digits.length - cd.length >= 6) {
            resolvedCode = c.code;
            digits = digits.slice(cd.length);
            break;
          }
        }
      }
    }

    // Also strip leading 0 for Indian numbers (0-prefixed local format)
    if (resolvedCode === "+91" && digits.startsWith("0") && digits.length > 10) {
      digits = digits.slice(1);
    }

    const country = COUNTRIES.find(c => c.code === resolvedCode) || selectedCountry;
    digits = digits.slice(0, country.digits);

    if (resolvedCode !== countryCode) setCountryCode(resolvedCode);
    setNumber(digits);
    onChange(formatFullPhone(resolvedCode, digits));
  };

  const handleCountryChange = (code: string) => {
    setCountryCode(code);
    setDropdownOpen(false);
    setSearch("");
    const country = COUNTRIES.find((c) => c.code === code) || COUNTRIES[0];
    const digits = number.replace(/\D/g, "").slice(0, country.digits);
    setNumber(digits);
    onChange(formatFullPhone(code, digits));
  };

  const filteredCountries = search
    ? COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.includes(search)
      )
    : COUNTRIES;

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
          <div className="absolute top-full left-0 mt-1 z-50 w-60 rounded-xl border border-border bg-card shadow-lg overflow-hidden animate-fade-in">
            {/* Search input */}
            <div className="p-2 border-b border-border">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/50">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search country..."
                  className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none w-full"
                />
              </div>
            </div>
            {/* Country list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredCountries.map((c, i) => (
                <button
                  key={`${c.code}-${c.name}-${i}`}
                  type="button"
                  onClick={() => handleCountryChange(c.code)}
                  className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-left ${
                    c.code === countryCode && c.name === selectedCountry.name ? "bg-primary/10 text-primary" : "text-foreground"
                  }`}
                >
                  <span className="text-base">{c.flag}</span>
                  <span className="flex-1 text-xs truncate">{c.name}</span>
                  <span className="text-muted-foreground font-mono text-[11px]">{c.code}</span>
                </button>
              ))}
              {filteredCountries.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">No countries found</p>
              )}
            </div>
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
