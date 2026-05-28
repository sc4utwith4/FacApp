-- ============================================
-- Script para Recalcular Todos os Saldos das Contas Bancárias
-- Execute este script no Supabase SQL Editor
-- 
-- Este script garante que todos os saldos sejam calculados corretamente:
-- saldo_atual = saldo_inicial + entradas - saídas
-- ============================================

-- Opção 1: Recalcular todas as contas de uma empresa específica
-- Substitua 'SEU_EMPRESA_ID_AQUI' pelo UUID da sua empresa
/*
SELECT recalcular_todos_saldos_empresa('SEU_EMPRESA_ID_AQUI');
*/

-- Opção 2: Recalcular todas as contas manualmente
DO $$
DECLARE
  conta_record RECORD;
  saldo_inicial_val NUMERIC;
  saldo_calculado NUMERIC;
  saldo_final NUMERIC;
  contas_atualizadas INTEGER := 0;
BEGIN
  RAISE NOTICE 'Iniciando recálculo de saldos...';
  
  -- Loop através de todas as contas bancárias
  FOR conta_record IN 
    SELECT id, saldo_inicial, descricao, empresa_id
    FROM contas_bancarias
    ORDER BY empresa_id, descricao
  LOOP
    -- Buscar saldo inicial
    saldo_inicial_val := COALESCE(conta_record.saldo_inicial, 0);
    
    -- Calcular saldo baseado em todos os lançamentos
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
    ), 0) INTO saldo_calculado
    FROM lancamentos_caixa
    WHERE conta_bancaria_id = conta_record.id;
    
    -- Calcular saldo final: saldo_inicial + entradas - saídas
    saldo_final := saldo_inicial_val + saldo_calculado;
    
    -- Atualizar saldo_atual apenas se for diferente
    IF COALESCE((SELECT saldo_atual FROM contas_bancarias WHERE id = conta_record.id), 0) != saldo_final THEN
      UPDATE contas_bancarias
      SET saldo_atual = saldo_final
      WHERE id = conta_record.id;
      
      contas_atualizadas := contas_atualizadas + 1;
      
      RAISE NOTICE 'Conta atualizada: % (ID: %) - Saldo anterior: %, Saldo novo: %', 
        conta_record.descricao, 
        conta_record.id,
        COALESCE((SELECT saldo_atual FROM contas_bancarias WHERE id = conta_record.id), 0),
        saldo_final;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Recálculo concluído! Total de contas atualizadas: %', contas_atualizadas;
END $$;

-- Verificar resultados
SELECT 
  cb.id,
  cb.descricao,
  cb.saldo_inicial,
  cb.saldo_atual,
  COALESCE(SUM(
    CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END
  ), 0) as saldo_calculado,
  cb.saldo_inicial + COALESCE(SUM(
    CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END
  ), 0) as saldo_esperado,
  CASE 
    WHEN cb.saldo_atual = (cb.saldo_inicial + COALESCE(SUM(
      CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END
    ), 0)) THEN 'OK'
    ELSE 'ERRO'
  END as status
FROM contas_bancarias cb
LEFT JOIN lancamentos_caixa lc ON lc.conta_bancaria_id = cb.id
GROUP BY cb.id, cb.descricao, cb.saldo_inicial, cb.saldo_atual
ORDER BY status DESC, cb.descricao;

