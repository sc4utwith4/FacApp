-- ============================================
-- CORRIGIR POLÍTICA RLS DE MOVIMENTAÇÕES DE ESTOQUE
-- Permitir acesso a movimentações sem operacao_estoque_id (transferências diretas)
-- ============================================

-- Remover política antiga
DROP POLICY IF EXISTS "Users can manage own empresa movimentacoes estoque" ON public.movimentacoes_estoque;

-- Criar nova política que permite:
-- 1. Movimentações com operacao_estoque_id vinculada à empresa do usuário
-- 2. Movimentações sem operacao_estoque_id (transferências) quando os estoques pertencem à empresa
CREATE POLICY "Users can manage own empresa movimentacoes estoque" ON public.movimentacoes_estoque
  FOR ALL
  USING (
    -- Caso 1: Movimentação vinculada a uma operação de estoque da empresa
    (
      movimentacoes_estoque.operacao_estoque_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.operacoes_estoque
        WHERE operacoes_estoque.id = movimentacoes_estoque.operacao_estoque_id
        AND operacoes_estoque.empresa_id = get_user_empresa_id()
      )
    )
    OR
    -- Caso 2: Movimentação sem operação (transferência direta) quando estoques pertencem à empresa
    (
      movimentacoes_estoque.operacao_estoque_id IS NULL
      AND (
        -- Verificar se estoque_origem_id pertence à empresa
        (
          movimentacoes_estoque.estoque_origem_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.estoques
            WHERE estoques.id = movimentacoes_estoque.estoque_origem_id
            AND estoques.empresa_id = get_user_empresa_id()
          )
        )
        OR
        -- Verificar se estoque_destino_id pertence à empresa
        (
          movimentacoes_estoque.estoque_destino_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.estoques
            WHERE estoques.id = movimentacoes_estoque.estoque_destino_id
            AND estoques.empresa_id = get_user_empresa_id()
          )
        )
        OR
        -- Verificar se conta_origem_id pertence à empresa (transferências conta -> estoque)
        (
          movimentacoes_estoque.conta_origem_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.contas_bancarias
            WHERE contas_bancarias.id = movimentacoes_estoque.conta_origem_id
            AND contas_bancarias.empresa_id = get_user_empresa_id()
          )
        )
        OR
        -- Verificar se conta_bancaria_id pertence à empresa (distribuições e transferências)
        (
          movimentacoes_estoque.conta_bancaria_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.contas_bancarias
            WHERE contas_bancarias.id = movimentacoes_estoque.conta_bancaria_id
            AND contas_bancarias.empresa_id = get_user_empresa_id()
          )
        )
      )
    )
  );

-- Comentário para documentação
COMMENT ON POLICY "Users can manage own empresa movimentacoes estoque" ON public.movimentacoes_estoque IS 
'Permite acesso a movimentações vinculadas a operações da empresa ou transferências diretas entre estoques/contas da empresa';

