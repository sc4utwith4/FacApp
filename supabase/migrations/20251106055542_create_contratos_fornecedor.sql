-- ============================================
-- MIGRATION: Criar Tabela de Contratos de Fornecedor
-- ============================================
-- Tabela para gerenciar contratos firmados com fornecedores

CREATE TABLE IF NOT EXISTS public.contratos_fornecedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  fornecedor_id UUID NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  numero_contrato VARCHAR(50) NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE,
  valor_limite NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (valor_limite >= 0),
  taxa_antecipacao NUMERIC(5,2) DEFAULT 0 CHECK (taxa_antecipacao >= 0 AND taxa_antecipacao <= 100),
  prazo_medio_dias INTEGER DEFAULT 30 CHECK (prazo_medio_dias >= 0),
  status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'encerrado', 'cancelado')),
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(empresa_id, numero_contrato)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_contratos_fornecedor_empresa ON public.contratos_fornecedor(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contratos_fornecedor_fornecedor ON public.contratos_fornecedor(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_contratos_fornecedor_status ON public.contratos_fornecedor(status) WHERE status = 'ativo';
CREATE INDEX IF NOT EXISTS idx_contratos_fornecedor_data_inicio ON public.contratos_fornecedor(data_inicio DESC);

-- Triggers
CREATE TRIGGER update_contratos_fornecedor_updated_at
  BEFORE UPDATE ON public.contratos_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.contratos_fornecedor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own empresa contratos fornecedor" ON public.contratos_fornecedor
  FOR ALL USING (empresa_id = get_user_empresa_id());

-- Comentários
COMMENT ON TABLE public.contratos_fornecedor IS 'Tabela de contratos firmados com fornecedores para factoring';
COMMENT ON COLUMN public.contratos_fornecedor.numero_contrato IS 'Número único do contrato';
COMMENT ON COLUMN public.contratos_fornecedor.valor_limite IS 'Valor limite do contrato';
COMMENT ON COLUMN public.contratos_fornecedor.taxa_antecipacao IS 'Taxa de antecipação aplicada (percentual)';
COMMENT ON COLUMN public.contratos_fornecedor.prazo_medio_dias IS 'Prazo médio de pagamento em dias';
;
