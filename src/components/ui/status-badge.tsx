import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        pendente: "bg-warning/20 text-warning-foreground",
        pago: "bg-success/20 text-success-foreground",
        vencido: "bg-destructive/20 text-destructive-foreground",
        cancelado: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "pendente",
    },
  }
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(statusBadgeVariants({ variant }), className)}
        {...props}
      />
    );
  }
);
StatusBadge.displayName = "StatusBadge";

export { StatusBadge, statusBadgeVariants };


