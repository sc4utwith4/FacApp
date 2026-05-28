-- ============================================
-- SCRIPT PARA CORRIGIR TODAS AS CONTAS COM SALDO MANUAL
-- Aplica data_corte_saldo e saldo_base_ajustado em todas as contas
-- que foram atualizadas pelo script mas não têm data_corte_saldo definida
-- ============================================

-- Verificar contas que precisam correção
SELECT 
  '=== CONTAS QUE PRECISAM CORREÇÃO ===' as info;

SELECT 
  descricao,
  saldo_atual,
  saldo_inicial,
  data_corte_saldo,
  CASE 
    WHEN data_corte_saldo IS NULL THEN 'PRECISA CORREÇÃO'
    ELSE 'JÁ CORRIGIDA'
  END as status
FROM contas_bancarias
WHERE descricao IN (
  'SBC', 'SBAS', 'SBAR', 'SBG', 'SB-S0I1', 'SBTI', 'SBVT', 'SBQ', 'SBP', 
  'SB-S0I2', 'SBECOMX', 'SBCX$', 'SBG-APLIC', 'SBOI2-APLIC'
)
ORDER BY descricao;

-- ============================================
-- CORRIGIR CONTAS
-- ============================================

-- 1. SBG-APLIC
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBG-APLIC' LIMIT 1)::UUID,
  716566.77,
  '2025-12-19'::DATE
) as sbg_aplic;

-- 2. SBVT
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBVT' LIMIT 1)::UUID,
  4500.00,
  '2025-12-19'::DATE
) as sbvt;

-- 3. SBAR
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBAR' LIMIT 1)::UUID,
  52.46,
  '2025-12-19'::DATE
) as sbar;

-- 4. SBG
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBG' LIMIT 1)::UUID,
  3027.79,
  '2025-12-19'::DATE
) as sbg;

-- 5. SBAS
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBAS' LIMIT 1)::UUID,
  3568.90,
  '2025-12-19'::DATE
) as sbas;

-- 6. SBTI
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBTI' LIMIT 1)::UUID,
  422.43,
  '2025-12-19'::DATE
) as sbti;

-- 7. SBP
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBP' LIMIT 1)::UUID,
  57.00,
  '2025-12-19'::DATE
) as sbp;

-- 8. SBC
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBC' LIMIT 1)::UUID,
  3726.97,
  '2025-12-19'::DATE
) as sbc;

-- 9. SBQ
SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao = 'SBQ' LIMIT 1)::UUID,
  1441.82,
  '2025-12-19'::DATE
) as sbq;

-- ============================================
-- VERIFICAR RESULTADO
-- ============================================

SELECT 
  '=== RESULTADO APÓS CORREÇÃO ===' as info;

SELECT 
  descricao,
  saldo_atual,
  saldo_base_ajustado,
  data_corte_saldo,
  COUNT(lc.id) FILTER (WHERE lc.data >= cb.data_corte_saldo) as lancamentos_apos_corte,
  COALESCE(SUM(CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END) FILTER (WHERE lc.data >= cb.data_corte_saldo), 0) as total_lancamentos_apos_corte,
  (cb.saldo_base_ajustado + COALESCE(SUM(CASE WHEN lc.tipo = 'entrada' THEN lc.valor ELSE -lc.valor END) FILTER (WHERE lc.data >= cb.data_corte_saldo), 0)) as saldo_esperado
FROM contas_bancarias cb
LEFT JOIN lancamentos_caixa lc ON lc.conta_bancaria_id = cb.id
WHERE cb.descricao IN (
  'SBC', 'SBAS', 'SBAR', 'SBG', 'SB-S0I1', 'SBTI', 'SBVT', 'SBQ', 'SBP', 
  'SB-S0I2', 'SBECOMX', 'SBCX$', 'SBG-APLIC', 'SBOI2-APLIC'
)
GROUP BY cb.id, cb.descricao, cb.saldo_atual, cb.saldo_base_ajustado, cb.data_corte_saldo
ORDER BY cb.descricao;

