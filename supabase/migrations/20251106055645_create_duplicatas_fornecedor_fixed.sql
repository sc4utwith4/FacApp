-- ============================================
-- MIGRATION: Criar Tabela de Duplicatas de Fornecedor
-- ============================================
-- Tabela para gerenciar duplicatas (títulos) cedidas pelos fornecedores

CREATE TABLE IF NOT EXISTS public.duplicatas_fornecedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  fornecedor_id UUID NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  contrato_id UUID REFERENCES public.contratos_fornecedor(id) ON DELETE SET NULL,
  numero_duplicata VARCHAR(50) NOT NULL,
  numero_nota_fiscal VARCHAR(50),
  data_emissao DATE NOT NULL,
  data_vencimento DATE NOT NULL,
  valor_face NUMERIC(15,2) NOT NULL CHECK (valor_face >= 0),
  valor_antecipado NUMERIC(15,2) DEFAULT 0 CHECK (valor_antecipado >= 0),
  taxa_aplicada NUMERIC(5,2) DEFAULT 0 CHECK (taxa_aplicada >= 0),
  valor_liquido NUMERIC(15,2) DEFAULT 0 CHECK (valor_liquido >= 0),
  status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'antecipada', 'paga', 'vencida', 'cancelada')),
  data_pagamento DATE,
  data_antecipacao DATE,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(empresa_id, numero_duplicata)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_duplicatas_fornecedor_empresa ON public.duplicatas_fornecedor(empresa_id);
CREATE INDEX IF NOT EXISTS idx_duplicatas_fornecedor_fornecedor ON public.duplicatas_fornecedor(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_duplicatas_fornecedor_contrato ON public.duplicatas_fornecedor(contrato_id) WHERE contrato_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_duplicatas_fornecedor_status ON public.duplicatas_fornecedor(status);
CREATE INDEX IF NOT EXISTS idx_duplicatas_fornecedor_vencimento ON public.duplicatas_fornecedor(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_duplicatas_fornecedor_status_vencimento ON public.duplicatas_fornecedor(status, data_vencimento);

-- Triggers
CREATE TRIGGER update_duplicatas_fornecedor_updated_at
  BEFORE UPDATE ON public.duplicatas_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para atualizar status automaticamente (vencidas)
CREATE OR REPLACE FUNCTION atualizar_status_duplicatas_vencidas()
RETURNS TRIGGER AS $$
BEGIN
  -- Atualizar status para 'vencida' se a data de vencimento passou
  IF NEW.data_vencimento < CURRENT_DATE AND NEW.status NOT IN ('paga', 'cancelada') THEN
    NEW.status := 'vencida';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_atualizar_status_duplicatas_vencidas
  BEFORE INSERT OR UPDATE ON public.duplicatas_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION atualizar_status_duplicatas_vencidas();

-- RLS
ALTER TABLE public.duplicatas_fornecedor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own empresa duplicatas fornecedor" ON public.duplicatas_fornecedor
  FOR ALL USING (empresa_id = get_user_empresa_id());

-- Comentários
COMMENT ON TABLE public.duplicatas_fornecedor IS 'Tabela de duplicatas (títulos) cedidas pelos fornecedores';
COMMENT ON COLUMN public.duplicatas_fornecedor.numero_duplicata IS 'Número único da duplicata';
COMMENT ON COLUMN public.duplicatas_fornecedor.valor_face IS 'Valor de face da duplicata';
COMMENT ON COLUMN public.duplicatas_fornecedor.valor_antecipado IS 'Valor antecipado (se houver)';
COMMENT ON COLUMN public.duplicatas_fornecedor.valor_liquido IS 'Valor líquido após descontos/tarifas';
;
