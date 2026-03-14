import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";

interface SubjectTagInputProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
}

export function SubjectTagInput({
  label,
  options,
  selected,
  onChange,
  placeholder = "Type to search or add…",
  allowCustom = true,
}: SubjectTagInputProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const normalizedSelected = selected.map((s) => s.toLowerCase());
  const filtered = options.filter(
    (o) =>
      !normalizedSelected.includes(o.toLowerCase()) &&
      o.toLowerCase().includes(query.toLowerCase())
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (!normalizedSelected.includes(trimmed.toLowerCase())) {
      onChange([...selected, trimmed]);
    }
    setQuery("");
  };

  const removeTag = (idx: number) => {
    onChange(selected.filter((_, i) => i !== idx));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0) {
        addTag(filtered[0]);
      } else if (allowCustom && query.trim()) {
        addTag(query);
      }
    }
    if (e.key === "Backspace" && !query && selected.length > 0) {
      removeTag(selected.length - 1);
    }
  };

  const showCustomOption =
    allowCustom &&
    query.trim() &&
    !options.some((o) => o.toLowerCase() === query.trim().toLowerCase()) &&
    !normalizedSelected.includes(query.trim().toLowerCase());

  return (
    <div ref={wrapperRef} className="relative">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
        {label}
      </label>
      <div
        className="min-h-[42px] w-full rounded-xl border border-input bg-card py-1.5 px-2 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring/20"
        onClick={() => setOpen(true)}
      >
        {selected.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(i);
              }}
              className="hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {open && (filtered.length > 0 || showCustomOption) && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-xl border border-input bg-card shadow-lg">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => addTag(opt)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              {opt}
            </button>
          ))}
          {showCustomOption && (
            <button
              type="button"
              onClick={() => addTag(query.trim())}
              className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-accent transition-colors"
            >
              Add "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
