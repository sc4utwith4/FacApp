import { Navigate } from "react-router-dom";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";

interface AdminRouteProps {
  children: React.ReactNode;
}

/**
 * Componente de rota protegida para super admin
 * Redireciona para dashboard se usuário não for super admin
 */
export function AdminRoute({ children }: AdminRouteProps) {
  const { isSuperAdmin, loading } = useIsSuperAdmin();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Verificando permissões...</p>
        </div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}


