-- ============================================
-- SCRIPT PARA ATUALIZAR SALDO MANUALMENTE
-- Usa a função atualizar_saldo_manual() para definir
-- data_corte_saldo e saldo_base_ajustado
-- ============================================

-- Exemplo de uso:
-- SELECT atualizar_saldo_manual(
--   'uuid-da-conta'::UUID,
--   261540.54,  -- Novo saldo
--   '2025-12-19'::DATE  -- Data de corte (opcional, padrão: hoje)
-- );

-- Atualizar saldo da conta SB-S0I2
-- Saldo anterior: R$ 274.407,37
-- Líquido operação #61628: R$ 12.866,83 (saída)
-- Saldo esperado: 261.540,54
-- Data de corte: 19/12/2025 (data da operação #61628)

SELECT atualizar_saldo_manual(
  (SELECT id FROM contas_bancarias WHERE descricao ILIKE '%SB-S0I2%' LIMIT 1)::UUID,
  261540.54,
  '2025-12-19'::DATE
) as resultado;

-- Verificar resultado
SELECT 
  id,
  descricao,
  saldo_atual,
  saldo_inicial,
  saldo_base_ajustado,
  data_corte_saldo,
  updated_at
FROM contas_bancarias
WHERE descricao ILIKE '%SB-S0I2%';

