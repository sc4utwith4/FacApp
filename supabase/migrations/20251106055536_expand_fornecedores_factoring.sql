-- ============================================
-- MIGRATION: Expandir Fornecedores para Factoring
-- ============================================
-- Adiciona campos necessários para factoring na tabela fornecedores
-- Condições comerciais, limites, situação, indicadores

-- ============================================
-- 1. EXPANDIR TABELA: fornecedores
-- ============================================

-- Condições comerciais
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS limite_credito NUMERIC(15,2) DEFAULT 0 CHECK (limite_credito >= 0),
  ADD COLUMN IF NOT EXISTS limite_utilizado NUMERIC(15,2) DEFAULT 0 CHECK (limite_utilizado >= 0),
  ADD COLUMN IF NOT EXISTS taxa_antecipacao NUMERIC(5,2) DEFAULT 0 CHECK (taxa_antecipacao >= 0 AND taxa_antecipacao <= 100),
  ADD COLUMN IF NOT EXISTS prazo_medio_dias INTEGER DEFAULT 30 CHECK (prazo_medio_dias >= 0);

-- Situação atual
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS situacao VARCHAR(20) DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'em_analise', 'bloqueado', 'inadimplente')),
  ADD COLUMN IF NOT EXISTS data_avaliacao DATE,
  ADD COLUMN IF NOT EXISTS score_credito INTEGER CHECK (score_credito >= 0 AND score_credito <= 1000);

-- Indicadores
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS saldo_a_liberar NUMERIC(15,2) DEFAULT 0 CHECK (saldo_a_liberar >= 0),
  ADD COLUMN IF NOT EXISTS titulos_em_atraso INTEGER DEFAULT 0 CHECK (titulos_em_atraso >= 0),
  ADD COLUMN IF NOT EXISTS valor_titulos_atraso NUMERIC(15,2) DEFAULT 0 CHECK (valor_titulos_atraso >= 0);

-- Auditoria
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS avaliado_por UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS data_ultima_operacao DATE,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Índices adicionais
CREATE INDEX IF NOT EXISTS idx_fornecedores_situacao ON public.fornecedores(situacao);
CREATE INDEX IF NOT EXISTS idx_fornecedores_data_avaliacao ON public.fornecedores(data_avaliacao) WHERE data_avaliacao IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fornecedores_score_credito ON public.fornecedores(score_credito) WHERE score_credito IS NOT NULL;

-- Comentários
COMMENT ON COLUMN public.fornecedores.limite_credito IS 'Limite de crédito disponível para o fornecedor';
COMMENT ON COLUMN public.fornecedores.limite_utilizado IS 'Limite de crédito já utilizado';
COMMENT ON COLUMN public.fornecedores.taxa_antecipacao IS 'Taxa de antecipação aplicada (percentual)';
COMMENT ON COLUMN public.fornecedores.prazo_medio_dias IS 'Prazo médio de pagamento em dias';
COMMENT ON COLUMN public.fornecedores.situacao IS 'Situação atual: ativo, em_analise, bloqueado, inadimplente';
COMMENT ON COLUMN public.fornecedores.score_credito IS 'Score de crédito (0-1000)';
COMMENT ON COLUMN public.fornecedores.saldo_a_liberar IS 'Saldo a liberar (duplicatas pendentes)';
COMMENT ON COLUMN public.fornecedores.titulos_em_atraso IS 'Quantidade de títulos em atraso';
COMMENT ON COLUMN public.fornecedores.valor_titulos_atraso IS 'Valor total de títulos em atraso';
;
