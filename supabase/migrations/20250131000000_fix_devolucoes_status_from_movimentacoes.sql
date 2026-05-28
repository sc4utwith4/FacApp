-- ============================================
-- MIGRATION: Corrigir Status de Devoluções Baseado em Movimentações
-- ============================================
-- Corrige o status de devoluções que foram transferidas mas ainda estão marcadas como "pendente"
-- Calcula o valor total transferido baseado nas movimentações e atualiza o status corretamente
-- 
-- IMPORTANTE: Esta migration usa uma heurística para relacionar devoluções com movimentações.
-- Como não há relação direta entre devoluções e movimentações, usamos:
-- - Operações SAÍDA do estoque DEVOLUCOES criadas após a data da devolução
-- - Movimentações relacionadas a essas operações
-- - Correspondência por valor e data

-- ============================================
-- 1. CORRIGIR STATUS BASEADO EM MOVIMENTAÇÕES
-- ============================================
-- Para cada devolução, busca operações SAÍDA do estoque DEVOLUCOES criadas após a devolução
-- e calcula o valor total transferido através das movimentações relacionadas
DO $$
DECLARE
  devolucao_record RECORD;
  estoque_devolucoes_id INTEGER;
  valor_transferido_total NUMERIC(15,2);
  novo_status VARCHAR(20);
  operacao_record RECORD;
  movimentacao_record RECORD;
  total_corrigido INTEGER := 0;
BEGIN
  -- Buscar ID do estoque DEVOLUCOES
  SELECT id INTO estoque_devolucoes_id
  FROM estoques
  WHERE tipo = 'DEVOLUCOES'
  LIMIT 1;
  
  IF estoque_devolucoes_id IS NULL THEN
    RAISE NOTICE 'Estoque DEVOLUCOES não encontrado. Pulando correção.';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Iniciando correção de status de devoluções...';
  RAISE NOTICE 'Estoque DEVOLUCOES ID: %', estoque_devolucoes_id;
  
  -- Para cada devolução
  FOR devolucao_record IN 
    SELECT 
      de.id,
      de.valor_devolucao,
      de.status,
      de.data_devolucao,
      de.empresa_id
    FROM devolucoes_estoque de
    ORDER BY de.id
  LOOP
    valor_transferido_total := 0;
    
    -- Buscar todas as operações SAÍDA do estoque DEVOLUCOES
    -- que foram criadas após a data da devolução (dentro de 30 dias)
    FOR operacao_record IN
      SELECT 
        oe.id,
        oe.data,
        oe.liquido_operacao,
        oe.empresa_id,
        oe.historico
      FROM operacoes_estoque oe
      WHERE oe.estoque_id = estoque_devolucoes_id
        AND oe.tipo_operacao = 'saida'
        AND oe.empresa_id = devolucao_record.empresa_id
        AND oe.data >= devolucao_record.data_devolucao
        AND ABS(oe.data - devolucao_record.data_devolucao) <= 30 -- 30 dias
      ORDER BY oe.data ASC, oe.id ASC
    LOOP
      -- Para cada operação, buscar movimentações relacionadas
      FOR movimentacao_record IN
        SELECT 
          me.id,
          me.valor,
          me.tipo
        FROM movimentacoes_estoque me
        WHERE me.operacao_estoque_id = operacao_record.id
          AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
      LOOP
        -- Somar valor transferido
        -- IMPORTANTE: Limitar ao valor da devolução para evitar somar valores de outras devoluções
        IF (valor_transferido_total + movimentacao_record.valor) <= devolucao_record.valor_devolucao THEN
          valor_transferido_total := valor_transferido_total + movimentacao_record.valor;
        ELSIF valor_transferido_total < devolucao_record.valor_devolucao THEN
          -- Se já transferiu parcialmente, somar apenas o restante
          valor_transferido_total := devolucao_record.valor_devolucao;
        END IF;
      END LOOP;
    END LOOP;
    
    -- Determinar novo status
    IF valor_transferido_total >= devolucao_record.valor_devolucao THEN
      novo_status := 'transferida';
    ELSIF valor_transferido_total > 0 THEN
      novo_status := 'parcialmente_transferida';
    ELSE
      novo_status := 'pendente';
    END IF;
    
    -- Atualizar status apenas se for diferente
    IF novo_status != COALESCE(devolucao_record.status, 'pendente') THEN
      UPDATE devolucoes_estoque
      SET status = novo_status
      WHERE id = devolucao_record.id;
      
      total_corrigido := total_corrigido + 1;
      
      RAISE NOTICE 'Devolução #%: Status atualizado de "%" para "%" (Valor devolução: R$ %, Valor transferido: R$ %)',
        devolucao_record.id,
        COALESCE(devolucao_record.status, 'pendente'),
        novo_status,
        devolucao_record.valor_devolucao,
        valor_transferido_total;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Correção concluída. Total de devoluções corrigidas: %', total_corrigido;
END $$;

-- ============================================
-- 2. FUNÇÃO AUXILIAR PARA RECALCULAR STATUS (OPCIONAL)
-- ============================================
-- Função que pode ser chamada manualmente para recalcular o status de uma devolução específica
CREATE OR REPLACE FUNCTION recalcular_status_devolucao(devolucao_id_param INTEGER)
RETURNS VARCHAR(20) AS $$
DECLARE
  devolucao_record RECORD;
  estoque_devolucoes_id INTEGER;
  valor_transferido_total NUMERIC(15,2);
  novo_status VARCHAR(20);
  operacao_record RECORD;
  movimentacao_record RECORD;
BEGIN
  -- Buscar devolução
  SELECT id, valor_devolucao, data_devolucao, empresa_id, status
  INTO devolucao_record
  FROM devolucoes_estoque
  WHERE id = devolucao_id_param;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução #% não encontrada', devolucao_id_param;
  END IF;
  
  -- Buscar ID do estoque DEVOLUCOES
  SELECT id INTO estoque_devolucoes_id
  FROM estoques
  WHERE tipo = 'DEVOLUCOES'
    AND empresa_id = devolucao_record.empresa_id
  LIMIT 1;
  
  IF estoque_devolucoes_id IS NULL THEN
    RETURN 'pendente';
  END IF;
  
  valor_transferido_total := 0;
  
  -- Buscar operações SAÍDA relacionadas
  FOR operacao_record IN
    SELECT 
      oe.id,
      oe.data,
      oe.liquido_operacao,
      oe.empresa_id
    FROM operacoes_estoque oe
    WHERE oe.estoque_id = estoque_devolucoes_id
      AND oe.tipo_operacao = 'saida'
      AND oe.empresa_id = devolucao_record.empresa_id
      AND oe.data >= devolucao_record.data_devolucao
      AND ABS(oe.data - devolucao_record.data_devolucao) <= 30
    ORDER BY oe.data ASC, oe.id ASC
  LOOP
    FOR movimentacao_record IN
      SELECT me.valor
      FROM movimentacoes_estoque me
      WHERE me.operacao_estoque_id = operacao_record.id
        AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
    LOOP
      IF (valor_transferido_total + movimentacao_record.valor) <= devolucao_record.valor_devolucao THEN
        valor_transferido_total := valor_transferido_total + movimentacao_record.valor;
      ELSIF valor_transferido_total < devolucao_record.valor_devolucao THEN
        valor_transferido_total := devolucao_record.valor_devolucao;
      END IF;
    END LOOP;
  END LOOP;
  
  -- Determinar status
  IF valor_transferido_total >= devolucao_record.valor_devolucao THEN
    novo_status := 'transferida';
  ELSIF valor_transferido_total > 0 THEN
    novo_status := 'parcialmente_transferida';
  ELSE
    novo_status := 'pendente';
  END IF;
  
  -- Atualizar se diferente
  IF novo_status != COALESCE(devolucao_record.status, 'pendente') THEN
    UPDATE devolucoes_estoque
    SET status = novo_status
    WHERE id = devolucao_id_param;
  END IF;
  
  RETURN novo_status;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. COMENTÁRIOS
-- ============================================
COMMENT ON FUNCTION recalcular_status_devolucao(INTEGER) IS 'Recalcula e atualiza o status de uma devolução específica baseado nas movimentações relacionadas';

