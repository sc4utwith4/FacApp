-- ============================================
-- MIGRATION: Criar Tabelas de Estoque (UUID)
-- ============================================
-- Cria as tabelas estoques, operacoes_estoque e movimentacoes_estoque
-- com RLS, triggers, índices e foreign keys apropriadas
-- Usa UUIDs para foreign keys (empresa_id, fornecedor_id, conta_bancaria_id)

-- ============================================
-- 1. TABELA: estoques
-- ============================================
CREATE TABLE IF NOT EXISTS public.estoques (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('SPPRO', 'SOI')),
  descricao VARCHAR(200),
  saldo_atual NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (saldo_atual >= 0),
  fornecedor_id UUID REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Índices para estoques
CREATE INDEX IF NOT EXISTS idx_estoques_empresa ON public.estoques(empresa_id);
CREATE INDEX IF NOT EXISTS idx_estoques_tipo ON public.estoques(tipo);
CREATE INDEX IF NOT EXISTS idx_estoques_ativo ON public.estoques(ativo) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_estoques_fornecedor ON public.estoques(fornecedor_id) WHERE fornecedor_id IS NOT NULL;

-- ============================================
-- 2. TABELA: operacoes_estoque
-- ============================================
CREATE TABLE IF NOT EXISTS public.operacoes_estoque (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  estoque_id BIGINT NOT NULL REFERENCES public.estoques(id) ON DELETE CASCADE,
  tipo_operacao VARCHAR(10) NOT NULL CHECK (tipo_operacao IN ('entrada', 'saida')),
  data DATE NOT NULL,
  fornecedor_id UUID REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  conta_bancaria_id UUID REFERENCES public.contas_bancarias(id) ON DELETE SET NULL,
  
  -- Campos comuns
  face_titulos NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (face_titulos >= 0),
  valor_compra NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (valor_compra >= 0),
  despesas NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (despesas >= 0),
  recompra NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (recompra >= 0),
  liquido_operacao NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (liquido_operacao >= 0),
  
  -- Campos específicos SPPRO (NULL para SOI)
  ad_valorem NUMERIC(15,2) CHECK (ad_valorem >= 0),
  iss NUMERIC(15,2) CHECK (iss >= 0),
  iof NUMERIC(15,2) CHECK (iof >= 0),
  
  -- Campos específicos SOI (NULL para SPPRO)
  amortizacao_debitos NUMERIC(15,2) CHECK (amortizacao_debitos >= 0),
  amortizacao_creditos NUMERIC(15,2) CHECK (amortizacao_creditos >= 0),
  
  -- Campos de controle
  historico TEXT,
  documento VARCHAR(60),
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Índices para operacoes_estoque
CREATE INDEX IF NOT EXISTS idx_operacoes_estoque_empresa ON public.operacoes_estoque(empresa_id);
CREATE INDEX IF NOT EXISTS idx_operacoes_estoque_estoque ON public.operacoes_estoque(estoque_id);
CREATE INDEX IF NOT EXISTS idx_operacoes_estoque_data ON public.operacoes_estoque(data DESC);
CREATE INDEX IF NOT EXISTS idx_operacoes_estoque_tipo_operacao ON public.operacoes_estoque(tipo_operacao);
CREATE INDEX IF NOT EXISTS idx_operacoes_estoque_fornecedor ON public.operacoes_estoque(fornecedor_id) WHERE fornecedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operacoes_estoque_conta ON public.operacoes_estoque(conta_bancaria_id) WHERE conta_bancaria_id IS NOT NULL;

-- ============================================
-- 3. TABELA: movimentacoes_estoque
-- ============================================
CREATE TABLE IF NOT EXISTS public.movimentacoes_estoque (
  id BIGSERIAL PRIMARY KEY,
  operacao_estoque_id BIGINT NOT NULL REFERENCES public.operacoes_estoque(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('acrescimos', 'receita_juros', 'entre_contas', 'lancar_receitas', 'devolucao_cheque')),
  valor NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
  conta_bancaria_id UUID REFERENCES public.contas_bancarias(id) ON DELETE SET NULL,
  estoque_origem_id BIGINT REFERENCES public.estoques(id) ON DELETE SET NULL,
  estoque_destino_id BIGINT REFERENCES public.estoques(id) ON DELETE SET NULL,
  historico TEXT,
  data DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para movimentacoes_estoque
CREATE INDEX IF NOT EXISTS idx_movimentacoes_operacao ON public.movimentacoes_estoque(operacao_estoque_id);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_data ON public.movimentacoes_estoque(data DESC);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_tipo ON public.movimentacoes_estoque(tipo);

-- ============================================
-- 4. TRIGGERS: updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_estoques_updated_at
  BEFORE UPDATE ON public.estoques
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_operacoes_estoque_updated_at
  BEFORE UPDATE ON public.operacoes_estoque
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_movimentacoes_estoque_updated_at
  BEFORE UPDATE ON public.movimentacoes_estoque
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 5. RLS POLICIES
-- ============================================

-- Habilitar RLS
ALTER TABLE public.estoques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operacoes_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes_estoque ENABLE ROW LEVEL SECURITY;

-- Função auxiliar para obter empresa_id do usuário (retorna UUID)
CREATE OR REPLACE FUNCTION get_user_empresa_id()
RETURNS UUID AS $$
DECLARE
  empresa_id_val UUID;
BEGIN
  SELECT empresa_id INTO empresa_id_val
  FROM public.profiles
  WHERE id = auth.uid();
  
  RETURN empresa_id_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Políticas RLS para estoques
CREATE POLICY "Users can manage own empresa estoques" ON public.estoques
  FOR ALL
  USING (empresa_id = get_user_empresa_id());

-- Políticas RLS para operacoes_estoque
CREATE POLICY "Users can manage own empresa operacoes estoque" ON public.operacoes_estoque
  FOR ALL
  USING (empresa_id = get_user_empresa_id());

-- Políticas RLS para movimentacoes_estoque
-- Acesso baseado na operação de estoque associada
CREATE POLICY "Users can manage own empresa movimentacoes estoque" ON public.movimentacoes_estoque
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.operacoes_estoque
      WHERE operacoes_estoque.id = movimentacoes_estoque.operacao_estoque_id
      AND operacoes_estoque.empresa_id = get_user_empresa_id()
    )
  );

-- ============================================
-- 6. COMMENTS
-- ============================================
COMMENT ON TABLE public.estoques IS 'Tabela de estoques financeiros (SPPRO e SOI)';
COMMENT ON TABLE public.operacoes_estoque IS 'Tabela de operações de entrada/saída de estoque';
COMMENT ON TABLE public.movimentacoes_estoque IS 'Tabela de movimentações relacionadas a operações de estoque';

COMMENT ON COLUMN public.estoques.tipo IS 'Tipo de estoque: SPPRO ou SOI';
COMMENT ON COLUMN public.operacoes_estoque.tipo_operacao IS 'Tipo de operação: entrada ou saida';
COMMENT ON COLUMN public.operacoes_estoque.ad_valorem IS 'Valor Ad-Valorem (apenas SPPRO)';
COMMENT ON COLUMN public.operacoes_estoque.amortizacao_debitos IS 'Amortização de débitos (apenas SOI)';;
