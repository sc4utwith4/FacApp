import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionContainerProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SectionContainer({
  title,
  description,
  children,
  className,
}: SectionContainerProps) {
  return (
    <section className={cn("space-y-4 sm:space-y-5", className)}>
      {(title || description) && (
        <div className="space-y-2">
          {title && (
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{title}</h2>
          )}
          {description && (
            <p className="text-sm sm:text-base text-muted-foreground/80 leading-relaxed">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

