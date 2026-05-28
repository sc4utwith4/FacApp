import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface MetricCardLargeProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: string;
    type: 'up' | 'down' | 'neutral';
  };
  isPrimary?: boolean;
  loading?: boolean;
  className?: string;
}

export function MetricCardLarge({
  title,
  value,
  subtitle,
  icon,
  trend,
  isPrimary = false,
  loading = false,
  className,
}: MetricCardLargeProps) {
  return (
    <Card
      className={cn(
        "border-border/20 bg-card shadow-sm transition-all duration-200 hover:shadow-md",
        isPrimary && "border-primary/30 bg-primary/5",
        className
      )}
    >
      <CardContent className={cn("p-4 sm:p-5", isPrimary && "p-4 sm:p-5")}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">{title}</p>
            {subtitle && !loading && (
              <p className="text-xs text-muted-foreground/70">{subtitle}</p>
            )}
          </div>
          {icon && (
            <div className={cn(
              "text-muted-foreground/50",
              isPrimary && "text-primary/50"
            )}>
              {icon}
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          {loading ? (
            <>
              <Skeleton className="h-6 sm:h-8 w-32 sm:w-40 rounded-md" />
              <Skeleton className="h-4 w-48 sm:w-56 rounded-md" />
            </>
          ) : (
            <>
              <p className={cn(
                "font-bold text-text whitespace-nowrap",
                "text-base sm:text-lg"
              )}>
                {value}
              </p>
              {trend && (
                <div className={cn(
                  "flex items-center gap-2 text-xs sm:text-sm font-medium",
                  trend.type === 'up' && "text-success",
                  trend.type === 'down' && "text-destructive",
                  trend.type === 'neutral' && "text-muted-foreground"
                )}>
                  <span>{trend.value}</span>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

