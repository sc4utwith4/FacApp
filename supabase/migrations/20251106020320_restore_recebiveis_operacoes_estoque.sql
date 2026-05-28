-- ============================================
-- MIGRATION: Criar Tabela de Recebíveis de Operações de Estoque
-- ============================================
-- Cria a tabela recebiveis_operacoes_estoque para armazenar
-- lançamentos em Contas a Receber gerados automaticamente
-- a partir de operações de estoque (SPPRO e SOI)

-- ============================================
-- 1. CRIAR ENUM PARA STATUS
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_recebivel') THEN
        CREATE TYPE status_recebivel AS ENUM ('previsto', 'pago', 'cancelado');
    END IF;
END
$$;

-- ============================================
-- 2. TABELA: recebiveis_operacoes_estoque
-- ============================================
CREATE TABLE IF NOT EXISTS public.recebiveis_operacoes_estoque (
  id BIGSERIAL PRIMARY KEY,
  operacao_estoque_id BIGINT NOT NULL REFERENCES public.operacoes_estoque(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
  data_vencimento DATE NOT NULL,
  descricao TEXT,
  status status_recebivel NOT NULL DEFAULT 'previsto',
  tipo_estoque VARCHAR(10) NOT NULL CHECK (tipo_estoque IN ('SPPRO', 'SOI')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_recebiveis_operacao ON public.recebiveis_operacoes_estoque(operacao_estoque_id);
CREATE INDEX IF NOT EXISTS idx_recebiveis_empresa ON public.recebiveis_operacoes_estoque(empresa_id);
CREATE INDEX IF NOT EXISTS idx_recebiveis_vencimento ON public.recebiveis_operacoes_estoque(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_recebiveis_status ON public.recebiveis_operacoes_estoque(status);
CREATE INDEX IF NOT EXISTS idx_recebiveis_tipo_estoque ON public.recebiveis_operacoes_estoque(tipo_estoque);

-- ============================================
-- 3. TRIGGER: updated_at
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_recebiveis_operacoes_estoque_updated_at'
    ) THEN
        CREATE TRIGGER update_recebiveis_operacoes_estoque_updated_at
        BEFORE UPDATE ON public.recebiveis_operacoes_estoque
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END
$$;

-- ============================================
-- 4. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.recebiveis_operacoes_estoque ENABLE ROW LEVEL SECURITY;

-- Política SELECT: Usuários podem ver recebíveis da sua empresa
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'recebiveis_operacoes_estoque' 
        AND policyname = 'recebiveis_select_policy'
    ) THEN
        CREATE POLICY recebiveis_select_policy ON public.recebiveis_operacoes_estoque
        FOR SELECT
        USING (empresa_id = get_user_empresa_id());
    END IF;
END
$$;

-- Política INSERT: Usuários podem criar recebíveis para sua empresa
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'recebiveis_operacoes_estoque' 
        AND policyname = 'recebiveis_insert_policy'
    ) THEN
        CREATE POLICY recebiveis_insert_policy ON public.recebiveis_operacoes_estoque
        FOR INSERT
        WITH CHECK (empresa_id = get_user_empresa_id());
    END IF;
END
$$;

-- Política UPDATE: Usuários podem atualizar recebíveis da sua empresa
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'recebiveis_operacoes_estoque' 
        AND policyname = 'recebiveis_update_policy'
    ) THEN
        CREATE POLICY recebiveis_update_policy ON public.recebiveis_operacoes_estoque
        FOR UPDATE
        USING (empresa_id = get_user_empresa_id())
        WITH CHECK (empresa_id = get_user_empresa_id());
    END IF;
END
$$;

-- Política DELETE: Usuários podem deletar recebíveis da sua empresa
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'recebiveis_operacoes_estoque' 
        AND policyname = 'recebiveis_delete_policy'
    ) THEN
        CREATE POLICY recebiveis_delete_policy ON public.recebiveis_operacoes_estoque
        FOR DELETE
        USING (empresa_id = get_user_empresa_id());
    END IF;
END
$$;

-- ============================================
-- 5. COMENTÁRIOS
-- ============================================
COMMENT ON TABLE public.recebiveis_operacoes_estoque IS 'Recebíveis gerados automaticamente a partir de operações de estoque';
COMMENT ON COLUMN public.recebiveis_operacoes_estoque.operacao_estoque_id IS 'Referência à operação de estoque que gerou este recebível';
COMMENT ON COLUMN public.recebiveis_operacoes_estoque.valor IS 'Soma dos valores da operação (compra + impostos + despesas)';
COMMENT ON COLUMN public.recebiveis_operacoes_estoque.data_vencimento IS 'Data de vencimento do recebível';
COMMENT ON COLUMN public.recebiveis_operacoes_estoque.descricao IS 'Histórico formatado com informações da operação';
COMMENT ON COLUMN public.recebiveis_operacoes_estoque.status IS 'Status do recebível: previsto, pago ou cancelado';
COMMENT ON COLUMN public.recebiveis_operacoes_estoque.tipo_estoque IS 'Tipo de estoque: SPPRO ou SOI';

