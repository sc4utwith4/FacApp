import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";

interface MobileMenuProps {
  children: React.ReactNode;
  className?: string;
}

export const MobileMenu = ({ children, className }: MobileMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden p-2 rounded-md hover:bg-muted"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      
      <div className={cn(
        "md:block",
        isOpen ? "block" : "hidden"
      )}>
        {children}
      </div>
    </div>
  );
};

interface ResponsiveGridProps {
  children: React.ReactNode;
  className?: string;
  cols?: {
    default?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
}

export const ResponsiveGrid = ({ 
  children, 
  className, 
  cols = { default: 1, sm: 2, md: 3, lg: 4 } 
}: ResponsiveGridProps) => {
  const gridClasses = [
    `grid-cols-${cols.default}`,
    cols.sm && `sm:grid-cols-${cols.sm}`,
    cols.md && `md:grid-cols-${cols.md}`,
    cols.lg && `lg:grid-cols-${cols.lg}`,
    cols.xl && `xl:grid-cols-${cols.xl}`,
  ].filter(Boolean).join(" ");

  return (
    <div className={cn("grid gap-4", gridClasses, className)}>
      {children}
    </div>
  );
};

interface ResponsiveTableProps {
  children: React.ReactNode;
  className?: string;
}

export const ResponsiveTable = ({ children, className }: ResponsiveTableProps) => {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full", className)}>
        {children}
      </table>
    </div>
  );
};

interface MobileCardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
}

export const MobileCard = ({ children, className, title, subtitle }: MobileCardProps) => {
  return (
    <div className={cn(
      "rounded-lg border bg-card p-4 shadow-sm",
      "md:p-6",
      className
    )}>
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-lg font-semibold">{title}</h3>}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
};

interface ResponsiveTextProps {
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "base" | "lg" | "xl";
}

export const ResponsiveText = ({ 
  children, 
  className, 
  size = "base" 
}: ResponsiveTextProps) => {
  const sizeClasses = {
    sm: "text-sm md:text-base",
    base: "text-base md:text-lg",
    lg: "text-lg md:text-xl",
    xl: "text-xl md:text-2xl"
  };

  return (
    <p className={cn(sizeClasses[size], className)}>
      {children}
    </p>
  );
};

interface ResponsiveButtonProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
}

export const ResponsiveButton = ({ 
  children, 
  className, 
  variant = "default",
  size = "md"
}: ResponsiveButtonProps) => {
  const baseClasses = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background";
  
  const variantClasses = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-input hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground"
  };
  
  const sizeClasses = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 py-2",
    lg: "h-12 px-8 text-lg"
  };

  return (
    <button className={cn(
      baseClasses,
      variantClasses[variant],
      sizeClasses[size],
      "w-full sm:w-auto",
      className
    )}>
      {children}
    </button>
  );
};

// Hook para detectar tamanho da tela
export const useBreakpoint = () => {
  const [breakpoint, setBreakpoint] = useState<string>("sm");

  useEffect(() => {
    const updateBreakpoint = () => {
      const width = window.innerWidth;
      if (width >= 1280) setBreakpoint("xl");
      else if (width >= 1024) setBreakpoint("lg");
      else if (width >= 768) setBreakpoint("md");
      else if (width >= 640) setBreakpoint("sm");
      else setBreakpoint("xs");
    };

    updateBreakpoint();
    window.addEventListener("resize", updateBreakpoint);
    return () => window.removeEventListener("resize", updateBreakpoint);
  }, []);

  return breakpoint;
};

// Hook para detectar se é mobile
export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkIsMobile();
    window.addEventListener("resize", checkIsMobile);
    return () => window.removeEventListener("resize", checkIsMobile);
  }, []);

  return isMobile;
};





