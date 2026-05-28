-- ============================================
-- MIGRATION: Backfill devolucoes_transferencias (best effort)
-- ============================================
-- Popula devolucoes_transferencias com base em movimentações existentes.
-- Heurística: para cada movimentação devolucao_*, associa a uma devolução
-- da mesma empresa (LIFO por data) que possa absorver o valor.
-- Executar diagnóstico após o backfill; relatório obrigatório antes do go-live.
-- ============================================

-- Garantir constraint UNIQUE para ON CONFLICT (pode não existir se tabela veio de migration anterior)
ALTER TABLE public.devolucoes_transferencias
  DROP CONSTRAINT IF EXISTS uq_devolucao_movimentacao;
ALTER TABLE public.devolucoes_transferencias
  ADD CONSTRAINT uq_devolucao_movimentacao UNIQUE(devolucao_id, movimentacao_id);
DO $$
DECLARE
  mov_rec RECORD;
  dev_rec RECORD;
  valor_restante NUMERIC;
  valor_a_atribuir NUMERIC;
  valor_mov_restante NUMERIC;
  total_inseridos INT := 0;
BEGIN
  -- Para cada movimentação de transferência de devoluções
  FOR mov_rec IN
    SELECT 
      me.id AS movimentacao_id,
      me.valor,
      oe.empresa_id,
      oe.data AS data_operacao
    FROM movimentacoes_estoque me
    JOIN operacoes_estoque oe ON oe.id = me.operacao_estoque_id
    JOIN estoques e ON e.id = oe.estoque_id
    WHERE me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
      AND e.tipo = 'DEVOLUCOES'
      AND oe.tipo_operacao = 'saida'
      AND NOT EXISTS (
        SELECT 1 FROM devolucoes_transferencias dt
        WHERE dt.movimentacao_id = me.id
      )
    ORDER BY oe.data ASC, oe.id ASC, me.id ASC
  LOOP
    valor_mov_restante := mov_rec.valor;
    -- Para cada devolução da empresa, LIFO (mais recente primeiro), que tenha valor restante
    FOR dev_rec IN
      SELECT 
        de.id AS devolucao_id,
        de.valor_devolucao,
        (de.valor_devolucao - COALESCE(
          (SELECT SUM(dt.valor_transferido) FROM devolucoes_transferencias dt WHERE dt.devolucao_id = de.id),
          0
        )) AS valor_restante
      FROM devolucoes_estoque de
      WHERE de.empresa_id = mov_rec.empresa_id
        AND de.data_devolucao <= mov_rec.data_operacao
      ORDER BY de.data_devolucao DESC, de.id DESC
    LOOP
      valor_restante := dev_rec.valor_restante;
      IF valor_restante <= 0 OR valor_mov_restante <= 0 THEN
        CONTINUE;
      END IF;

      valor_a_atribuir := LEAST(valor_mov_restante, valor_restante);

      IF valor_a_atribuir > 0 THEN
        INSERT INTO devolucoes_transferencias (devolucao_id, movimentacao_id, valor_transferido)
        VALUES (dev_rec.devolucao_id, mov_rec.movimentacao_id, valor_a_atribuir)
        ON CONFLICT (devolucao_id, movimentacao_id) DO NOTHING;

        total_inseridos := total_inseridos + 1;
        valor_mov_restante := valor_mov_restante - valor_a_atribuir;

        EXIT WHEN valor_mov_restante <= 0;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Backfill: % vínculos criados em devolucoes_transferencias', total_inseridos;
END $$;
-- Expandir coluna status se necessário ('parcialmente_transferida' = 24 caracteres)
DO $$
BEGIN
  ALTER TABLE public.devolucoes_estoque
    ALTER COLUMN status TYPE VARCHAR(30);
EXCEPTION WHEN undefined_column THEN
  RAISE NOTICE 'Skipped ALTER COLUMN status: column does not exist yet';
WHEN OTHERS THEN
  RAISE NOTICE 'Skipped ALTER COLUMN status: %', SQLERRM;
END $$;
-- Recalcular status de todas as devoluções
DO $$
DECLARE
  dev_rec RECORD;
  v_status VARCHAR;
BEGIN
  FOR dev_rec IN SELECT id FROM devolucoes_estoque
  LOOP
    v_status := atualizar_status_devolucao(dev_rec.id);
  END LOOP;
  RAISE NOTICE 'Status de devoluções recalculado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipped recalc status: %', SQLERRM;
END $$;
