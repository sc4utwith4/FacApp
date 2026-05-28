-- ============================================
-- CRIAR TABELA devolucoes_estoque
-- Tabela para registrar devoluções de operações de estoque
-- ============================================

-- Criar tabela devolucoes_estoque
CREATE TABLE IF NOT EXISTS public.devolucoes_estoque (
  id SERIAL PRIMARY KEY,
  operacao_estoque_id INTEGER NOT NULL REFERENCES public.operacoes_estoque(id) ON DELETE CASCADE,
  data_devolucao DATE NOT NULL,
  valor_devolucao NUMERIC(15,2) NOT NULL CHECK (valor_devolucao > 0),
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE RESTRICT,
  lancamento_caixa_id UUID REFERENCES public.lancamentos_caixa(id) ON DELETE SET NULL,
  historico TEXT,
  observacoes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE
);

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_devolucoes_operacao ON public.devolucoes_estoque(operacao_estoque_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_lancamento ON public.devolucoes_estoque(lancamento_caixa_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_data ON public.devolucoes_estoque(data_devolucao);
CREATE INDEX IF NOT EXISTS idx_devolucoes_empresa ON public.devolucoes_estoque(empresa_id);

-- Criar trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_devolucoes_estoque_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_devolucoes_estoque_updated_at
  BEFORE UPDATE ON public.devolucoes_estoque
  FOR EACH ROW
  EXECUTE FUNCTION public.update_devolucoes_estoque_updated_at();

-- Habilitar RLS
ALTER TABLE public.devolucoes_estoque ENABLE ROW LEVEL SECURITY;

-- Política RLS: SELECT - usuários da mesma empresa
CREATE POLICY "Usuários podem ver devoluções da própria empresa"
  ON public.devolucoes_estoque
  FOR SELECT
  USING (
    empresa_id IN (
      SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Política RLS: INSERT - usuários autenticados da mesma empresa
CREATE POLICY "Usuários podem criar devoluções na própria empresa"
  ON public.devolucoes_estoque
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    empresa_id IN (
      SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
    ) AND
    created_by = auth.uid()
  );

-- Política RLS: UPDATE - usuários autenticados da mesma empresa
CREATE POLICY "Usuários podem atualizar devoluções da própria empresa"
  ON public.devolucoes_estoque
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
CREATE POLICY "Usuários podem deletar devoluções da própria empresa"
  ON public.devolucoes_estoque
  FOR DELETE
  USING (
    empresa_id IN (
      SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Função para validar que o total de devoluções não excede a Face dos Títulos
CREATE OR REPLACE FUNCTION public.validate_devolucao_valor()
RETURNS TRIGGER AS $$
DECLARE
  total_devolvido NUMERIC(15,2);
  face_titulos NUMERIC(15,2);
BEGIN
  -- Calcular total já devolvido (excluindo a devolução atual se for update)
  SELECT COALESCE(SUM(valor_devolucao), 0) INTO total_devolvido
  FROM public.devolucoes_estoque
  WHERE operacao_estoque_id = NEW.operacao_estoque_id
    AND id != COALESCE(NEW.id, 0);

  -- Buscar Face dos Títulos da operação
  SELECT face_titulos INTO face_titulos
  FROM public.operacoes_estoque
  WHERE id = NEW.operacao_estoque_id;

  -- Validar que o total não excede a Face dos Títulos
  IF (total_devolvido + NEW.valor_devolucao) > face_titulos THEN
    RAISE EXCEPTION 'Total de devoluções (R$ %) excede a Face dos Títulos (R$ %)', 
      (total_devolvido + NEW.valor_devolucao), face_titulos;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar trigger para validar valor
CREATE TRIGGER trigger_validate_devolucao_valor
  BEFORE INSERT OR UPDATE ON public.devolucoes_estoque
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_devolucao_valor();

-- Comentários
COMMENT ON TABLE public.devolucoes_estoque IS 'Registra devoluções de valores de operações de estoque para a conta SB-S0I2';
COMMENT ON COLUMN public.devolucoes_estoque.operacao_estoque_id IS 'ID da operação de estoque relacionada';
COMMENT ON COLUMN public.devolucoes_estoque.valor_devolucao IS 'Valor da devolução (pode ser parcial)';
COMMENT ON COLUMN public.devolucoes_estoque.conta_bancaria_id IS 'ID da conta bancária (sempre SB-S0I2)';
COMMENT ON COLUMN public.devolucoes_estoque.lancamento_caixa_id IS 'ID do lançamento de caixa criado automaticamente';

