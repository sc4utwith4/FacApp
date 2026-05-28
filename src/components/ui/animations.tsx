import { cn } from "@/lib/utils";

// Animações de entrada
export const fadeIn = "animate-in fade-in duration-300";
export const slideInFromTop = "animate-in slide-in-from-top-4 duration-300";
export const slideInFromBottom = "animate-in slide-in-from-bottom-4 duration-300";
export const slideInFromLeft = "animate-in slide-in-from-left-4 duration-300";
export const slideInFromRight = "animate-in slide-in-from-right-4 duration-300";

// Animações de hover
export const hoverScale = "hover:scale-105 transition-transform duration-200";
export const hoverLift = "hover:-translate-y-1 transition-transform duration-200";
export const hoverGlow = "hover:shadow-lg transition-shadow duration-200";

// Animações de loading
export const pulse = "animate-pulse";
export const spin = "animate-spin";
export const bounce = "animate-bounce";

// Componentes animados
interface AnimatedCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export const AnimatedCard = ({ children, className, delay = 0 }: AnimatedCardProps) => {
  return (
    <div 
      className={cn(
        "animate-in fade-in slide-in-from-bottom-4 duration-500",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

interface StaggeredListProps {
  children: React.ReactNode[];
  className?: string;
}

export const StaggeredList = ({ children, className }: StaggeredListProps) => {
  return (
    <div className={className}>
      {children.map((child, index) => (
        <div
          key={index}
          className="animate-in fade-in slide-in-from-bottom-4 duration-300"
          style={{ animationDelay: `${index * 100}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
};





