import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ensureUUID, isConflictError } from '@/lib/uuid';

/**
 * Hook para obter a empresa_id do usuário logado
 * @returns empresa_id do usuário ou null se não encontrado
 */
export function useUserEmpresa() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchEmpresaId = async () => {
      try {
        setLoading(true);
        
        // Buscar sessão atual
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session?.user) {
          setError(new Error('Usuário não autenticado'));
          setLoading(false);
          return;
        }

        // Buscar perfil do usuário
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('empresa_id')
          .eq('id', session.user.id)
          .maybeSingle();

        if (profileError) {
          setError(new Error(`Erro ao buscar perfil: ${profileError.message}`));
          setLoading(false);
          return;
        }

        // Se perfil não existe, criar automaticamente
        if (!profile) {
          const empresaIdPadrao = '00000000-0000-0000-0000-000000000001';
          const nomeUsuario = session.user.user_metadata?.nome || session.user.email?.split('@')[0] || 'Usuário';
          
          const { error: insertError } = await supabase
            .from('profiles')
            .insert({
              id: session.user.id,
              empresa_id: empresaIdPadrao,
              nome: nomeUsuario,
              email: session.user.email || '',
              perfil: 'Admin',
            });
          
          if (insertError) {
            // Se o erro for 409 (Conflict) ou duplicate key, o perfil já existe, então buscar novamente
            if (isConflictError(insertError)) {
              // Perfil já existe, buscar novamente
              const { data: existingProfile } = await supabase
                .from('profiles')
                .select('empresa_id')
                .eq('id', session.user.id)
                .maybeSingle();
              
              if (existingProfile?.empresa_id) {
                const empresaIdValue = ensureUUID(existingProfile.empresa_id);
                if (empresaIdValue) {
                  setEmpresaId(empresaIdValue);
                  setError(null);
                  setLoading(false);
                  return;
                }
              }
              // Se não encontrou o perfil, tentar buscar novamente após um pequeno delay
              await new Promise(resolve => setTimeout(resolve, 100));
              const { data: retryProfile } = await supabase
                .from('profiles')
                .select('empresa_id')
                .eq('id', session.user.id)
                .maybeSingle();
              
              if (retryProfile?.empresa_id) {
                const empresaIdValue = ensureUUID(retryProfile.empresa_id);
                if (empresaIdValue) {
                  setEmpresaId(empresaIdValue);
                  setError(null);
                  setLoading(false);
                  return;
                }
              }
              // Se ainda não encontrou, não mostrar erro - perfil pode ter sido criado pelo trigger
              setError(null);
              setLoading(false);
              return;
            }
            
            setError(new Error(`Erro ao criar perfil: ${insertError.message}`));
            setLoading(false);
            return;
          }
          
          // Após criar, buscar novamente
          const { data: newProfile } = await supabase
            .from('profiles')
            .select('empresa_id')
            .eq('id', session.user.id)
            .maybeSingle();
          
          if (newProfile?.empresa_id) {
            const empresaIdValue = ensureUUID(newProfile.empresa_id);
            if (empresaIdValue) {
              setEmpresaId(empresaIdValue);
              setError(null);
              setLoading(false);
              return;
            }
          }
          
          setError(new Error('Erro ao criar perfil'));
          setLoading(false);
          return;
        }

        if (!profile.empresa_id) {
          setError(new Error('Perfil não encontrado ou empresa não configurada'));
          setLoading(false);
          return;
        }

        // Garantir que seja string UUID válido
        const empresaIdValue = ensureUUID(profile.empresa_id);
        if (!empresaIdValue) {
          setError(new Error(`empresa_id inválido: ${profile.empresa_id} (tipo: ${typeof profile.empresa_id})`));
          setLoading(false);
          return;
        }

        setEmpresaId(empresaIdValue);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Erro desconhecido'));
      } finally {
        setLoading(false);
      }
    };

    fetchEmpresaId();

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchEmpresaId();
      } else {
        setEmpresaId(null);
        setError(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { empresaId, loading, error };
}













