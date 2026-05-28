import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface StatusCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  status?: "success" | "error" | "neutral";
  icon?: React.ReactNode;
  loading?: boolean;
}

const statusClasses = {
  success: "text-success border-l-success",
  error: "text-destructive border-l-destructive",
  neutral: "text-muted-foreground border-l-muted-foreground",
};

export function StatusCard({
  title,
  value,
  status = "neutral",
  icon,
  loading = false,
  className,
  ...props
}: StatusCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border/30 bg-card p-4 shadow-sm transition-all duration-200 hover:shadow-md border-l-4",
        statusClasses[status],
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {icon && (
          <div className="text-muted-foreground opacity-70">{icon}</div>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24 rounded-md" />
      ) : (
        <div className="text-lg font-bold">{value}</div>
      )}
    </div>
  );
}

StatusCard.displayName = "StatusCard";
