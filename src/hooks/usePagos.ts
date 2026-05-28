import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Pagamento, FiltrosPagos } from '@/types/pagos';
import { ensureUUID, isValidUUID } from '@/lib/uuid';

export function usePagos(filtros: FiltrosPagos, incluirTodos: boolean = false) {
  return useQuery({
    queryKey: ['pagos', filtros, incluirTodos],
    queryFn: async () => {
      // Buscar empresa_id do usuário logado
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada para o usuário');
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId || !isValidUUID(empresaId)) {
        throw new Error('Empresa ID inválido');
      }

      // Construir query base
      let query = supabase
        .from('lancamentos_caixa')
        .select(`
          *,
          grupos_contas (
            id,
            nome,
            natureza
          ),
          contas_bancarias (
            id,
            descricao,
            agencia,
            conta,
            bancos (
              nome
            )
          )
        `)
        .eq('empresa_id', empresaId)
        .eq('tipo', 'saida')
        .order('data', { ascending: false });

      // Aplicar filtros (apenas se não for para buscar todos)
      if (!incluirTodos) {
        if (filtros.data_inicio) {
          query = query.gte('data', filtros.data_inicio);
        }

        if (filtros.data_fim) {
          query = query.lte('data', filtros.data_fim);
        }
      }

      if (filtros.conta_bancaria_id) {
        query = query.eq('conta_bancaria_id', filtros.conta_bancaria_id);
      }

      if (filtros.grupo_contas_id) {
        query = query.eq('grupo_contas_id', filtros.grupo_contas_id);
      }

      const { data, error } = await query;

      if (error) throw error;

      let pagamentos = (data || []) as Pagamento[];

      // Aplicar busca por texto (case insensitive)
      if (filtros.busca && filtros.busca.trim()) {
        const buscaLower = filtros.busca.toLowerCase().trim();
        pagamentos = pagamentos.filter((p) => {
          const historico = (p.historico || '').toLowerCase();
          const documento = (p.documento || '').toLowerCase();
          return historico.includes(buscaLower) || documento.includes(buscaLower);
        });
      }

      return pagamentos;
    },
    enabled: incluirTodos || (!!filtros.data_inicio && !!filtros.data_fim),
  });
}

