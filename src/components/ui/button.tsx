import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent px-4 py-2 text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-text text-background hover:bg-text/90",
        secondary: "bg-neutral-100 text-text hover:bg-neutral-200",
        ghost: "text-text-secondary hover:bg-neutral-50 hover:text-text",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-background hover:bg-accent",
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        link: "text-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        default: "h-9 px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    
    // Filter out invalid props when using asChild with Link components
    const { href, ...filteredProps } = props as any;
    
    // When asChild is true, we can't use leftIcon/rightIcon as they create multiple children
    // The child component should handle its own icons
    if (asChild) {
      return (
        <Comp 
          className={cn(buttonVariants({ variant, size, className }))} 
          ref={ref} 
          disabled={disabled || loading}
          aria-disabled={disabled || loading}
          {...filteredProps}
        >
          {children}
        </Comp>
      );
    }
    
    return (
      <Comp 
        className={cn(buttonVariants({ variant, size, className }))} 
        ref={ref} 
        disabled={disabled || loading}
        aria-disabled={disabled || loading}
        {...filteredProps}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          leftIcon && <span className="mr-1">{leftIcon}</span>
        )}
        {children}
        {rightIcon && !loading && <span className="ml-1">{rightIcon}</span>}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
