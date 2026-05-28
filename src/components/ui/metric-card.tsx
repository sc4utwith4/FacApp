import * as React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: {
    value: string;
    type: 'up' | 'down' | 'neutral';
  };
}

const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  ({ className, title, value, icon, trend, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative overflow-hidden rounded-lg border border-border/30 bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md",
          className
        )}
        {...props}
      >
        {/* Header com título e ícone */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-muted-foreground">
            {title}
          </p>
          {icon && (
            <div className="text-muted-foreground">
              {icon}
            </div>
          )}
        </div>

        {/* Valor grande */}
        <div className="text-2xl font-bold text-foreground mb-1">
          {value}
        </div>

        {/* Tendência (opcional) */}
        {trend && (
          <div className={cn(
            "text-xs font-medium flex items-center gap-1 mt-1",
            trend.type === 'up' && "text-success",
            trend.type === 'down' && "text-destructive",
            trend.type === 'neutral' && "text-muted-foreground"
          )}>
            {trend.type === 'up' && <TrendingUp className="h-3 w-3" />}
            {trend.type === 'down' && <TrendingDown className="h-3 w-3" />}
            <span>{trend.value}</span>
          </div>
        )}
      </div>
    );
  }
);
MetricCard.displayName = "MetricCard";

export { MetricCard };


