'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface PromptInputContextValue {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

const PromptInputContext = React.createContext<PromptInputContextValue | null>(null);

function usePromptInputContext() {
  const ctx = React.useContext(PromptInputContext);
  if (!ctx) {
    throw new Error('PromptInput subcomponents must be used within PromptInput');
  }
  return ctx;
}

export interface PromptInputProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

function PromptInputRoot({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  className,
  children,
}: PromptInputProps) {
  const contextValue: PromptInputContextValue = React.useMemo(
    () => ({ value, onValueChange, onSubmit, disabled }),
    [value, onValueChange, onSubmit, disabled]
  );

  return (
    <PromptInputContext.Provider value={contextValue}>
      <div
        className={cn(
          'flex w-full flex-col gap-2 rounded-lg border bg-background',
          className
        )}
      >
        {children}
      </div>
    </PromptInputContext.Provider>
  );
}

export interface PromptInputTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  placeholder?: string;
}

const PromptInputTextarea = React.forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  ({ placeholder = 'Digite uma mensagem ou clique numa sugestão...', className, ...props }, ref) => {
    const { value, onValueChange, onSubmit, disabled } = usePromptInputContext();

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        onValueChange('');
        e.preventDefault();
        props.onKeyDown?.(e);
        return;
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        onSubmit();
        props.onKeyDown?.(e);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
      props.onKeyDown?.(e);
    };

    return (
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(
          'min-h-[80px] w-full resize-none rounded-md border-0 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        rows={2}
        {...props}
        onKeyDown={handleKeyDown}
      />
    );
  }
);
PromptInputTextarea.displayName = 'PromptInputTextarea';

export interface PromptInputActionsProps {
  className?: string;
  children: React.ReactNode;
}

function PromptInputActions({ className, children }: PromptInputActionsProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t px-2 py-1.5',
        className
      )}
    >
      {children}
    </div>
  );
}

export const PromptInput = Object.assign(PromptInputRoot, {
  Textarea: PromptInputTextarea,
  Actions: PromptInputActions,
});

export { PromptInputTextarea, PromptInputActions };
