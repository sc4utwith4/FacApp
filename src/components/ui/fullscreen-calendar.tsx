import * as React from "react";
import { format, parse, add, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";

export interface Event {
  id: number;
  name: string;
  time: string;
  datetime: string;
  valor?: number;
  status?: string;
  tipo?: "entrada" | "saida";
}

export interface CalendarData {
  day: Date;
  events: Event[];
}

interface FullScreenCalendarProps {
  data: CalendarData[];
  onEventClick?: (event: Event) => void;
  onAddEvent?: () => void;
  onDayClick?: (day: Date) => void;
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
}

const formatCurrency = (value?: number) => {
  if (!value) return "";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

const getEventColor = (event: Event) => {
  if (event.status === "pago") {
    return "bg-emerald-500/10 border-emerald-500/30 text-emerald-600";
  }
  if (event.status === "atrasado") {
    return "bg-destructive/10 border-destructive/30 text-destructive";
  }
  if (event.tipo === "saida") {
    return "bg-orange-500/10 border-orange-500/30 text-orange-600";
  }
  return "bg-primary/10 border-primary/30 text-primary";
};

export function FullScreenCalendar({
  data,
  onEventClick,
  onAddEvent,
  onDayClick,
  initialMonth,
  onMonthChange,
}: FullScreenCalendarProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [currentMonth, setCurrentMonth] = React.useState<string>(() => {
    if (initialMonth) {
      return initialMonth;
    }
    return format(today, "MMM-yyyy", { locale: ptBR });
  });

  const [selectedDay, setSelectedDay] = React.useState<Date>(today);

  const firstDayCurrentMonth = React.useMemo(() => {
    return parse(currentMonth, "MMM-yyyy", new Date(), { locale: ptBR });
  }, [currentMonth]);

  const days = React.useMemo(() => {
    const monthStart = startOfMonth(firstDayCurrentMonth);
    const monthEnd = endOfMonth(firstDayCurrentMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [firstDayCurrentMonth]);

  const previousMonth = () => {
    const firstDayNextMonth = add(firstDayCurrentMonth, { months: -1 });
    const newMonth = format(firstDayNextMonth, "MMM-yyyy", { locale: ptBR });
    setCurrentMonth(newMonth);
    if (onMonthChange) {
      onMonthChange(format(firstDayNextMonth, "yyyy-MM"));
    }
  };

  const nextMonth = () => {
    const firstDayNextMonth = add(firstDayCurrentMonth, { months: 1 });
    const newMonth = format(firstDayNextMonth, "MMM-yyyy", { locale: ptBR });
    setCurrentMonth(newMonth);
    if (onMonthChange) {
      onMonthChange(format(firstDayNextMonth, "yyyy-MM"));
    }
  };

  const goToToday = () => {
    const todayMonth = format(today, "MMM-yyyy", { locale: ptBR });
    setCurrentMonth(todayMonth);
    setSelectedDay(today);
    if (onMonthChange) {
      onMonthChange(format(today, "yyyy-MM"));
    }
  };

  const handleDayClick = (day: Date) => {
    setSelectedDay(day);
    if (onDayClick) {
      // Normalizar a data para meio-dia no timezone local
      // Isso garante que não haja problemas de conversão de timezone
      const normalizedDay = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        12, // Usar meio-dia para evitar problemas de timezone
        0,
        0,
        0
      );
      onDayClick(normalizedDay);
    }
  };

  const getDayData = (day: Date) => {
    return data.find((item) => isSameDay(item.day, day));
  };

  const isToday = (day: Date) => isSameDay(day, today);
  const isCurrentMonth = (day: Date) => isSameMonth(day, firstDayCurrentMonth);
  const isSelected = (day: Date) => isSameDay(day, selectedDay);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex flex-none items-center justify-between border-b border-border px-6 py-4">
        {isDesktop && (
          <div className="flex items-center">
            <div className="text-right">
              <div className="text-sm font-semibold leading-6 text-foreground">
                {format(today, "MMM", { locale: ptBR }).toUpperCase()}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {format(today, "d")}
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center">
          <h2 className="text-lg font-semibold text-foreground">
            {format(firstDayCurrentMonth, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
          <p className="ml-4 text-sm text-muted-foreground">
            {format(startOfMonth(firstDayCurrentMonth), "d 'de' MMM", { locale: ptBR })} -{" "}
            {format(endOfMonth(firstDayCurrentMonth), "d 'de' MMM", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={previousMonth}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToToday}
              className="h-8 px-3 text-xs"
            >
              Hoje
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={nextMonth}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {onAddEvent && (
            <Button
              variant="default"
              size="sm"
              onClick={onAddEvent}
              className="ml-4 gap-2"
            >
              <PlusCircle className="h-4 w-4" />
              Adicionar Conta
            </Button>
          )}
        </div>
      </header>

      {/* Calendar Grid */}
      <div className="isolate flex flex-auto flex-col overflow-auto bg-background">
        {/* Week header */}
        <div className="flex-none border-b border-border">
          <div className="grid grid-cols-7 text-xs leading-6 text-muted-foreground">
            <div className="flex justify-center py-2 font-semibold">Dom</div>
            <div className="flex justify-center py-2 font-semibold">Seg</div>
            <div className="flex justify-center py-2 font-semibold">Ter</div>
            <div className="flex justify-center py-2 font-semibold">Qua</div>
            <div className="flex justify-center py-2 font-semibold">Qui</div>
            <div className="flex justify-center py-2 font-semibold">Sex</div>
            <div className="flex justify-center py-2 font-semibold">Sáb</div>
          </div>
        </div>

        {/* Desktop Calendar */}
        <div className="hidden w-full border-x lg:grid lg:grid-cols-7 lg:grid-rows-5">
          {days.map((day, dayIdx) => {
            const dayData = getDayData(day);
            const events = dayData?.events || [];
            const dayIsToday = isToday(day);
            const dayIsSelected = isSelected(day);
            const dayIsCurrentMonth = isCurrentMonth(day);

            return (
              <div
                key={day.toString()}
                className={cn(
                  "relative flex flex-col border-b border-r",
                  !dayIsCurrentMonth && "bg-accent/50"
                )}
              >
                <header
                  className={cn(
                    "flex items-center justify-between px-2 py-1.5 text-xs",
                    dayIsSelected && "bg-foreground text-primary-foreground",
                    !dayIsSelected && dayIsToday && "font-semibold",
                    !dayIsSelected && !dayIsCurrentMonth && "text-muted-foreground"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleDayClick(day)}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md",
                      dayIsSelected && "bg-primary-foreground text-foreground",
                      !dayIsSelected && dayIsToday && "border border-border",
                      !dayIsSelected && "hover:bg-muted"
                    )}
                  >
                    <time dateTime={format(day, "yyyy-MM-dd")}>
                      {format(day, "d")}
                    </time>
                  </button>
                </header>
                <div className="flex-1 p-2.5">
                  {events.length > 0 && (
                    <div className="space-y-1">
                      {events.slice(0, 1).map((event) => (
                        <div
                          key={event.id}
                          onClick={() => onEventClick?.(event)}
                          className={cn(
                            "cursor-pointer rounded-lg border p-2 text-xs transition hover:opacity-80",
                            getEventColor(event)
                          )}
                        >
                          <p className="truncate font-medium">{event.name}</p>
                          {event.valor && (
                            <p className="mt-0.5 text-[10px] font-semibold">
                              {formatCurrency(event.valor)}
                            </p>
                          )}
                        </div>
                      ))}
                      {events.length > 1 && (
                        <div className="text-[10px] text-muted-foreground">
                          +{events.length - 1} mais
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile Calendar */}
        <div className="isolate grid w-full grid-cols-7 grid-rows-5 border-x lg:hidden">
          {days.map((day) => {
            const dayData = getDayData(day);
            const events = dayData?.events || [];
            const dayIsToday = isToday(day);
            const dayIsSelected = isSelected(day);
            const dayIsCurrentMonth = isCurrentMonth(day);

            return (
              <button
                key={day.toString()}
                type="button"
                onClick={() => handleDayClick(day)}
                className={cn(
                  "flex h-auto min-h-[80px] flex-col border-b border-r p-1 text-left text-xs",
                  dayIsSelected && "bg-foreground text-primary-foreground",
                  !dayIsSelected && dayIsToday && "border-l-2 border-l-primary",
                  !dayIsCurrentMonth && "bg-accent/50 text-muted-foreground"
                )}
              >
                <time
                  dateTime={format(day, "yyyy-MM-dd")}
                  className={cn(
                    "mb-1 flex h-6 w-6 items-center justify-center rounded-md font-semibold",
                    dayIsSelected && "bg-primary-foreground text-foreground",
                    !dayIsSelected && dayIsToday && "bg-accent text-accent-foreground"
                  )}
                >
                  {format(day, "d")}
                </time>
                <div className="flex-1 space-y-0.5">
                  {events.slice(0, 2).map((event) => (
                    <div
                      key={event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick?.(event);
                      }}
                      className={cn(
                        "cursor-pointer rounded px-1.5 py-0.5 text-[10px]",
                        getEventColor(event)
                      )}
                    >
                      <div className="truncate font-medium">{event.name}</div>
                      {event.valor && (
                        <div className="text-[9px] font-semibold">
                          {formatCurrency(event.valor)}
                        </div>
                      )}
                    </div>
                  ))}
                  {events.length > 2 && (
                    <div className="text-[9px] text-muted-foreground">
                      +{events.length - 2} mais
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

