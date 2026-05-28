import { cn } from "@/lib/utils";
import { Loader2, AlertCircle, Search, FileText, Users, DollarSign } from "lucide-react";

interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className }: SkeletonProps) => {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted", className)} />
  );
};

export const TableSkeleton = () => {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center space-x-4">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-[200px]" />
          <Skeleton className="h-4 w-[100px]" />
          <Skeleton className="h-4 w-[80px]" />
          <Skeleton className="h-4 w-[60px]" />
        </div>
      ))}
    </div>
  );
};

export const CardSkeleton = () => {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-4" />
        </div>
        <Skeleton className="h-8 w-[80px]" />
        <Skeleton className="h-3 w-[100px]" />
      </div>
    </div>
  );
};

export const ChartSkeleton = () => {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="space-y-4">
        <Skeleton className="h-4 w-[150px]" />
        <div className="h-[300px] w-full">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    </div>
  );
};

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const LoadingSpinner = ({ size = "md", className }: LoadingSpinnerProps) => {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8"
  };

  return (
    <Loader2 className={cn("animate-spin text-muted-foreground", sizeClasses[size], className)} />
  );
};

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export const LoadingState = ({ message = "Carregando...", className }: LoadingStateProps) => {
  return (
    <div className={cn("flex items-center justify-center py-8", className)}>
      <div className="flex items-center space-x-2">
        <LoadingSpinner />
        <span className="text-muted-foreground">{message}</span>
      </div>
    </div>
  );
};

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState = ({ 
  icon, 
  title, 
  description, 
  action, 
  className 
}: EmptyStateProps) => {
  return (
    <div className={cn("flex flex-col items-center justify-center p-12 text-center", className)}>
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
        {icon || <FileText className="h-6 w-6 text-muted-foreground" />}
      </div>
      <h3 className="text-lg font-medium mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          {description}
        </p>
      )}
      {action}
    </div>
  );
};

interface ErrorStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const ErrorState = ({ 
  title = "Algo deu errado", 
  description = "Ocorreu um erro inesperado. Tente novamente.", 
  action,
  className 
}: ErrorStateProps) => {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <div className="rounded-full bg-destructive/10 p-6 mb-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-4">
        {description}
      </p>
      {action}
    </div>
  );
};

// Estados específicos para diferentes contextos
export const EmptyLancamentos = () => (
  <EmptyState
    icon={<DollarSign className="h-12 w-12 text-muted-foreground" />}
    title="Nenhum lançamento encontrado"
    description="Comece adicionando uma nova entrada ou saída financeira"
  />
);

export const EmptyFornecedores = () => (
  <EmptyState
    icon={<Users className="h-12 w-12 text-muted-foreground" />}
    title="Nenhum fornecedor encontrado"
    description="Cadastre seu primeiro fornecedor para começar"
  />
);

export const EmptySearch = ({ searchTerm }: { searchTerm: string }) => (
  <EmptyState
    icon={<Search className="h-12 w-12 text-muted-foreground" />}
    title="Nenhum resultado encontrado"
    description={`Não encontramos resultados para "${searchTerm}". Tente com outros termos.`}
  />
);

export const EmptyRelatorios = () => (
  <EmptyState
    icon={<FileText className="h-12 w-12 text-muted-foreground" />}
    title="Nenhum relatório disponível"
    description="Selecione um período para gerar relatórios"
  />
);

// Componente de loading com overlay
interface LoadingOverlayProps {
  isLoading: boolean;
  children: React.ReactNode;
  message?: string;
}

export const LoadingOverlay = ({ isLoading, children, message = "Carregando..." }: LoadingOverlayProps) => {
  return (
    <div className="relative">
      {children}
      {isLoading && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex items-center space-x-2 bg-background p-4 rounded-lg shadow-lg">
            <LoadingSpinner />
            <span className="text-sm font-medium">{message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Componente de loading para botões
interface LoadingButtonProps {
  isLoading: boolean;
  children: React.ReactNode;
  loadingText?: string;
  className?: string;
}

export const LoadingButton = ({ 
  isLoading, 
  children, 
  loadingText = "Carregando...", 
  className 
}: LoadingButtonProps) => {
  return (
    <button 
      className={cn(
        "flex items-center justify-center gap-2",
        isLoading && "opacity-50 cursor-not-allowed",
        className
      )}
      disabled={isLoading}
    >
      {isLoading && <LoadingSpinner size="sm" />}
      {isLoading ? loadingText : children}
    </button>
  );
};

// Skeleton para página de relatório (cards + tabela)
interface PageLoadingSkeletonProps {
  showHeader?: boolean;
  showCards?: number;
  showTable?: boolean;
  className?: string;
}

export const PageLoadingSkeleton = ({
  showHeader = true,
  showCards = 5,
  showTable = true,
  className,
}: PageLoadingSkeletonProps) => {
  return (
    <div className={cn("space-y-6 animate-pulse", className)}>
      {showHeader && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
      )}
      {showCards > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: showCards }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}
      {showTable && (
        <div className="rounded-lg border bg-card p-4">
          <div className="space-y-3 mb-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </div>
          <TableSkeleton />
        </div>
      )}
    </div>
  );
};

