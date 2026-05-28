-- ============================================
-- MIGRATION: Criar Tabela de Tarifas de Fornecedor
-- ============================================
-- Tabela para registrar tarifas aplicadas em operações de factoring

CREATE TABLE IF NOT EXISTS public.tarifas_fornecedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  fornecedor_id UUID NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  duplicata_id UUID REFERENCES public.duplicatas_fornecedor(id) ON DELETE SET NULL,
  tipo_tarifa VARCHAR(50) NOT NULL CHECK (tipo_tarifa IN ('antecipacao', 'iof', 'iss', 'ad_valorem', 'taxa_administrativa', 'outras')),
  descricao VARCHAR(200),
  valor NUMERIC(15,2) NOT NULL CHECK (valor >= 0),
  percentual NUMERIC(5,2) CHECK (percentual >= 0 AND percentual <= 100),
  data_aplicacao DATE NOT NULL,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_tarifas_fornecedor_empresa ON public.tarifas_fornecedor(empresa_id);
CREATE INDEX IF NOT EXISTS idx_tarifas_fornecedor_fornecedor ON public.tarifas_fornecedor(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_tarifas_fornecedor_duplicata ON public.tarifas_fornecedor(duplicata_id) WHERE duplicata_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarifas_fornecedor_tipo ON public.tarifas_fornecedor(tipo_tarifa);
CREATE INDEX IF NOT EXISTS idx_tarifas_fornecedor_data ON public.tarifas_fornecedor(data_aplicacao DESC);

-- Triggers
CREATE TRIGGER update_tarifas_fornecedor_updated_at
  BEFORE UPDATE ON public.tarifas_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.tarifas_fornecedor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own empresa tarifas fornecedor" ON public.tarifas_fornecedor
  FOR ALL USING (empresa_id = get_user_empresa_id());

-- Comentários
COMMENT ON TABLE public.tarifas_fornecedor IS 'Tabela de tarifas aplicadas em operações de factoring';
COMMENT ON COLUMN public.tarifas_fornecedor.tipo_tarifa IS 'Tipo: antecipacao, iof, iss, ad_valorem, taxa_administrativa, outras';
COMMENT ON COLUMN public.tarifas_fornecedor.valor IS 'Valor da tarifa em reais';
COMMENT ON COLUMN public.tarifas_fornecedor.percentual IS 'Percentual da tarifa (se aplicável)';

