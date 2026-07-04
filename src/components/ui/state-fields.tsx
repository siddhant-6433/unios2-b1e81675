import * as React from "react";
import { CalendarDays, CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const EMPTY_SELECT_VALUE = "__unios_empty_value__";

export type SelectFieldOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export type SelectFieldGroup = {
  label: string;
  options?: SelectFieldOption[];
};

type FieldShellProps = {
  id?: string;
  label?: React.ReactNode;
  required?: boolean;
  error?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  labelClassName?: string;
  children: React.ReactNode;
};

function FieldShell({
  id,
  label,
  required,
  error,
  description,
  className,
  labelClassName,
  children,
}: FieldShellProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label
          htmlFor={id}
          className={cn(
            "block text-xs font-medium text-muted-foreground",
            error && "text-destructive",
            labelClassName,
          )}
        >
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
      )}
      {children}
      {description && !error && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

type TextFieldProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  label?: React.ReactNode;
  required?: boolean;
  error?: React.ReactNode;
  description?: React.ReactNode;
  containerClassName?: string;
  inputClassName?: string;
};

const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      id,
      value,
      onValueChange,
      label,
      required,
      error,
      description,
      containerClassName,
      inputClassName,
      className,
      ...props
    },
    ref,
  ) => (
    <FieldShell id={id} label={label} required={required} error={error} description={description} className={containerClassName}>
      <Input
        id={id}
        ref={ref}
        value={value}
        required={required}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={!!error}
        className={cn(error && "border-destructive ring-1 ring-destructive/30", inputClassName, className)}
        {...props}
      />
    </FieldShell>
  ),
);
TextField.displayName = "TextField";

type TextAreaFieldProps = Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  label?: React.ReactNode;
  required?: boolean;
  error?: React.ReactNode;
  description?: React.ReactNode;
  containerClassName?: string;
  textareaClassName?: string;
};

const TextAreaField = React.forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  (
    {
      id,
      value,
      onValueChange,
      label,
      required,
      error,
      description,
      containerClassName,
      textareaClassName,
      className,
      ...props
    },
    ref,
  ) => (
    <FieldShell id={id} label={label} required={required} error={error} description={description} className={containerClassName}>
      <Textarea
        id={id}
        ref={ref}
        value={value}
        required={required}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={!!error}
        className={cn(error && "border-destructive ring-1 ring-destructive/30", textareaClassName, className)}
        {...props}
      />
    </FieldShell>
  ),
);
TextAreaField.displayName = "TextAreaField";

type SelectFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  options?: SelectFieldOption[];
  groups?: SelectFieldGroup[];
  placeholder?: string;
  label?: React.ReactNode;
  required?: boolean;
  error?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  allowEmpty?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  ariaLabel?: string;
};

function SelectField({
  value,
  onValueChange,
  options = [],
  groups,
  placeholder = "Select",
  label,
  required,
  error,
  description,
  disabled,
  allowEmpty = true,
  className,
  triggerClassName,
  contentClassName,
  ariaLabel,
}: SelectFieldProps) {
  const hasExplicitEmptyOption =
    options.some((option) => option.value === "") ||
    (groups ?? []).some((group) => (group.options ?? []).some((option) => option.value === ""));
  const selectValue = value === "" && (allowEmpty || hasExplicitEmptyOption) ? EMPTY_SELECT_VALUE : value;
  let renderedEmptyOption = false;

  const renderOption = (option: SelectFieldOption) => {
    const itemValue = option.value === "" ? EMPTY_SELECT_VALUE : option.value;
    if (option.value === "") {
      if (renderedEmptyOption) return null;
      renderedEmptyOption = true;
    }
    return (
      <SelectItem key={itemValue} value={itemValue} disabled={option.disabled}>
        {option.label}
      </SelectItem>
    );
  };

  return (
    <FieldShell label={label} required={required} error={error} description={description} className={className}>
      <Select
        value={selectValue}
        onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          aria-invalid={!!error}
          className={cn(error && "border-destructive ring-1 ring-destructive/30", triggerClassName)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className={contentClassName}>
          {allowEmpty && !hasExplicitEmptyOption && renderOption({ value: "", label: placeholder })}
          {options.map(renderOption)}
          {groups?.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {(group.options ?? []).map(renderOption)}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date;
}

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string) {
  const date = parseIsoDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function parseTypedDate(value: string): Date | undefined {
  const trimmed = value.trim();
  const iso = parseIsoDate(trimmed);
  if (iso) return iso;

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  return parseIsoDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

type DatePickerFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  label?: React.ReactNode;
  required?: boolean;
  error?: React.ReactNode;
  description?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  fromYear?: number;
  toYear?: number;
  defaultMonth?: Date;
  className?: string;
  triggerClassName?: string;
  popoverClassName?: string;
  ariaLabel?: string;
  allowManualInput?: boolean;
  manualInputPlaceholder?: string;
};

function DatePickerField({
  value,
  onValueChange,
  label,
  required,
  error,
  description,
  placeholder = "Pick a date",
  disabled,
  minDate,
  maxDate,
  fromYear,
  toYear,
  defaultMonth,
  className,
  triggerClassName,
  popoverClassName,
  ariaLabel,
  allowManualInput = false,
  manualInputPlaceholder = "or type dd/mm/yyyy",
}: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [typedDate, setTypedDate] = React.useState("");
  const selected = parseIsoDate(value);
  const displayValue = formatDisplayDate(value);

  const isDisabled = (date: Date) => {
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  };

  return (
    <FieldShell label={label} required={required} error={error} description={description} className={className}>
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-invalid={!!error}
            className={cn(
              "w-full justify-between rounded-xl border-input bg-card px-4 py-2.5 text-left text-sm font-normal text-foreground hover:bg-card",
              !displayValue && "text-muted-foreground",
              error && "border-destructive ring-1 ring-destructive/30",
              triggerClassName,
            )}
          >
            <span className="truncate">{displayValue || placeholder}</span>
            <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={cn("w-auto p-0", popoverClassName)} align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (date) onValueChange(formatIsoDate(date));
              setOpen(false);
            }}
            defaultMonth={selected ?? defaultMonth}
            captionLayout={fromYear || toYear ? "dropdown-buttons" : undefined}
            fromYear={fromYear}
            toYear={toYear}
            disabled={isDisabled}
            initialFocus
          />
          {allowManualInput && (
            <div className="border-t border-border p-3">
              <Input
                value={typedDate}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setTypedDate(nextValue);
                  const parsed = parseTypedDate(nextValue);
                  if (parsed && !isDisabled(parsed)) {
                    onValueChange(formatIsoDate(parsed));
                  }
                }}
                placeholder={manualInputPlaceholder}
                className="h-8 rounded-lg bg-muted/40 text-xs"
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </FieldShell>
  );
}

type DateRangeFieldProps<TPreset extends string> = {
  preset: TPreset;
  fromDate: string;
  toDate: string;
  presetOptions: Array<{ key: TPreset; label: string }>;
  customPreset: TPreset;
  onPresetChange: (preset: TPreset) => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  className?: string;
  selectClassName?: string;
  inputClassName?: string;
  ariaPrefix?: string;
  iconClassName?: string;
};

function DateRangeField<TPreset extends string>({
  preset,
  fromDate,
  toDate,
  presetOptions,
  customPreset,
  onPresetChange,
  onFromDateChange,
  onToDateChange,
  className = "flex flex-wrap items-center gap-2 rounded-xl border border-input bg-background px-3 py-2",
  selectClassName = "h-8 rounded-md border border-input bg-background px-2 text-sm",
  inputClassName = "h-8 w-[128px] rounded-md border border-input bg-background px-2 text-xs",
  ariaPrefix = "Date",
  iconClassName = "h-3.5 w-3.5 text-muted-foreground",
}: DateRangeFieldProps<TPreset>) {
  const toDateValue = parseIsoDate(toDate);
  const fromDateValue = parseIsoDate(fromDate);

  return (
    <div className={className}>
      <CalendarDays className={iconClassName} />
      <SelectField
        value={preset}
        onValueChange={(value) => onPresetChange(value as TPreset)}
        options={presetOptions.map((option) => ({ value: option.key, label: option.label }))}
        placeholder="Date range"
        allowEmpty={false}
        ariaLabel={`${ariaPrefix} range`}
        triggerClassName={selectClassName}
      />
      {preset === customPreset && (
        <>
          <DatePickerField
            value={fromDate}
            onValueChange={onFromDateChange}
            maxDate={toDateValue}
            placeholder="Start date"
            ariaLabel={`${ariaPrefix} start date`}
            triggerClassName={inputClassName}
            popoverClassName="z-[80]"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <DatePickerField
            value={toDate}
            onValueChange={onToDateChange}
            minDate={fromDateValue}
            placeholder="End date"
            ariaLabel={`${ariaPrefix} end date`}
            triggerClassName={inputClassName}
            popoverClassName="z-[80]"
          />
        </>
      )}
    </div>
  );
}

export {
  DateRangeField,
  DatePickerField,
  EMPTY_SELECT_VALUE,
  FieldShell,
  SelectField,
  TextAreaField,
  TextField,
  formatDisplayDate,
  formatIsoDate,
  parseIsoDate,
};
