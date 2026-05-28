-- ============================================
-- MIGRATION: Criar Tabela de Pagamentos de Fornecedor
-- ============================================
-- Tabela para registrar pagamentos realizados aos fornecedores

CREATE TABLE IF NOT EXISTS public.pagamentos_fornecedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  fornecedor_id UUID NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  duplicata_id UUID REFERENCES public.duplicatas_fornecedor(id) ON DELETE SET NULL,
  conta_bancaria_id UUID REFERENCES public.contas_bancarias(id) ON DELETE SET NULL,
  data_pagamento DATE NOT NULL,
  valor NUMERIC(15,2) NOT NULL CHECK (valor >= 0),
  tipo_pagamento VARCHAR(20) DEFAULT 'normal' CHECK (tipo_pagamento IN ('normal', 'antecipacao', 'parcial')),
  forma_pagamento VARCHAR(20) DEFAULT 'transferencia' CHECK (forma_pagamento IN ('transferencia', 'ted', 'doc', 'boleto', 'cheque', 'dinheiro')),
  numero_documento VARCHAR(50),
  historico TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_pagamentos_fornecedor_empresa ON public.pagamentos_fornecedor(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_fornecedor_fornecedor ON public.pagamentos_fornecedor(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_fornecedor_duplicata ON public.pagamentos_fornecedor(duplicata_id) WHERE duplicata_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pagamentos_fornecedor_data ON public.pagamentos_fornecedor(data_pagamento DESC);
CREATE INDEX IF NOT EXISTS idx_pagamentos_fornecedor_tipo ON public.pagamentos_fornecedor(tipo_pagamento);

-- Triggers
CREATE TRIGGER update_pagamentos_fornecedor_updated_at
  BEFORE UPDATE ON public.pagamentos_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para atualizar status da duplicata quando pagamento for registrado
CREATE OR REPLACE FUNCTION atualizar_status_duplicata_ao_pagar()
RETURNS TRIGGER AS $$
DECLARE
  v_duplicata RECORD;
  v_total_pago NUMERIC(15,2);
BEGIN
  -- Se há duplicata associada
  IF NEW.duplicata_id IS NOT NULL THEN
    -- Buscar duplicata
    SELECT * INTO v_duplicata
    FROM public.duplicatas_fornecedor
    WHERE id = NEW.duplicata_id;

    -- Calcular total pago
    SELECT COALESCE(SUM(valor), 0) INTO v_total_pago
    FROM public.pagamentos_fornecedor
    WHERE duplicata_id = NEW.duplicata_id;

    -- Atualizar status da duplicata
    IF v_total_pago >= v_duplicata.valor_face THEN
      UPDATE public.duplicatas_fornecedor
      SET status = 'paga', data_pagamento = NEW.data_pagamento
      WHERE id = NEW.duplicata_id;
    ELSIF v_total_pago > 0 THEN
      UPDATE public.duplicatas_fornecedor
      SET status = 'pendente' -- Manter pendente se parcial
      WHERE id = NEW.duplicata_id;
    END IF;

    -- Atualizar última operação do fornecedor
    UPDATE public.fornecedores
    SET data_ultima_operacao = NEW.data_pagamento
    WHERE id = NEW.fornecedor_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_atualizar_status_duplicata_ao_pagar
  AFTER INSERT OR UPDATE ON public.pagamentos_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION atualizar_status_duplicata_ao_pagar();

-- RLS
ALTER TABLE public.pagamentos_fornecedor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own empresa pagamentos fornecedor" ON public.pagamentos_fornecedor
  FOR ALL USING (empresa_id = get_user_empresa_id());

-- Comentários
COMMENT ON TABLE public.pagamentos_fornecedor IS 'Tabela de pagamentos realizados aos fornecedores';
COMMENT ON COLUMN public.pagamentos_fornecedor.tipo_pagamento IS 'Tipo: normal, antecipacao, parcial';
COMMENT ON COLUMN public.pagamentos_fornecedor.forma_pagamento IS 'Forma: transferencia, ted, doc, boleto, cheque, dinheiro';
;
