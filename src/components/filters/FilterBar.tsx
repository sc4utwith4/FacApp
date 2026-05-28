import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, RotateCcw } from "lucide-react";
import { format } from "date-fns";

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  type: "select";
  options: FilterOption[];
}

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  filters: FilterConfig[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
  showDateRange?: boolean;
  dateRangeValue?: {
    start: Date | null;
    end: Date | null;
  };
  onDateRangeChange?: (range: { start: Date | null; end: Date | null }) => void;
}

export function FilterBar({
  filters,
  values,
  onChange,
  onReset,
  showDateRange = false,
  dateRangeValue,
  onDateRangeChange,
  className,
  ...props
}: FilterBarProps) {
  const formatDateForInput = (date: Date | null) => {
    if (!date) return "";
    return format(date, "yyyy-MM-dd");
  };

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const start = value ? new Date(value + "T12:00:00") : null;
    onDateRangeChange?.({
      start,
      end: dateRangeValue?.end ?? null,
    });
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const end = value ? new Date(value + "T12:00:00") : null;
    onDateRangeChange?.({
      start: dateRangeValue?.start ?? null,
      end,
    });
  };

  const hasFilters =
    filters.some((f) => values[f.key] && values[f.key] !== "todos") ||
    (showDateRange &&
      dateRangeValue &&
      (dateRangeValue.start || dateRangeValue.end));

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 bg-muted/30 rounded-lg py-3 px-4 mb-4",
        className
      )}
      {...props}
    >
      {showDateRange && dateRangeValue && onDateRangeChange && (
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Input
            type="date"
            value={formatDateForInput(dateRangeValue.start)}
            onChange={handleStartChange}
            className="w-[140px]"
          />
          <span className="text-muted-foreground text-sm">até</span>
          <Input
            type="date"
            value={formatDateForInput(dateRangeValue.end)}
            onChange={handleEndChange}
            className="w-[140px]"
          />
        </div>
      )}

      {filters.map((filter) => (
        <div key={filter.key} className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {filter.label}:
          </span>
          <Select
            value={values[filter.key] ?? "todos"}
            onValueChange={(value) => onChange(filter.key, value)}
          >
            <SelectTrigger className="w-[140px] sm:w-[160px]">
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Limpar
        </Button>
      )}
    </div>
  );
}

FilterBar.displayName = "FilterBar";
