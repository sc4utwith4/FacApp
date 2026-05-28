import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Check, X, AlertCircle } from "lucide-react";

interface EnhancedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  success?: boolean;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  isLoading?: boolean;
}

export const EnhancedInput = forwardRef<HTMLInputElement, EnhancedInputProps>(
  ({ className, label, error, success, helperText, leftIcon, rightIcon, isLoading, ...props }, ref) => {
    return (
      <div className="space-y-2">
        {label && (
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {label}
            {props.required && <span className="text-destructive ml-1">*</span>}
          </label>
        )}
        
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
              {leftIcon}
            </div>
          )}
          
          <input
            className={cn(
              "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200",
              leftIcon && "pl-10",
              rightIcon && "pr-10",
              error && "border-destructive focus-visible:ring-destructive",
              success && "border-success focus-visible:ring-success",
              isLoading && "opacity-50 cursor-wait",
              className
            )}
            ref={ref}
            {...props}
          />
          
          {rightIcon && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
              {rightIcon}
            </div>
          )}
          
          {isLoading && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
            </div>
          )}
          
          {error && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-destructive">
              <X className="h-4 w-4" />
            </div>
          )}
          
          {success && !error && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-success">
              <Check className="h-4 w-4" />
            </div>
          )}
        </div>
        
        {error && (
          <div className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
        
        {helperText && !error && (
          <p className="text-sm text-muted-foreground">{helperText}</p>
        )}
      </div>
    );
  }
);

EnhancedInput.displayName = "EnhancedInput";

interface EnhancedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  success?: boolean;
  helperText?: string;
  isLoading?: boolean;
}

export const EnhancedTextarea = forwardRef<HTMLTextAreaElement, EnhancedTextareaProps>(
  ({ className, label, error, success, helperText, isLoading, ...props }, ref) => {
    return (
      <div className="space-y-2">
        {label && (
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {label}
            {props.required && <span className="text-destructive ml-1">*</span>}
          </label>
        )}
        
        <div className="relative">
          <textarea
            className={cn(
              "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 resize-none",
              error && "border-destructive focus-visible:ring-destructive",
              success && "border-success focus-visible:ring-success",
              isLoading && "opacity-50 cursor-wait",
              className
            )}
            ref={ref}
            {...props}
          />
          
          {isLoading && (
            <div className="absolute right-3 top-3">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
            </div>
          )}
        </div>
        
        {error && (
          <div className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
        
        {helperText && !error && (
          <p className="text-sm text-muted-foreground">{helperText}</p>
        )}
      </div>
    );
  }
);

EnhancedTextarea.displayName = "EnhancedTextarea";

interface EnhancedSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  success?: boolean;
  helperText?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  isLoading?: boolean;
}

export const EnhancedSelect = forwardRef<HTMLSelectElement, EnhancedSelectProps>(
  ({ className, label, error, success, helperText, options, placeholder, isLoading, ...props }, ref) => {
    return (
      <div className="space-y-2">
        {label && (
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {label}
            {props.required && <span className="text-destructive ml-1">*</span>}
          </label>
        )}
        
        <div className="relative">
          <select
            className={cn(
              "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 appearance-none",
              error && "border-destructive focus-visible:ring-destructive",
              success && "border-success focus-visible:ring-success",
              isLoading && "opacity-50 cursor-wait",
              className
            )}
            ref={ref}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
            <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          
          {isLoading && (
            <div className="absolute right-8 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
            </div>
          )}
          
          {error && (
            <div className="absolute right-8 top-1/2 transform -translate-y-1/2 text-destructive">
              <X className="h-4 w-4" />
            </div>
          )}
          
          {success && !error && (
            <div className="absolute right-8 top-1/2 transform -translate-y-1/2 text-success">
              <Check className="h-4 w-4" />
            </div>
          )}
        </div>
        
        {error && (
          <div className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
        
        {helperText && !error && (
          <p className="text-sm text-muted-foreground">{helperText}</p>
        )}
      </div>
    );
  }
);

EnhancedSelect.displayName = "EnhancedSelect";

interface FormFieldProps {
  children: React.ReactNode;
  className?: string;
}

export const FormField = ({ children, className }: FormFieldProps) => {
  return (
    <div className={cn("space-y-2", className)}>
      {children}
    </div>
  );
};

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const FormSection = ({ title, description, children, className }: FormSectionProps) => {
  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <h3 className="text-lg font-medium">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
};





