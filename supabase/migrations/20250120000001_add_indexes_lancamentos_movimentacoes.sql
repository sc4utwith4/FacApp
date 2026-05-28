-- ============================================
-- ADICIONAR ÍNDICES PARA PERFORMANCE DE QUERIES
-- ============================================
-- Índices para melhorar performance de consultas de lançamentos e movimentações
-- especialmente em queries filtradas por data e empresa_id

-- Índice composto para queries de lancamentos_caixa por empresa e data
-- Usado frequentemente em relatórios e consultas do IA Copilot
CREATE INDEX IF NOT EXISTS idx_lancamentos_caixa_empresa_data 
ON lancamentos_caixa (empresa_id, data);

-- Índice simples para queries filtradas apenas por data
-- Útil para consultas gerais que não filtram por empresa (com RLS ainda aplica empresa_id)
CREATE INDEX IF NOT EXISTS idx_lancamentos_caixa_data 
ON lancamentos_caixa (data);

-- Índice para queries de movimentacoes_estoque por data
-- Melhora performance em consultas de estoque filtradas por data
CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_data 
ON movimentacoes_estoque (data);

-- Comentários sobre os índices:
-- - idx_lancamentos_caixa_empresa_data: Otimiza queries que filtram por empresa_id E data (mais comum)
-- - idx_lancamentos_caixa_data: Otimiza queries que filtram apenas por data (RLS garante empresa_id)
-- - idx_movimentacoes_estoque_data: Otimiza queries de movimentações de estoque por data
