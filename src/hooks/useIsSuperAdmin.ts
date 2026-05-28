import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// Cache global para evitar múltiplas chamadas simultâneas
let cachedValue: boolean | null = null;
let cacheTimestamp: number = 0;
let isChecking = false;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

export function __resetUseIsSuperAdminCacheForTests() {
  cachedValue = null;
  cacheTimestamp = 0;
  isChecking = false;
}

/**
 * Hook para verificar se o usuário atual é super admin
 * Utiliza cache global para evitar chamadas redundantes entre componentes
 * @returns {boolean} true se o usuário é super admin, false caso contrário
 */
export function useIsSuperAdmin() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Verificar se está no cliente (evitar problemas com SSR)
    if (typeof window === 'undefined') {
      return;
    }

    // Verificar cache antes de fazer nova chamada
    const now = Date.now();
    if (cachedValue !== null && (now - cacheTimestamp) < CACHE_DURATION && !isChecking) {
      setIsSuperAdmin(cachedValue);
      setLoading(false);
      return;
    }

    const checkSuperAdmin = async () => {
      // Evitar múltiplas chamadas simultâneas
      if (isChecking) {
        // Aguardar resultado da chamada em andamento
        const maxWait = 5000; // 5 segundos
        const startWait = Date.now();
        while (isChecking && (Date.now() - startWait) < maxWait) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (cachedValue !== null) {
          setIsSuperAdmin(cachedValue);
          setLoading(false);
          return;
        }
      }

      isChecking = true;
      try {
        setLoading(true);
        setError(null);

        // Verificar se há sessão
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          setIsSuperAdmin(false);
          setLoading(false);
          return;
        }

        // Buscar diretamente por ID (mais rápido e confiável)
        let isAdmin = false;

        const { data: profileById, error: profileByIdError } = await supabase
          .from("profiles")
          .select("id, is_super_admin")
          .eq("id", session.user.id)
          .maybeSingle();
        
        if (profileById && !profileByIdError) {
          isAdmin = profileById.is_super_admin ?? false;
        } else {
          // Fail-safe: sem perfil válido não concede privilégio de super admin.
          // A elevação depende exclusivamente de profiles.is_super_admin.
          // Log apenas em desenvolvimento
          if (process.env.NODE_ENV === 'development' && profileByIdError) {
            console.warn('useIsSuperAdmin: Profile query failed, super admin denied by fail-safe:', profileByIdError);
          }
        }
        
        // Atualizar cache global
        cachedValue = isAdmin;
        cacheTimestamp = Date.now();
        
        if (mountedRef.current) {
          setIsSuperAdmin(isAdmin);
          setLoading(false);
        }
      } catch (err) {
        // Log apenas em desenvolvimento
        if (process.env.NODE_ENV === 'development') {
          console.error("useIsSuperAdmin: Hook error:", err);
        }
        const error = err instanceof Error ? err : new Error("Erro desconhecido");
        setError(error);
        
        // Atualizar cache mesmo em caso de erro (assumir false)
        cachedValue = false;
        cacheTimestamp = Date.now();
        
        if (mountedRef.current) {
          setIsSuperAdmin(false);
          setLoading(false);
        }
      } finally {
        isChecking = false;
      }
    };

    checkSuperAdmin();

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Invalidar cache quando auth muda
      cachedValue = null;
      cacheTimestamp = 0;
      
      if (session) {
        checkSuperAdmin();
      } else {
        if (mountedRef.current) {
          setIsSuperAdmin(false);
          setLoading(false);
        }
        // Limpar cache ao fazer logout
        cachedValue = false;
        cacheTimestamp = Date.now();
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  return { isSuperAdmin, loading, error };
}
