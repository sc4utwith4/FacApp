-- ============================================
-- SCRIPT PARA CORRIGIR LANÇAMENTOS DUPLICADOS DE OPERAÇÕES
-- Remove lançamentos principais quando há distribuições
-- ============================================

-- Este script identifica e remove lançamentos principais duplicados
-- que foram criados incorretamente quando havia distribuições

-- 1. Identificar operações com lançamentos duplicados
-- (lançamento principal + distribuições para a mesma operação)
WITH operacoes_com_duplicados AS (
  SELECT DISTINCT
    SUBSTRING(lc.historico FROM '#(\d+)')::BIGINT as operacao_id,
    COUNT(DISTINCT CASE WHEN lc.historico LIKE 'Operação%' AND lc.conta_bancaria_id IS NULL THEN lc.id END) as lancamentos_principais_sem_conta,
    COUNT(DISTINCT CASE WHEN lc.historico LIKE 'Distribuição Operação%' THEN lc.id END) as lancamentos_distribuicao
  FROM lancamentos_caixa lc
  WHERE lc.historico LIKE '%Operação%'
    AND (lc.historico LIKE 'Operação%' OR lc.historico LIKE 'Distribuição Operação%')
  GROUP BY operacao_id
  HAVING COUNT(DISTINCT CASE WHEN lc.historico LIKE 'Operação%' AND lc.conta_bancaria_id IS NULL THEN lc.id END) > 0
    AND COUNT(DISTINCT CASE WHEN lc.historico LIKE 'Distribuição Operação%' THEN lc.id END) > 0
)
SELECT 
  'Operações com lançamentos duplicados encontradas:' as info,
  COUNT(*) as total
FROM operacoes_com_duplicados;

-- 2. Listar lançamentos que serão removidos (lançamentos principais sem conta quando há distribuições)
SELECT 
  '=== LANÇAMENTOS QUE SERÃO REMOVIDOS ===' as acao;

SELECT 
  lc.id,
  lc.historico,
  lc.tipo,
  lc.valor,
  lc.conta_bancaria_id,
  lc.data,
  lc.created_at
FROM lancamentos_caixa lc
WHERE lc.historico LIKE 'Operação%'
  AND lc.conta_bancaria_id IS NULL
  AND EXISTS (
    -- Verificar se há distribuições para a mesma operação
    SELECT 1
    FROM lancamentos_caixa lc2
    WHERE lc2.historico LIKE 'Distribuição Operação%'
      AND SUBSTRING(lc.historico FROM '#(\d+)') = SUBSTRING(lc2.historico FROM '#(\d+)')
  )
ORDER BY lc.created_at DESC;

-- 3. REMOVER lançamentos principais sem conta quando há distribuições
-- DESCOMENTE AS LINHAS ABAIXO PARA EXECUTAR A REMOÇÃO
/*
DELETE FROM lancamentos_caixa
WHERE id IN (
  SELECT lc.id
  FROM lancamentos_caixa lc
  WHERE lc.historico LIKE 'Operação%'
    AND lc.conta_bancaria_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM lancamentos_caixa lc2
      WHERE lc2.historico LIKE 'Distribuição Operação%'
        AND SUBSTRING(lc.historico FROM '#(\d+)') = SUBSTRING(lc2.historico FROM '#(\d+)')
    )
);

SELECT 'Lançamentos duplicados removidos com sucesso!' as resultado;
*/

-- 4. Verificar saldo da conta SB-S0I2 após correção (se aplicável)
SELECT 
  '=== SALDO ATUAL DA CONTA SB-S0I2 ===' as info;

SELECT 
  cb.id,
  cb.descricao,
  cb.saldo_atual,
  cb.saldo_inicial,
  (cb.saldo_inicial + 
    COALESCE(SUM(CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END), 0)
  ) as saldo_calculado
FROM contas_bancarias cb
LEFT JOIN lancamentos_caixa lc ON lc.conta_bancaria_id = cb.id
WHERE cb.descricao ILIKE '%SB-S0I2%'
GROUP BY cb.id, cb.descricao, cb.saldo_atual, cb.saldo_inicial;

