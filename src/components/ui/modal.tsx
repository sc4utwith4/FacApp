import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { useFocusTrap } from "./use-focus-trap";

interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

interface ModalContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

interface ModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

interface ModalTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

interface ModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

const ModalTitleIdContext = React.createContext<string | null>(null);

const Modal: React.FC<ModalProps> = ({ open, onOpenChange, children, className, size = "md", ...props }) => {
  const [mounted, setMounted] = React.useState(false);
  const titleId = React.useId();
  const containerRef = useFocusTrap(open && mounted);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };

    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [open, onOpenChange]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-backdrop"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      
      {/* Modal */}
      <div
        ref={containerRef}
        className={cn(
          "relative bg-background rounded-lg shadow-large max-h-[90vh] overflow-auto w-full mx-4",
          sizeClasses[size],
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...props}
      >
        <ModalTitleIdContext.Provider value={titleId}>
          {children}
        </ModalTitleIdContext.Provider>
      </div>
    </div>,
    document.body
  );
};

const ModalContent: React.FC<ModalContentProps> = ({ children, className, ...props }) => (
  <div className={cn("p-6", className)} {...props}>
    {children}
  </div>
);

const ModalHeader: React.FC<ModalHeaderProps> = ({ children, className, ...props }) => (
  <div className={cn("flex items-center justify-between mb-4", className)} {...props}>
    {children}
  </div>
);

const ModalTitle: React.FC<ModalTitleProps> = ({ children, className, id, ...props }) => {
  const contextualTitleId = React.useContext(ModalTitleIdContext);
  const resolvedTitleId = id || contextualTitleId || undefined;

  return (
    <h2 id={resolvedTitleId} className={cn("text-lg font-semibold", className)} {...props}>
      {children}
    </h2>
  );
};

const ModalFooter: React.FC<ModalFooterProps> = ({ children, className, ...props }) => (
  <div className={cn("flex justify-end space-x-2 mt-6", className)} {...props}>
    {children}
  </div>
);

// Componente para o botão de fechar
const ModalCloseButton: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Button
    variant="ghost"
    size="icon-sm"
    onClick={onClose}
    className="text-muted-foreground hover:text-foreground"
    aria-label="Fechar modal"
  >
    <X className="h-4 w-4" />
  </Button>
);

export { 
  Modal, 
  ModalContent, 
  ModalHeader, 
  ModalTitle, 
  ModalFooter, 
  ModalCloseButton
};



