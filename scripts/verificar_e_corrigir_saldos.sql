-- ============================================
-- Script para Verificar e Corrigir Saldos
-- Execute este script no Supabase SQL Editor
-- ============================================

-- 1. Verificar contas com saldos que parecem incorretos
-- (saldo muito diferente do esperado)
SELECT 
  cb.id,
  cb.descricao,
  cb.saldo_inicial,
  cb.saldo_atual as saldo_atual_atual,
  COALESCE(SUM(
    CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END
  ), 0) as movimentacao_total,
  cb.saldo_inicial + COALESCE(SUM(
    CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END
  ), 0) as saldo_esperado,
  cb.saldo_atual - (cb.saldo_inicial + COALESCE(SUM(
    CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END
  ), 0)) as diferenca,
  COUNT(lc.id) as total_lancamentos,
  COUNT(CASE WHEN lc.tipo = 'entrada' THEN 1 END) as total_entradas,
  COUNT(CASE WHEN lc.tipo = 'saida' THEN 1 END) as total_saidas,
  COALESCE(SUM(CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE 0 END), 0) as soma_entradas,
  COALESCE(SUM(CASE WHEN lc.tipo = 'saida' THEN lc.valor ELSE 0 END), 0) as soma_saidas
FROM contas_bancarias cb
LEFT JOIN lancamentos_caixa lc ON lc.conta_bancaria_id = cb.id
GROUP BY cb.id, cb.descricao, cb.saldo_inicial, cb.saldo_atual
HAVING ABS(cb.saldo_atual - (cb.saldo_inicial + COALESCE(SUM(
  CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END
), 0))) > 0.01
ORDER BY ABS(cb.saldo_atual - (cb.saldo_inicial + COALESCE(SUM(
  CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END
), 0))) DESC;

-- 2. Verificar lançamentos duplicados ou suspeitos
SELECT 
  lc.id,
  lc.conta_bancaria_id,
  cb.descricao as conta_descricao,
  lc.data,
  lc.tipo,
  lc.valor,
  lc.historico,
  lc.documento,
  lc.created_at
FROM lancamentos_caixa lc
JOIN contas_bancarias cb ON cb.id = lc.conta_bancaria_id
WHERE lc.conta_bancaria_id IN (
  SELECT id FROM contas_bancarias 
  WHERE ABS(saldo_atual - (
    saldo_inicial + COALESCE((
      SELECT SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END)
      FROM lancamentos_caixa
      WHERE conta_bancaria_id = contas_bancarias.id
    ), 0)
  )) > 1000
)
ORDER BY lc.conta_bancaria_id, lc.data DESC, lc.created_at DESC;

-- 3. Recalcular saldo de uma conta específica (substitua o UUID)
-- SELECT recalcular_saldo_conta('UUID_DA_CONTA_AQUI');

-- 4. Recalcular todos os saldos de uma empresa (substitua o UUID)
-- SELECT * FROM recalcular_todos_saldos_empresa('UUID_DA_EMPRESA_AQUI');

-- 5. Recalcular TODOS os saldos de TODAS as contas
DO $$
DECLARE
  conta_record RECORD;
  saldo_inicial_val NUMERIC;
  saldo_calculado NUMERIC;
  saldo_final NUMERIC;
BEGIN
  FOR conta_record IN 
    SELECT id, saldo_inicial, descricao
    FROM contas_bancarias
  LOOP
    saldo_inicial_val := COALESCE(conta_record.saldo_inicial, 0);
    
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
    ), 0) INTO saldo_calculado
    FROM lancamentos_caixa
    WHERE conta_bancaria_id = conta_record.id;
    
    saldo_final := saldo_inicial_val + saldo_calculado;
    
    UPDATE contas_bancarias
    SET saldo_atual = saldo_final,
        updated_at = NOW()
    WHERE id = conta_record.id;
  END LOOP;
END $$;

