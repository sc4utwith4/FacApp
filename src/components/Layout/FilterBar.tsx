/**
 * FilterBar com API simples (período, status, busca). Para o Dashboard use @/components/filters/FilterBar.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  onPeriodChange?: (period: string) => void;
  onStatusChange?: (status: string) => void;
  onSearchChange?: (search: string) => void;
  onClear?: () => void;
  searchPlaceholder?: string;
}

export function FilterBar({
  onPeriodChange,
  onStatusChange,
  onSearchChange,
  onClear,
  searchPlaceholder = "Buscar...",
  className,
  ...props
}: FilterBarProps) {
  const [search, setSearch] = React.useState("");
  const [period, setPeriod] = React.useState("");
  const [status, setStatus] = React.useState("");

  const handleClear = () => {
    setSearch("");
    setPeriod("");
    setStatus("");
    onClear?.();
  };

  const hasFilters = search || period || status;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 bg-muted/30 rounded-lg py-3 px-4 mb-4",
        className
      )}
      {...props}
    >
      <Select value={period} onValueChange={(value) => {
        setPeriod(value);
        onPeriodChange?.(value);
      }}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Período" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="today">Hoje</SelectItem>
          <SelectItem value="week">Esta semana</SelectItem>
          <SelectItem value="month">Este mês</SelectItem>
          <SelectItem value="quarter">Este trimestre</SelectItem>
          <SelectItem value="year">Este ano</SelectItem>
          <SelectItem value="custom">Personalizado</SelectItem>
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(value) => {
        setStatus(value);
        onStatusChange?.(value);
      }}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos</SelectItem>
          <SelectItem value="pendente">Pendente</SelectItem>
          <SelectItem value="pago">Pago</SelectItem>
          <SelectItem value="vencido">Vencido</SelectItem>
          <SelectItem value="cancelado">Cancelado</SelectItem>
        </SelectContent>
      </Select>

      <Input
        placeholder={searchPlaceholder}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          onSearchChange?.(e.target.value);
        }}
        className="flex-1 min-w-[200px]"
      />

      {hasFilters && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleClear}
          className="gap-2"
        >
          <X className="h-4 w-4" />
          Limpar
        </Button>
      )}
    </div>
  );
}


