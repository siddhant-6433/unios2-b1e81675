import { DateRangeField } from "@/components/ui/state-fields";
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
    <DateRangeField
      preset={preset}
      fromDate={fromDate}
      toDate={toDate}
      presetOptions={DATE_PRESETS}
      customPreset="custom"
      onPresetChange={applyPreset}
      onFromDateChange={(value) => {
        onPresetChange("custom");
        onFromDateChange(value);
      }}
      onToDateChange={(value) => {
        onPresetChange("custom");
        onToDateChange(value);
      }}
      className={className}
      selectClassName={selectClassName}
      inputClassName={inputClassName}
      ariaPrefix={ariaPrefix}
    />
  );
}
