import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  action?: React.ReactNode;
  description?: string;
}

export function PageHeader({ 
  title, 
  action, 
  description,
  className,
  ...props 
}: PageHeaderProps) {
  return (
    <div 
      className={cn("flex items-center justify-between mb-6", className)}
      {...props}
    >
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div>
          {action}
        </div>
      )}
    </div>
  );
}


