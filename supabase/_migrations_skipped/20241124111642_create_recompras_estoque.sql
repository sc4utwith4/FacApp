-- ============================================
-- CRIAR TABELA recompras_estoque
-- Tabela para registrar recompras de operações de estoque
-- Sistema completo com duas etapas: criação (saída) e pagamento (entrada)
-- ============================================

-- Criar tabela recompras_estoque
CREATE TABLE IF NOT EXISTS public.recompras_estoque (
  id SERIAL PRIMARY KEY,
  operacao_estoque_id INTEGER NOT NULL REFERENCES public.operacoes_estoque(id) ON DELETE CASCADE,
  data_recompra DATE NOT NULL,
  valor_recompra NUMERIC(15,2) NOT NULL CHECK (valor_recompra > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'paga')),
  origem_tipo VARCHAR(20) NOT NULL CHECK (origem_tipo IN ('estoque', 'conta')),
  origem_id VARCHAR(255) NOT NULL, -- INTEGER para estoque, UUID para conta
  destino_tipo VARCHAR(20) CHECK (destino_tipo IN ('estoque', 'conta')),
  destino_id VARCHAR(255), -- INTEGER para estoque, UUID para conta
  lancamento_saida_id UUID REFERENCES public.lancamentos_caixa(id) ON DELETE SET NULL,
  lancamento_entrada_id UUID REFERENCES public.lancamentos_caixa(id) ON DELETE SET NULL,
  historico TEXT,
  observacoes TEXT,
  data_pagamento DATE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE
);

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_recompras_operacao ON public.recompras_estoque(operacao_estoque_id);
CREATE INDEX IF NOT EXISTS idx_recompras_status ON public.recompras_estoque(status);
CREATE INDEX IF NOT EXISTS idx_recompras_data ON public.recompras_estoque(data_recompra);
CREATE INDEX IF NOT EXISTS idx_recompras_empresa ON public.recompras_estoque(empresa_id);
CREATE INDEX IF NOT EXISTS idx_recompras_lancamento_saida ON public.recompras_estoque(lancamento_saida_id);
CREATE INDEX IF NOT EXISTS idx_recompras_lancamento_entrada ON public.recompras_estoque(lancamento_entrada_id);

-- Criar trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_recompras_estoque_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_recompras_estoque_updated_at
  BEFORE UPDATE ON public.recompras_estoque
  FOR EACH ROW
  EXECUTE FUNCTION public.update_recompras_estoque_updated_at();

-- Habilitar RLS
ALTER TABLE public.recompras_estoque ENABLE ROW LEVEL SECURITY;

-- Política RLS: SELECT - usuários da mesma empresa
CREATE POLICY "Usuários podem ver recompras da própria empresa"
  ON public.recompras_estoque
  FOR SELECT
  USING (
    empresa_id IN (
      SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Política RLS: INSERT - usuários autenticados da mesma empresa
CREATE POLICY "Usuários podem criar recompras na própria empresa"
  ON public.recompras_estoque
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    empresa_id IN (
      SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
    ) AND
    created_by = auth.uid()
  );

-- Política RLS: UPDATE - usuários autenticados da mesma empresa
CREATE POLICY "Usuários podem atualizar recompras da própria empresa"
  ON public.recompras_estoque
  FOR UPDATE
  USING (
    empresa_id IN (
      SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    empresa_id IN (
      SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Política RLS: DELETE - usuários autenticados da mesma empresa
CREATE POLICY "Usuários podem deletar recompras da própria empresa"
  ON public.recompras_estoque
  FOR DELETE
  USING (
    empresa_id IN (
      SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Função para validar que apenas recompras pendentes podem ser deletadas
CREATE OR REPLACE FUNCTION public.validate_delete_recompra()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'paga' THEN
    RAISE EXCEPTION 'Não é possível deletar uma recompra que já foi paga';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar trigger para validar deleção
CREATE TRIGGER trigger_validate_delete_recompra
  BEFORE DELETE ON public.recompras_estoque
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_delete_recompra();

-- Comentários
COMMENT ON TABLE public.recompras_estoque IS 'Registra recompras de operações de estoque com controle de status (pendente/paga)';
COMMENT ON COLUMN public.recompras_estoque.operacao_estoque_id IS 'ID da operação de estoque relacionada (sempre vinculada)';
COMMENT ON COLUMN public.recompras_estoque.valor_recompra IS 'Valor da recompra';
COMMENT ON COLUMN public.recompras_estoque.status IS 'Status da recompra: pendente (criada mas não paga) ou paga (pagamento registrado)';
COMMENT ON COLUMN public.recompras_estoque.origem_tipo IS 'Tipo de origem: estoque ou conta bancária';
COMMENT ON COLUMN public.recompras_estoque.origem_id IS 'ID da origem (estoque_id se origem_tipo=estoque, conta_bancaria_id se origem_tipo=conta)';
COMMENT ON COLUMN public.recompras_estoque.destino_tipo IS 'Tipo de destino: estoque ou conta bancária (preenchido no pagamento)';
COMMENT ON COLUMN public.recompras_estoque.destino_id IS 'ID do destino (preenchido no pagamento)';
COMMENT ON COLUMN public.recompras_estoque.lancamento_saida_id IS 'ID do lançamento de caixa criado na criação da recompra (saída)';
COMMENT ON COLUMN public.recompras_estoque.lancamento_entrada_id IS 'ID do lançamento de caixa criado no pagamento da recompra (entrada)';
COMMENT ON COLUMN public.recompras_estoque.data_pagamento IS 'Data em que a recompra foi paga (preenchido quando status=paga)';

