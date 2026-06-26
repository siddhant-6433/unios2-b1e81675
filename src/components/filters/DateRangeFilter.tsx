import { CalendarDays } from "lucide-react";
import { DATE_PRESETS, getDatePresetRange, type DatePreset } from "@/lib/datePresets";

interface DateRangeFilterProps {
  preset: DatePreset;
  fromDate: string;
  toDate: string;
  onPresetChange: (preset: DatePreset) => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  className?: string;
  selectClassName?: string;
  inputClassName?: string;
  ariaPrefix?: string;
}

export function DateRangeFilter({
  preset,
  fromDate,
  toDate,
  onPresetChange,
  onFromDateChange,
  onToDateChange,
  className = "flex flex-wrap items-center gap-2 rounded-xl border border-input bg-background px-3 py-2",
  selectClassName = "h-8 rounded-md border border-input bg-background px-2 text-sm",
  inputClassName = "h-8 w-[128px] rounded-md border border-input bg-background px-2 text-xs",
  ariaPrefix = "Date",
}: DateRangeFilterProps) {
  const applyPreset = (value: DatePreset) => {
    onPresetChange(value);
    if (value !== "custom") {
      const range = getDatePresetRange(value);
      onFromDateChange(range.from);
      onToDateChange(range.to);
    }
  };

  return (
    <div className={className}>
      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
      <select
        value={preset}
        onChange={(event) => applyPreset(event.target.value as DatePreset)}
        className={selectClassName}
        aria-label={`${ariaPrefix} range`}
      >
        {DATE_PRESETS.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </select>
      {preset === "custom" && (
        <>
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(event) => {
              onPresetChange("custom");
              onFromDateChange(event.target.value);
            }}
            className={inputClassName}
            aria-label={`${ariaPrefix} start date`}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(event) => {
              onPresetChange("custom");
              onToDateChange(event.target.value);
            }}
            className={inputClassName}
            aria-label={`${ariaPrefix} end date`}
          />
        </>
      )}
    </div>
  );
}
