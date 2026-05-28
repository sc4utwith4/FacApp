-- ============================================================
-- DAILY RECONCILIATION VERIFIED FLOW
-- Modelo canonico de itens conciliaveis + fechamento diario
-- ============================================================

-- ------------------------------------------------------------
-- 0) Helpers de autorizacao
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_or_financeiro(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT lower(trim(coalesce(p.perfil, '')))
  INTO v_perfil
  FROM public.profiles p
  WHERE p.id = p_user_id;

  RETURN v_perfil IN ('admin', 'financeiro');
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin_or_financeiro(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_financeiro(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 1) Tabela canonica de itens financeiros conciliaveis
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conciliacao_itens_financeiros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  valor_centavos BIGINT NOT NULL CHECK (valor_centavos >= 0),

  origem_tipo TEXT NOT NULL CHECK (origem_tipo IN ('lancamento_caixa', 'movimentacao_estoque')),
  origem_id_uuid UUID,
  origem_id_bigint BIGINT,
  origem_key TEXT NOT NULL,

  descricao_exibicao TEXT,
  documento TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_conciliacao_itens_origem_id
  CHECK (
    (origem_tipo = 'lancamento_caixa' AND origem_id_uuid IS NOT NULL AND origem_id_bigint IS NULL)
    OR
    (origem_tipo = 'movimentacao_estoque' AND origem_id_uuid IS NULL AND origem_id_bigint IS NOT NULL)
  ),
  CONSTRAINT uq_conciliacao_itens_empresa_origem UNIQUE (empresa_id, origem_key)
);

CREATE INDEX IF NOT EXISTS idx_conciliacao_itens_empresa_conta_data
  ON public.conciliacao_itens_financeiros(empresa_id, conta_bancaria_id, data DESC);

CREATE INDEX IF NOT EXISTS idx_conciliacao_itens_empresa_tipo_data
  ON public.conciliacao_itens_financeiros(empresa_id, tipo, data DESC);

CREATE INDEX IF NOT EXISTS idx_conciliacao_itens_ativo
  ON public.conciliacao_itens_financeiros(empresa_id, ativo, updated_at DESC);

DROP TRIGGER IF EXISTS update_conciliacao_itens_financeiros_updated_at ON public.conciliacao_itens_financeiros;
CREATE TRIGGER update_conciliacao_itens_financeiros_updated_at
  BEFORE UPDATE ON public.conciliacao_itens_financeiros
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 2) Resolucao explicita de pendencia de extrato
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conciliacao_extrato_resolucoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  extrato_transacao_id UUID NOT NULL REFERENCES public.extrato_transacoes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ignored_justified')),
  justificativa TEXT NOT NULL,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_conciliacao_extrato_resolucoes UNIQUE (empresa_id, extrato_transacao_id)
);

CREATE INDEX IF NOT EXISTS idx_conciliacao_extrato_resolucoes_empresa_status
  ON public.conciliacao_extrato_resolucoes(empresa_id, status, resolved_at DESC);

DROP TRIGGER IF EXISTS update_conciliacao_extrato_resolucoes_updated_at ON public.conciliacao_extrato_resolucoes;
CREATE TRIGGER update_conciliacao_extrato_resolucoes_updated_at
  BEFORE UPDATE ON public.conciliacao_extrato_resolucoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3) Fechamento diario por conta
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conciliacao_fechamentos_diarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,
  data_referencia DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'reopened')),

  total_itens INTEGER NOT NULL DEFAULT 0,
  itens_verificados INTEGER NOT NULL DEFAULT 0,
  itens_parciais INTEGER NOT NULL DEFAULT 0,
  itens_nao_conciliados INTEGER NOT NULL DEFAULT 0,
  itens_divergentes INTEGER NOT NULL DEFAULT 0,
  total_extrato_transacoes INTEGER NOT NULL DEFAULT 0,
  extrato_pendencias_criticas INTEGER NOT NULL DEFAULT 0,

  observacoes TEXT,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_conciliacao_fechamentos UNIQUE (empresa_id, conta_bancaria_id, data_referencia)
);

CREATE INDEX IF NOT EXISTS idx_conciliacao_fechamentos_empresa_conta_data
  ON public.conciliacao_fechamentos_diarios(empresa_id, conta_bancaria_id, data_referencia DESC);

CREATE INDEX IF NOT EXISTS idx_conciliacao_fechamentos_empresa_status
  ON public.conciliacao_fechamentos_diarios(empresa_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS update_conciliacao_fechamentos_diarios_updated_at ON public.conciliacao_fechamentos_diarios;
CREATE TRIGGER update_conciliacao_fechamentos_diarios_updated_at
  BEFORE UPDATE ON public.conciliacao_fechamentos_diarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enriquecimento de sugestoes IA para novo alvo canonico
ALTER TABLE IF EXISTS public.bank_ai_suggestions
  ADD COLUMN IF NOT EXISTS item_financeiro_id UUID REFERENCES public.conciliacao_itens_financeiros(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_ai_suggestions_item_financeiro
  ON public.bank_ai_suggestions(item_financeiro_id)
  WHERE item_financeiro_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4) Ajustes em conciliacoes_bancarias para item canonico
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS public.conciliacoes_bancarias
  ADD COLUMN IF NOT EXISTS item_financeiro_id UUID REFERENCES public.conciliacao_itens_financeiros(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.conciliacoes_bancarias
  ALTER COLUMN lancamento_caixa_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conciliacoes_unique_tx_item
  ON public.conciliacoes_bancarias(extrato_transacao_id, item_financeiro_id)
  WHERE item_financeiro_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conciliacoes_item_financeiro
  ON public.conciliacoes_bancarias(item_financeiro_id)
  WHERE item_financeiro_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5) Funcoes de sincronizacao de item canonico
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_upsert_conciliacao_item_from_lancamento(p_lancamento_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
  v_lanc RECORD;
  v_origem_key TEXT;
BEGIN
  SELECT
    l.id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data,
    l.tipo,
    l.valor,
    l.historico,
    l.documento,
    l.observacoes
  INTO v_lanc
  FROM public.lancamentos_caixa l
  WHERE l.id = p_lancamento_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_origem_key := 'lancamento_caixa:' || v_lanc.id::TEXT;

  IF v_lanc.conta_bancaria_id IS NULL THEN
    DELETE FROM public.conciliacao_itens_financeiros
    WHERE empresa_id = v_lanc.empresa_id
      AND origem_key = v_origem_key;
    RETURN NULL;
  END IF;

  INSERT INTO public.conciliacao_itens_financeiros (
    empresa_id,
    conta_bancaria_id,
    data,
    tipo,
    valor_centavos,
    origem_tipo,
    origem_id_uuid,
    origem_id_bigint,
    origem_key,
    descricao_exibicao,
    documento,
    metadata,
    ativo
  ) VALUES (
    v_lanc.empresa_id,
    v_lanc.conta_bancaria_id,
    v_lanc.data,
    v_lanc.tipo,
    ROUND(ABS(COALESCE(v_lanc.valor, 0)::NUMERIC) * 100)::BIGINT,
    'lancamento_caixa',
    v_lanc.id,
    NULL,
    v_origem_key,
    COALESCE(NULLIF(v_lanc.historico, ''), 'Lancamento caixa'),
    NULLIF(v_lanc.documento, ''),
    jsonb_build_object(
      'observacoes', v_lanc.observacoes,
      'source', 'lancamentos_caixa'
    ),
    TRUE
  )
  ON CONFLICT (empresa_id, origem_key)
  DO UPDATE SET
    conta_bancaria_id = EXCLUDED.conta_bancaria_id,
    data = EXCLUDED.data,
    tipo = EXCLUDED.tipo,
    valor_centavos = EXCLUDED.valor_centavos,
    descricao_exibicao = EXCLUDED.descricao_exibicao,
    documento = EXCLUDED.documento,
    metadata = EXCLUDED.metadata,
    ativo = TRUE,
    updated_at = NOW()
  RETURNING id INTO v_item_id;

  RETURN v_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_upsert_conciliacao_item_from_movimentacao(p_mov_id BIGINT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
  v_mov RECORD;
  v_empresa_id UUID;
  v_tipo_item TEXT;
  v_descricao TEXT;
  v_origem_key TEXT;
BEGIN
  SELECT me.*
  INTO v_mov
  FROM public.movimentacoes_estoque me
  WHERE me.id = p_mov_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(op.empresa_id, eo.empresa_id, ed.empresa_id, cb.empresa_id, co.empresa_id)
  INTO v_empresa_id
  FROM public.movimentacoes_estoque me
  LEFT JOIN public.operacoes_estoque op ON op.id = me.operacao_estoque_id
  LEFT JOIN public.estoques eo ON eo.id = me.estoque_origem_id
  LEFT JOIN public.estoques ed ON ed.id = me.estoque_destino_id
  LEFT JOIN public.contas_bancarias cb ON cb.id = me.conta_bancaria_id
  LEFT JOIN public.contas_bancarias co ON co.id = me.conta_origem_id
  WHERE me.id = p_mov_id;

  IF v_empresa_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_origem_key := 'movimentacao_estoque:' || v_mov.id::TEXT;

  IF v_mov.conta_bancaria_id IS NULL THEN
    DELETE FROM public.conciliacao_itens_financeiros
    WHERE empresa_id = v_empresa_id
      AND origem_key = v_origem_key;
    RETURN NULL;
  END IF;

  v_tipo_item := CASE WHEN v_mov.tipo = 'estoque_para_conta' THEN 'entrada' ELSE 'saida' END;

  v_descricao := CASE v_mov.tipo
    WHEN 'conta_para_conta' THEN COALESCE(NULLIF(v_mov.historico, ''), 'Transferencia Conta para Conta')
    WHEN 'conta_para_estoque' THEN COALESCE(NULLIF(v_mov.historico, ''), 'Transferencia Conta para Estoque')
    WHEN 'estoque_para_conta' THEN COALESCE(NULLIF(v_mov.historico, ''), 'Transferencia Estoque para Conta')
    WHEN 'estoque_para_estoque' THEN COALESCE(NULLIF(v_mov.historico, ''), 'Transferencia Estoque para Estoque')
    ELSE COALESCE(NULLIF(v_mov.historico, ''), 'Movimentacao financeira')
  END;

  INSERT INTO public.conciliacao_itens_financeiros (
    empresa_id,
    conta_bancaria_id,
    data,
    tipo,
    valor_centavos,
    origem_tipo,
    origem_id_uuid,
    origem_id_bigint,
    origem_key,
    descricao_exibicao,
    documento,
    metadata,
    ativo
  ) VALUES (
    v_empresa_id,
    v_mov.conta_bancaria_id,
    v_mov.data,
    v_tipo_item,
    ROUND(ABS(COALESCE(v_mov.valor, 0)::NUMERIC) * 100)::BIGINT,
    'movimentacao_estoque',
    NULL,
    v_mov.id,
    v_origem_key,
    v_descricao,
    NULL,
    jsonb_build_object(
      'tipo_movimentacao', v_mov.tipo,
      'operacao_estoque_id', v_mov.operacao_estoque_id,
      'estoque_origem_id', v_mov.estoque_origem_id,
      'estoque_destino_id', v_mov.estoque_destino_id,
      'conta_origem_id', v_mov.conta_origem_id,
      'source', 'movimentacoes_estoque'
    ),
    TRUE
  )
  ON CONFLICT (empresa_id, origem_key)
  DO UPDATE SET
    conta_bancaria_id = EXCLUDED.conta_bancaria_id,
    data = EXCLUDED.data,
    tipo = EXCLUDED.tipo,
    valor_centavos = EXCLUDED.valor_centavos,
    descricao_exibicao = EXCLUDED.descricao_exibicao,
    documento = EXCLUDED.documento,
    metadata = EXCLUDED.metadata,
    ativo = TRUE,
    updated_at = NOW()
  RETURNING id INTO v_item_id;

  RETURN v_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_conciliacao_item_from_lancamento(
  p_lancamento_id UUID,
  p_empresa_hint UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID;
  v_item_id UUID;
BEGIN
  v_item_id := public.fn_upsert_conciliacao_item_from_lancamento(p_lancamento_id);

  IF v_item_id IS NULL THEN
    v_empresa_id := p_empresa_hint;
    IF v_empresa_id IS NULL THEN
      SELECT empresa_id INTO v_empresa_id
      FROM public.conciliacao_itens_financeiros
      WHERE origem_key = 'lancamento_caixa:' || p_lancamento_id::TEXT
      LIMIT 1;
    END IF;

    IF v_empresa_id IS NOT NULL THEN
      DELETE FROM public.conciliacao_itens_financeiros
      WHERE empresa_id = v_empresa_id
        AND origem_key = 'lancamento_caixa:' || p_lancamento_id::TEXT;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_conciliacao_item_from_movimentacao(
  p_mov_id BIGINT,
  p_empresa_hint UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID;
  v_item_id UUID;
BEGIN
  v_item_id := public.fn_upsert_conciliacao_item_from_movimentacao(p_mov_id);

  IF v_item_id IS NULL THEN
    v_empresa_id := p_empresa_hint;
    IF v_empresa_id IS NULL THEN
      SELECT empresa_id INTO v_empresa_id
      FROM public.conciliacao_itens_financeiros
      WHERE origem_key = 'movimentacao_estoque:' || p_mov_id::TEXT
      LIMIT 1;
    END IF;

    IF v_empresa_id IS NOT NULL THEN
      DELETE FROM public.conciliacao_itens_financeiros
      WHERE empresa_id = v_empresa_id
        AND origem_key = 'movimentacao_estoque:' || p_mov_id::TEXT;
    ELSE
      DELETE FROM public.conciliacao_itens_financeiros
      WHERE origem_key = 'movimentacao_estoque:' || p_mov_id::TEXT;
    END IF;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 6) Triggers de sincronizacao automatica
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sync_conciliacao_item_lancamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_sync_conciliacao_item_from_lancamento(OLD.id, OLD.empresa_id);
    RETURN OLD;
  END IF;

  PERFORM public.fn_sync_conciliacao_item_from_lancamento(NEW.id, NEW.empresa_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conciliacao_item_lancamento_aiud ON public.lancamentos_caixa;
CREATE TRIGGER trg_sync_conciliacao_item_lancamento_aiud
  AFTER INSERT OR UPDATE OR DELETE ON public.lancamentos_caixa
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_conciliacao_item_lancamento();

CREATE OR REPLACE FUNCTION public.trg_sync_conciliacao_item_movimentacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_hint UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT COALESCE(op.empresa_id, eo.empresa_id, ed.empresa_id, cb.empresa_id, co.empresa_id)
    INTO v_empresa_hint
    FROM public.operacoes_estoque op
    FULL OUTER JOIN public.estoques eo ON eo.id = OLD.estoque_origem_id
    FULL OUTER JOIN public.estoques ed ON ed.id = OLD.estoque_destino_id
    FULL OUTER JOIN public.contas_bancarias cb ON cb.id = OLD.conta_bancaria_id
    FULL OUTER JOIN public.contas_bancarias co ON co.id = OLD.conta_origem_id
    WHERE op.id = OLD.operacao_estoque_id
       OR eo.id = OLD.estoque_origem_id
       OR ed.id = OLD.estoque_destino_id
       OR cb.id = OLD.conta_bancaria_id
       OR co.id = OLD.conta_origem_id
    LIMIT 1;

    PERFORM public.fn_sync_conciliacao_item_from_movimentacao(OLD.id, v_empresa_hint);
    RETURN OLD;
  END IF;

  SELECT COALESCE(op.empresa_id, eo.empresa_id, ed.empresa_id, cb.empresa_id, co.empresa_id)
  INTO v_empresa_hint
  FROM public.operacoes_estoque op
  FULL OUTER JOIN public.estoques eo ON eo.id = NEW.estoque_origem_id
  FULL OUTER JOIN public.estoques ed ON ed.id = NEW.estoque_destino_id
  FULL OUTER JOIN public.contas_bancarias cb ON cb.id = NEW.conta_bancaria_id
  FULL OUTER JOIN public.contas_bancarias co ON co.id = NEW.conta_origem_id
  WHERE op.id = NEW.operacao_estoque_id
     OR eo.id = NEW.estoque_origem_id
     OR ed.id = NEW.estoque_destino_id
     OR cb.id = NEW.conta_bancaria_id
     OR co.id = NEW.conta_origem_id
  LIMIT 1;

  PERFORM public.fn_sync_conciliacao_item_from_movimentacao(NEW.id, v_empresa_hint);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conciliacao_item_movimentacao_aiud ON public.movimentacoes_estoque;
CREATE TRIGGER trg_sync_conciliacao_item_movimentacao_aiud
  AFTER INSERT OR UPDATE OR DELETE ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_conciliacao_item_movimentacao();

-- ------------------------------------------------------------
-- 7) View de status do item financeiro
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.vw_conciliacao_item_status;
CREATE OR REPLACE VIEW public.vw_conciliacao_item_status AS
SELECT
  i.id,
  i.empresa_id,
  i.conta_bancaria_id,
  i.data,
  i.tipo,
  i.valor_centavos,
  i.origem_tipo,
  i.origem_id_uuid,
  i.origem_id_bigint,
  i.origem_key,
  i.descricao_exibicao,
  i.documento,
  i.metadata,
  i.ativo,
  i.created_at,
  i.updated_at,
  COALESCE(s.confirmado_centavos, 0)::BIGINT AS confirmado_centavos,
  CASE
    WHEN COALESCE(s.confirmado_centavos, 0) > i.valor_centavos THEN 'divergente'
    WHEN i.valor_centavos > 0 AND COALESCE(s.confirmado_centavos, 0) = i.valor_centavos THEN 'verificado'
    WHEN COALESCE(s.confirmado_centavos, 0) > 0 THEN 'parcial'
    ELSE 'nao_conciliado'
  END AS status_verificacao
FROM public.conciliacao_itens_financeiros i
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(cb.valor_alocado_centavos), 0)::BIGINT AS confirmado_centavos
  FROM public.conciliacoes_bancarias cb
  WHERE cb.empresa_id = i.empresa_id
    AND cb.status = 'confirmed'
    AND (
      cb.item_financeiro_id = i.id
      OR (
        i.origem_tipo = 'lancamento_caixa'
        AND cb.item_financeiro_id IS NULL
        AND cb.lancamento_caixa_id = i.origem_id_uuid
      )
    )
) s ON TRUE
WHERE i.ativo = TRUE;

-- ------------------------------------------------------------
-- 8) Trigger de bloqueio total apos verificado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_block_verified_lancamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_role TEXT;
BEGIN
  v_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_role = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT status_verificacao
  INTO v_status
  FROM public.vw_conciliacao_item_status
  WHERE empresa_id = COALESCE(OLD.empresa_id, NEW.empresa_id)
    AND origem_key = 'lancamento_caixa:' || COALESCE(OLD.id, NEW.id)::TEXT
  LIMIT 1;

  IF v_status = 'verificado' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'LANCAMENTO_VERIFICADO_BLOQUEADO',
      DETAIL = 'Lancemento verificado nao pode ser editado/excluido. Desfaca a conciliacao antes.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_verified_lancamento_bud ON public.lancamentos_caixa;
CREATE TRIGGER trg_block_verified_lancamento_bud
  BEFORE UPDATE OR DELETE ON public.lancamentos_caixa
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_verified_lancamento();

CREATE OR REPLACE FUNCTION public.trg_block_verified_movimentacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_empresa_id UUID;
  v_role TEXT;
BEGIN
  v_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_role = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT empresa_id INTO v_empresa_id
  FROM public.conciliacao_itens_financeiros
  WHERE origem_key = 'movimentacao_estoque:' || COALESCE(OLD.id, NEW.id)::TEXT
  LIMIT 1;

  SELECT status_verificacao
  INTO v_status
  FROM public.vw_conciliacao_item_status
  WHERE empresa_id = v_empresa_id
    AND origem_key = 'movimentacao_estoque:' || COALESCE(OLD.id, NEW.id)::TEXT
  LIMIT 1;

  IF v_status = 'verificado' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'MOVIMENTACAO_VERIFICADA_BLOQUEADA',
      DETAIL = 'Movimentacao verificada nao pode ser editada/excluida. Desfaca a conciliacao antes.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_verified_movimentacao_bud ON public.movimentacoes_estoque;
CREATE TRIGGER trg_block_verified_movimentacao_bud
  BEFORE UPDATE OR DELETE ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_verified_movimentacao();

-- ------------------------------------------------------------
-- 9) RPC de backfill/sync incremental dos itens canonicamente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_bank_sync_conciliacao_itens(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := COALESCE((payload->>'empresa_id')::UUID, public.get_user_empresa_id());
  v_conta_id UUID := NULLIF(payload->>'conta_bancaria_id', '')::UUID;
  v_full_refresh BOOLEAN := COALESCE((payload->>'full_refresh')::BOOLEAN, FALSE);
  v_lanc_rows INTEGER := 0;
  v_mov_rows INTEGER := 0;
  v_deleted_rows INTEGER := 0;
  v_deleted_delta INTEGER := 0;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio';
  END IF;

  IF v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado para empresa informada';
  END IF;

  IF v_full_refresh THEN
    DELETE FROM public.conciliacao_itens_financeiros i
    WHERE i.empresa_id = v_empresa_id
      AND (v_conta_id IS NULL OR i.conta_bancaria_id = v_conta_id);
    GET DIAGNOSTICS v_deleted_rows = ROW_COUNT;
  END IF;

  INSERT INTO public.conciliacao_itens_financeiros (
    empresa_id,
    conta_bancaria_id,
    data,
    tipo,
    valor_centavos,
    origem_tipo,
    origem_id_uuid,
    origem_id_bigint,
    origem_key,
    descricao_exibicao,
    documento,
    metadata,
    ativo
  )
  SELECT
    l.empresa_id,
    l.conta_bancaria_id,
    l.data,
    l.tipo,
    ROUND(ABS(COALESCE(l.valor, 0)::NUMERIC) * 100)::BIGINT,
    'lancamento_caixa',
    l.id,
    NULL,
    'lancamento_caixa:' || l.id::TEXT,
    COALESCE(NULLIF(l.historico, ''), 'Lancamento caixa'),
    NULLIF(l.documento, ''),
    jsonb_build_object('observacoes', l.observacoes, 'source', 'lancamentos_caixa'),
    TRUE
  FROM public.lancamentos_caixa l
  WHERE l.empresa_id = v_empresa_id
    AND l.conta_bancaria_id IS NOT NULL
    AND (v_conta_id IS NULL OR l.conta_bancaria_id = v_conta_id)
  ON CONFLICT (empresa_id, origem_key)
  DO UPDATE SET
    conta_bancaria_id = EXCLUDED.conta_bancaria_id,
    data = EXCLUDED.data,
    tipo = EXCLUDED.tipo,
    valor_centavos = EXCLUDED.valor_centavos,
    descricao_exibicao = EXCLUDED.descricao_exibicao,
    documento = EXCLUDED.documento,
    metadata = EXCLUDED.metadata,
    ativo = TRUE,
    updated_at = NOW();

  GET DIAGNOSTICS v_lanc_rows = ROW_COUNT;

  INSERT INTO public.conciliacao_itens_financeiros (
    empresa_id,
    conta_bancaria_id,
    data,
    tipo,
    valor_centavos,
    origem_tipo,
    origem_id_uuid,
    origem_id_bigint,
    origem_key,
    descricao_exibicao,
    documento,
    metadata,
    ativo
  )
  SELECT
    COALESCE(op.empresa_id, eo.empresa_id, ed.empresa_id, cb.empresa_id, co.empresa_id) AS empresa_id,
    me.conta_bancaria_id,
    me.data,
    CASE WHEN me.tipo = 'estoque_para_conta' THEN 'entrada' ELSE 'saida' END AS tipo,
    ROUND(ABS(COALESCE(me.valor, 0)::NUMERIC) * 100)::BIGINT,
    'movimentacao_estoque',
    NULL,
    me.id,
    'movimentacao_estoque:' || me.id::TEXT,
    CASE me.tipo
      WHEN 'conta_para_conta' THEN COALESCE(NULLIF(me.historico, ''), 'Transferencia Conta para Conta')
      WHEN 'conta_para_estoque' THEN COALESCE(NULLIF(me.historico, ''), 'Transferencia Conta para Estoque')
      WHEN 'estoque_para_conta' THEN COALESCE(NULLIF(me.historico, ''), 'Transferencia Estoque para Conta')
      WHEN 'estoque_para_estoque' THEN COALESCE(NULLIF(me.historico, ''), 'Transferencia Estoque para Estoque')
      ELSE COALESCE(NULLIF(me.historico, ''), 'Movimentacao financeira')
    END,
    NULL,
    jsonb_build_object(
      'tipo_movimentacao', me.tipo,
      'operacao_estoque_id', me.operacao_estoque_id,
      'estoque_origem_id', me.estoque_origem_id,
      'estoque_destino_id', me.estoque_destino_id,
      'conta_origem_id', me.conta_origem_id,
      'source', 'movimentacoes_estoque'
    ),
    TRUE
  FROM public.movimentacoes_estoque me
  LEFT JOIN public.operacoes_estoque op ON op.id = me.operacao_estoque_id
  LEFT JOIN public.estoques eo ON eo.id = me.estoque_origem_id
  LEFT JOIN public.estoques ed ON ed.id = me.estoque_destino_id
  LEFT JOIN public.contas_bancarias cb ON cb.id = me.conta_bancaria_id
  LEFT JOIN public.contas_bancarias co ON co.id = me.conta_origem_id
  WHERE COALESCE(op.empresa_id, eo.empresa_id, ed.empresa_id, cb.empresa_id, co.empresa_id) = v_empresa_id
    AND me.conta_bancaria_id IS NOT NULL
    AND (v_conta_id IS NULL OR me.conta_bancaria_id = v_conta_id)
  ON CONFLICT (empresa_id, origem_key)
  DO UPDATE SET
    conta_bancaria_id = EXCLUDED.conta_bancaria_id,
    data = EXCLUDED.data,
    tipo = EXCLUDED.tipo,
    valor_centavos = EXCLUDED.valor_centavos,
    descricao_exibicao = EXCLUDED.descricao_exibicao,
    documento = EXCLUDED.documento,
    metadata = EXCLUDED.metadata,
    ativo = TRUE,
    updated_at = NOW();

  GET DIAGNOSTICS v_mov_rows = ROW_COUNT;

  DELETE FROM public.conciliacao_itens_financeiros i
  WHERE i.empresa_id = v_empresa_id
    AND (v_conta_id IS NULL OR i.conta_bancaria_id = v_conta_id)
    AND (
      (i.origem_tipo = 'lancamento_caixa' AND NOT EXISTS (
        SELECT 1
        FROM public.lancamentos_caixa l
        WHERE l.id = i.origem_id_uuid
          AND l.empresa_id = i.empresa_id
          AND l.conta_bancaria_id IS NOT NULL
      ))
      OR
      (i.origem_tipo = 'movimentacao_estoque' AND NOT EXISTS (
        SELECT 1
        FROM public.movimentacoes_estoque me
        LEFT JOIN public.operacoes_estoque op ON op.id = me.operacao_estoque_id
        LEFT JOIN public.estoques eo ON eo.id = me.estoque_origem_id
        LEFT JOIN public.estoques ed ON ed.id = me.estoque_destino_id
        LEFT JOIN public.contas_bancarias cb ON cb.id = me.conta_bancaria_id
        LEFT JOIN public.contas_bancarias co ON co.id = me.conta_origem_id
        WHERE me.id = i.origem_id_bigint
          AND me.conta_bancaria_id IS NOT NULL
          AND COALESCE(op.empresa_id, eo.empresa_id, ed.empresa_id, cb.empresa_id, co.empresa_id) = i.empresa_id
      ))
    );

  GET DIAGNOSTICS v_deleted_delta = ROW_COUNT;
  v_deleted_rows := v_deleted_rows + v_deleted_delta;

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'conta_bancaria_id', v_conta_id,
    'full_refresh', v_full_refresh,
    'upsert_lancamentos', v_lanc_rows,
    'upsert_movimentacoes', v_mov_rows,
    'deleted_stale', v_deleted_rows
  );
END;
$$;

-- ------------------------------------------------------------
-- 10) Helper de resumo diario
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bank_daily_summary(
  p_empresa_id UUID,
  p_conta_id UUID,
  p_data DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_itens INTEGER := 0;
  v_verificados INTEGER := 0;
  v_parciais INTEGER := 0;
  v_nao_conciliados INTEGER := 0;
  v_divergentes INTEGER := 0;
  v_total_extrato INTEGER := 0;
  v_extrato_pendencias INTEGER := 0;
  v_item_pendencias INTEGER := 0;
BEGIN
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE s.status_verificacao = 'verificado')::INT,
    COUNT(*) FILTER (WHERE s.status_verificacao = 'parcial')::INT,
    COUNT(*) FILTER (WHERE s.status_verificacao = 'nao_conciliado')::INT,
    COUNT(*) FILTER (WHERE s.status_verificacao = 'divergente')::INT
  INTO
    v_total_itens,
    v_verificados,
    v_parciais,
    v_nao_conciliados,
    v_divergentes
  FROM public.vw_conciliacao_item_status s
  WHERE s.empresa_id = p_empresa_id
    AND s.conta_bancaria_id = p_conta_id
    AND s.data = p_data;

  SELECT COUNT(*)::INT
  INTO v_total_extrato
  FROM public.extrato_transacoes t
  WHERE t.empresa_id = p_empresa_id
    AND t.conta_bancaria_id = p_conta_id
    AND t.data_movimento = p_data;

  SELECT COUNT(*)::INT
  INTO v_extrato_pendencias
  FROM public.extrato_transacoes t
  WHERE t.empresa_id = p_empresa_id
    AND t.conta_bancaria_id = p_conta_id
    AND t.data_movimento = p_data
    AND NOT EXISTS (
      SELECT 1
      FROM public.conciliacoes_bancarias cb
      WHERE cb.empresa_id = t.empresa_id
        AND cb.extrato_transacao_id = t.id
        AND cb.status = 'confirmed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.conciliacao_extrato_resolucoes r
      WHERE r.empresa_id = t.empresa_id
        AND r.extrato_transacao_id = t.id
        AND r.status = 'ignored_justified'
    );

  v_item_pendencias := v_parciais + v_nao_conciliados + v_divergentes;

  RETURN jsonb_build_object(
    'empresa_id', p_empresa_id,
    'conta_bancaria_id', p_conta_id,
    'data_referencia', p_data,
    'total_itens', v_total_itens,
    'itens_verificados', v_verificados,
    'itens_parciais', v_parciais,
    'itens_nao_conciliados', v_nao_conciliados,
    'itens_divergentes', v_divergentes,
    'item_pendencias_criticas', v_item_pendencias,
    'total_extrato_transacoes', v_total_extrato,
    'extrato_pendencias_criticas', v_extrato_pendencias,
    'pendencias_criticas_total', v_item_pendencias + v_extrato_pendencias
  );
END;
$$;

-- ------------------------------------------------------------
-- 11) RPCs: link, ignore, close, reopen
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_bank_link_item_and_reconcile(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_empresa_id UUID := COALESCE((payload->>'empresa_id')::UUID, public.get_user_empresa_id());
  v_extrato_tx_id UUID := (payload->>'extrato_transacao_id')::UUID;
  v_item_id UUID := (payload->>'item_financeiro_id')::UUID;
  v_idempotency_key TEXT := NULLIF(TRIM(payload->>'idempotency_key'), '');
  v_method TEXT := LOWER(COALESCE(NULLIF(payload->>'method', ''), 'manual'));
  v_confidence NUMERIC := COALESCE((payload->>'confidence')::NUMERIC, 1.0);
  v_explanation TEXT := COALESCE(NULLIF(payload->>'explanation', ''), 'Vinculado manualmente no fechamento diario.');
  v_valor_alocado_centavos BIGINT := NULLIF(payload->>'valor_alocado_centavos', '')::BIGINT;

  v_extrato RECORD;
  v_item RECORD;
  v_existing JSONB;
  v_result JSONB;
  v_conciliacao_id UUID;
  v_lancamento_id UUID;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio';
  END IF;

  IF v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado para empresa informada';
  END IF;

  IF v_extrato_tx_id IS NULL OR v_item_id IS NULL THEN
    RAISE EXCEPTION 'extrato_transacao_id e item_financeiro_id sao obrigatorios';
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT resultado_json
    INTO v_existing
    FROM public.conciliacao_bank_idempotency
    WHERE empresa_id = v_empresa_id
      AND idempotency_key = v_idempotency_key;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT t.*
  INTO v_extrato
  FROM public.extrato_transacoes t
  WHERE t.id = v_extrato_tx_id
    AND t.empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transacao de extrato nao encontrada para a empresa';
  END IF;

  SELECT i.*
  INTO v_item
  FROM public.conciliacao_itens_financeiros i
  WHERE i.id = v_item_id
    AND i.empresa_id = v_empresa_id
    AND i.ativo = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item financeiro nao encontrado para a empresa';
  END IF;

  IF v_item.conta_bancaria_id <> v_extrato.conta_bancaria_id THEN
    RAISE EXCEPTION 'Item financeiro e extrato pertencem a contas diferentes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.conciliacoes_bancarias cb
    WHERE cb.empresa_id = v_empresa_id
      AND cb.extrato_transacao_id = v_extrato_tx_id
      AND cb.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Transacao do extrato ja possui conciliacao confirmada';
  END IF;

  IF v_valor_alocado_centavos IS NULL OR v_valor_alocado_centavos <= 0 THEN
    v_valor_alocado_centavos := v_extrato.valor_centavos;
  END IF;

  IF v_item.origem_tipo = 'lancamento_caixa' THEN
    v_lancamento_id := v_item.origem_id_uuid;
  ELSE
    v_lancamento_id := NULL;
  END IF;

  INSERT INTO public.conciliacoes_bancarias (
    empresa_id,
    extrato_transacao_id,
    item_financeiro_id,
    lancamento_caixa_id,
    valor_alocado_centavos,
    status,
    confidence,
    method,
    explanation,
    confirmed_by,
    confirmed_at
  ) VALUES (
    v_empresa_id,
    v_extrato_tx_id,
    v_item_id,
    v_lancamento_id,
    v_valor_alocado_centavos,
    'confirmed',
    LEAST(GREATEST(v_confidence, 0), 1),
    CASE WHEN v_method IN ('manual', 'deterministic', 'rule', 'ai') THEN v_method ELSE 'manual' END,
    v_explanation,
    v_user_id,
    NOW()
  )
  RETURNING id INTO v_conciliacao_id;

  v_result := jsonb_build_object(
    'ok', true,
    'conciliacao_id', v_conciliacao_id,
    'extrato_transacao_id', v_extrato_tx_id,
    'item_financeiro_id', v_item_id,
    'lancamento_caixa_id', v_lancamento_id,
    'valor_alocado_centavos', v_valor_alocado_centavos
  );

  IF v_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO public.conciliacao_bank_idempotency (
        empresa_id,
        idempotency_key,
        lancamento_caixa_id,
        resultado_json
      ) VALUES (
        v_empresa_id,
        v_idempotency_key,
        v_lancamento_id,
        v_result
      );
    EXCEPTION WHEN unique_violation THEN
      SELECT resultado_json
      INTO v_existing
      FROM public.conciliacao_bank_idempotency
      WHERE empresa_id = v_empresa_id
        AND idempotency_key = v_idempotency_key;

      IF v_existing IS NOT NULL THEN
        RETURN v_existing;
      END IF;
    END;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_bank_ignore_extrato(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_empresa_id UUID := COALESCE((payload->>'empresa_id')::UUID, public.get_user_empresa_id());
  v_extrato_tx_id UUID := (payload->>'extrato_transacao_id')::UUID;
  v_justificativa TEXT := NULLIF(TRIM(payload->>'justificativa'), '');
  v_row RECORD;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio';
  END IF;

  IF v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado para empresa informada';
  END IF;

  IF v_extrato_tx_id IS NULL OR v_justificativa IS NULL THEN
    RAISE EXCEPTION 'extrato_transacao_id e justificativa sao obrigatorios';
  END IF;

  PERFORM 1
  FROM public.extrato_transacoes t
  WHERE t.id = v_extrato_tx_id
    AND t.empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transacao de extrato nao encontrada para a empresa';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.conciliacoes_bancarias cb
    WHERE cb.empresa_id = v_empresa_id
      AND cb.extrato_transacao_id = v_extrato_tx_id
      AND cb.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Nao e permitido ignorar transacao ja conciliada';
  END IF;

  INSERT INTO public.conciliacao_extrato_resolucoes (
    empresa_id,
    extrato_transacao_id,
    status,
    justificativa,
    resolved_by,
    resolved_at
  ) VALUES (
    v_empresa_id,
    v_extrato_tx_id,
    'ignored_justified',
    v_justificativa,
    v_user_id,
    NOW()
  )
  ON CONFLICT (empresa_id, extrato_transacao_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    justificativa = EXCLUDED.justificativa,
    resolved_by = EXCLUDED.resolved_by,
    resolved_at = EXCLUDED.resolved_at,
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'empresa_id', v_row.empresa_id,
    'extrato_transacao_id', v_row.extrato_transacao_id,
    'status', v_row.status,
    'justificativa', v_row.justificativa,
    'resolved_by', v_row.resolved_by,
    'resolved_at', v_row.resolved_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_bank_daily_close(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_empresa_id UUID := COALESCE((payload->>'empresa_id')::UUID, public.get_user_empresa_id());
  v_conta_id UUID := (payload->>'conta_bancaria_id')::UUID;
  v_data DATE := COALESCE((payload->>'data_referencia')::DATE, CURRENT_DATE);
  v_observacoes TEXT := NULLIF(payload->>'observacoes', '');
  v_summary JSONB;
  v_pendencias INTEGER := 0;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio';
  END IF;

  IF v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado para empresa informada';
  END IF;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'conta_bancaria_id obrigatorio';
  END IF;

  IF NOT public.is_admin_or_financeiro(v_user_id) THEN
    RAISE EXCEPTION 'Apenas perfis Admin/Financeiro podem fechar conciliacao diaria';
  END IF;

  PERFORM 1
  FROM public.contas_bancarias c
  WHERE c.id = v_conta_id
    AND c.empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta bancaria invalida para a empresa';
  END IF;

  v_summary := public.fn_bank_daily_summary(v_empresa_id, v_conta_id, v_data);
  v_pendencias := COALESCE((v_summary->>'pendencias_criticas_total')::INT, 0);

  IF v_pendencias > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DAILY_CLOSE_BLOCKED_PENDING_CRITICAL',
      DETAIL = format('Fechamento bloqueado: %s pendencia(s) critica(s).', v_pendencias);
  END IF;

  INSERT INTO public.conciliacao_fechamentos_diarios (
    empresa_id,
    conta_bancaria_id,
    data_referencia,
    status,
    total_itens,
    itens_verificados,
    itens_parciais,
    itens_nao_conciliados,
    itens_divergentes,
    total_extrato_transacoes,
    extrato_pendencias_criticas,
    observacoes,
    closed_by,
    closed_at,
    reopened_by,
    reopened_at
  ) VALUES (
    v_empresa_id,
    v_conta_id,
    v_data,
    'closed',
    COALESCE((v_summary->>'total_itens')::INT, 0),
    COALESCE((v_summary->>'itens_verificados')::INT, 0),
    COALESCE((v_summary->>'itens_parciais')::INT, 0),
    COALESCE((v_summary->>'itens_nao_conciliados')::INT, 0),
    COALESCE((v_summary->>'itens_divergentes')::INT, 0),
    COALESCE((v_summary->>'total_extrato_transacoes')::INT, 0),
    COALESCE((v_summary->>'extrato_pendencias_criticas')::INT, 0),
    v_observacoes,
    v_user_id,
    NOW(),
    NULL,
    NULL
  )
  ON CONFLICT (empresa_id, conta_bancaria_id, data_referencia)
  DO UPDATE SET
    status = 'closed',
    total_itens = EXCLUDED.total_itens,
    itens_verificados = EXCLUDED.itens_verificados,
    itens_parciais = EXCLUDED.itens_parciais,
    itens_nao_conciliados = EXCLUDED.itens_nao_conciliados,
    itens_divergentes = EXCLUDED.itens_divergentes,
    total_extrato_transacoes = EXCLUDED.total_extrato_transacoes,
    extrato_pendencias_criticas = EXCLUDED.extrato_pendencias_criticas,
    observacoes = EXCLUDED.observacoes,
    closed_by = v_user_id,
    closed_at = NOW(),
    reopened_by = NULL,
    reopened_at = NULL,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'conta_bancaria_id', v_conta_id,
    'data_referencia', v_data,
    'status', 'closed',
    'summary', v_summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_bank_daily_reopen(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_empresa_id UUID := COALESCE((payload->>'empresa_id')::UUID, public.get_user_empresa_id());
  v_conta_id UUID := (payload->>'conta_bancaria_id')::UUID;
  v_data DATE := COALESCE((payload->>'data_referencia')::DATE, CURRENT_DATE);
  v_observacoes TEXT := NULLIF(payload->>'observacoes', '');
  v_summary JSONB;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio';
  END IF;

  IF v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado para empresa informada';
  END IF;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'conta_bancaria_id obrigatorio';
  END IF;

  IF NOT public.is_admin_or_financeiro(v_user_id) THEN
    RAISE EXCEPTION 'Apenas perfis Admin/Financeiro podem reabrir conciliacao diaria';
  END IF;

  PERFORM 1
  FROM public.contas_bancarias c
  WHERE c.id = v_conta_id
    AND c.empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta bancaria invalida para a empresa';
  END IF;

  v_summary := public.fn_bank_daily_summary(v_empresa_id, v_conta_id, v_data);

  INSERT INTO public.conciliacao_fechamentos_diarios (
    empresa_id,
    conta_bancaria_id,
    data_referencia,
    status,
    total_itens,
    itens_verificados,
    itens_parciais,
    itens_nao_conciliados,
    itens_divergentes,
    total_extrato_transacoes,
    extrato_pendencias_criticas,
    observacoes,
    reopened_by,
    reopened_at
  ) VALUES (
    v_empresa_id,
    v_conta_id,
    v_data,
    'reopened',
    COALESCE((v_summary->>'total_itens')::INT, 0),
    COALESCE((v_summary->>'itens_verificados')::INT, 0),
    COALESCE((v_summary->>'itens_parciais')::INT, 0),
    COALESCE((v_summary->>'itens_nao_conciliados')::INT, 0),
    COALESCE((v_summary->>'itens_divergentes')::INT, 0),
    COALESCE((v_summary->>'total_extrato_transacoes')::INT, 0),
    COALESCE((v_summary->>'extrato_pendencias_criticas')::INT, 0),
    v_observacoes,
    v_user_id,
    NOW()
  )
  ON CONFLICT (empresa_id, conta_bancaria_id, data_referencia)
  DO UPDATE SET
    status = 'reopened',
    total_itens = EXCLUDED.total_itens,
    itens_verificados = EXCLUDED.itens_verificados,
    itens_parciais = EXCLUDED.itens_parciais,
    itens_nao_conciliados = EXCLUDED.itens_nao_conciliados,
    itens_divergentes = EXCLUDED.itens_divergentes,
    total_extrato_transacoes = EXCLUDED.total_extrato_transacoes,
    extrato_pendencias_criticas = EXCLUDED.extrato_pendencias_criticas,
    observacoes = EXCLUDED.observacoes,
    reopened_by = v_user_id,
    reopened_at = NOW(),
    updated_at = NOW();

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'conta_bancaria_id', v_conta_id,
    'data_referencia', v_data,
    'status', 'reopened',
    'summary', v_summary
  );
END;
$$;

-- ------------------------------------------------------------
-- 12) Ajustes em RPCs existentes (create/split) para item_financeiro
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_bank_create_lancamento_and_reconcile(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_empresa_id UUID := COALESCE((payload->>'empresa_id')::UUID, public.get_user_empresa_id());
  v_conta_id UUID := (payload->>'conta_bancaria_id')::UUID;
  v_extrato_tx_id UUID := (payload->>'extrato_transacao_id')::UUID;
  v_idempotency_key TEXT := NULLIF(TRIM(payload->>'idempotency_key'), '');
  v_tipo TEXT := LOWER(COALESCE(payload->>'tipo', ''));
  v_data DATE := COALESCE((payload->>'data')::DATE, CURRENT_DATE);
  v_valor NUMERIC := ROUND(ABS(COALESCE((payload->>'valor')::NUMERIC, 0))::NUMERIC, 2);
  v_historico TEXT := COALESCE(NULLIF(payload->>'historico', ''), NULLIF(payload->>'descricao', ''), 'Conciliacao bancaria');
  v_documento TEXT := NULLIF(payload->>'documento', '');
  v_observacoes TEXT := NULLIF(payload->>'observacoes', '');
  v_grupo_contas_id UUID := NULLIF(payload->>'grupo_contas_id', '')::UUID;
  v_method TEXT := LOWER(COALESCE(NULLIF(payload->>'method', ''), 'manual'));
  v_explanation TEXT := COALESCE(NULLIF(payload->>'explanation', ''), 'Lancamento criado e conciliado automaticamente.');
  v_valor_centavos BIGINT := COALESCE((payload->>'valor_centavos')::BIGINT, ROUND(ABS(COALESCE((payload->>'valor')::NUMERIC, 0)) * 100)::BIGINT);

  v_lancamento_id UUID;
  v_item_id UUID;
  v_conciliacao_id UUID;
  v_novo_saldo NUMERIC;
  v_result JSONB;
  v_existing JSONB;

  v_extrato_empresa UUID;
  v_extrato_conta UUID;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio';
  END IF;

  IF v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado para empresa informada';
  END IF;

  IF v_conta_id IS NULL OR v_extrato_tx_id IS NULL OR v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'conta_bancaria_id, extrato_transacao_id e idempotency_key sao obrigatorios';
  END IF;

  IF v_tipo NOT IN ('entrada', 'saida') THEN
    RAISE EXCEPTION 'tipo invalido. Use entrada ou saida';
  END IF;

  IF v_method NOT IN ('manual', 'deterministic', 'rule', 'ai') THEN
    v_method := 'manual';
  END IF;

  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'valor deve ser maior que zero';
  END IF;

  SELECT resultado_json
  INTO v_existing
  FROM public.conciliacao_bank_idempotency
  WHERE empresa_id = v_empresa_id
    AND idempotency_key = v_idempotency_key;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  PERFORM 1
  FROM public.contas_bancarias c
  WHERE c.id = v_conta_id
    AND c.empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta bancaria invalida para a empresa';
  END IF;

  SELECT t.empresa_id, t.conta_bancaria_id
  INTO v_extrato_empresa, v_extrato_conta
  FROM public.extrato_transacoes t
  WHERE t.id = v_extrato_tx_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transacao de extrato nao encontrada';
  END IF;

  IF v_extrato_empresa <> v_empresa_id OR v_extrato_conta <> v_conta_id THEN
    RAISE EXCEPTION 'Transacao de extrato nao pertence a conta/empresa informada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.conciliacoes_bancarias cb
    WHERE cb.extrato_transacao_id = v_extrato_tx_id
      AND cb.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Transacao do extrato ja conciliada';
  END IF;

  INSERT INTO public.lancamentos_caixa (
    empresa_id,
    conta_bancaria_id,
    grupo_contas_id,
    data,
    historico,
    tipo,
    valor,
    documento,
    observacoes
  ) VALUES (
    v_empresa_id,
    v_conta_id,
    v_grupo_contas_id,
    v_data,
    v_historico,
    v_tipo,
    v_valor,
    v_documento,
    v_observacoes
  )
  RETURNING id INTO v_lancamento_id;

  v_item_id := public.fn_upsert_conciliacao_item_from_lancamento(v_lancamento_id);

  INSERT INTO public.conciliacoes_bancarias (
    empresa_id,
    extrato_transacao_id,
    item_financeiro_id,
    lancamento_caixa_id,
    valor_alocado_centavos,
    status,
    confidence,
    method,
    explanation,
    confirmed_by,
    confirmed_at
  ) VALUES (
    v_empresa_id,
    v_extrato_tx_id,
    v_item_id,
    v_lancamento_id,
    v_valor_centavos,
    'confirmed',
    1.0,
    v_method,
    v_explanation,
    v_user_id,
    NOW()
  )
  RETURNING id INTO v_conciliacao_id;

  v_novo_saldo := public.rpc_bank_recompute_account_balance(v_conta_id);

  v_result := jsonb_build_object(
    'ok', true,
    'lancamento_id', v_lancamento_id,
    'item_financeiro_id', v_item_id,
    'conciliacao_id', v_conciliacao_id,
    'novo_saldo', v_novo_saldo,
    'conta_bancaria_id', v_conta_id,
    'extrato_transacao_id', v_extrato_tx_id
  );

  BEGIN
    INSERT INTO public.conciliacao_bank_idempotency (
      empresa_id,
      idempotency_key,
      lancamento_caixa_id,
      resultado_json
    ) VALUES (
      v_empresa_id,
      v_idempotency_key,
      v_lancamento_id,
      v_result
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT resultado_json
    INTO v_existing
    FROM public.conciliacao_bank_idempotency
    WHERE empresa_id = v_empresa_id
      AND idempotency_key = v_idempotency_key;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_bank_split_reconciliation(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_empresa_id UUID := COALESCE((payload->>'empresa_id')::UUID, public.get_user_empresa_id());
  v_conta_id UUID := (payload->>'conta_bancaria_id')::UUID;
  v_extrato_tx_id UUID := (payload->>'extrato_transacao_id')::UUID;
  v_idempotency_key TEXT := NULLIF(TRIM(payload->>'idempotency_key'), '');
  v_items JSONB := COALESCE(payload->'items', payload->'splits', '[]'::jsonb);

  v_extrato_empresa UUID;
  v_extrato_conta UUID;
  v_extrato_valor_centavos BIGINT;
  v_extrato_data DATE;

  v_item JSONB;
  v_item_tipo TEXT;
  v_item_data DATE;
  v_item_historico TEXT;
  v_item_documento TEXT;
  v_item_observacoes TEXT;
  v_item_grupo_contas_id UUID;
  v_item_valor_centavos BIGINT;
  v_item_valor NUMERIC;

  v_soma_centavos BIGINT := 0;
  v_lancamento_id UUID;
  v_item_id UUID;
  v_conciliacao_id UUID;
  v_lancamento_ids UUID[] := '{}';
  v_item_ids UUID[] := '{}';
  v_conciliacao_ids UUID[] := '{}';
  v_first_lancamento_id UUID := NULL;
  v_novo_saldo NUMERIC;
  v_result JSONB;
  v_existing JSONB;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio';
  END IF;

  IF v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado para empresa informada';
  END IF;

  IF v_conta_id IS NULL OR v_extrato_tx_id IS NULL OR v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'conta_bancaria_id, extrato_transacao_id e idempotency_key sao obrigatorios';
  END IF;

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items deve ser um array nao vazio';
  END IF;

  SELECT resultado_json
  INTO v_existing
  FROM public.conciliacao_bank_idempotency
  WHERE empresa_id = v_empresa_id
    AND idempotency_key = v_idempotency_key;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  PERFORM 1
  FROM public.contas_bancarias c
  WHERE c.id = v_conta_id
    AND c.empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta bancaria invalida para a empresa';
  END IF;

  SELECT t.empresa_id, t.conta_bancaria_id, t.valor_centavos, t.data_movimento
  INTO v_extrato_empresa, v_extrato_conta, v_extrato_valor_centavos, v_extrato_data
  FROM public.extrato_transacoes t
  WHERE t.id = v_extrato_tx_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transacao de extrato nao encontrada';
  END IF;

  IF v_extrato_empresa <> v_empresa_id OR v_extrato_conta <> v_conta_id THEN
    RAISE EXCEPTION 'Transacao de extrato nao pertence a conta/empresa informada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.conciliacoes_bancarias cb
    WHERE cb.extrato_transacao_id = v_extrato_tx_id
      AND cb.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Transacao do extrato ja conciliada';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS t(value)
  LOOP
    v_item_tipo := LOWER(COALESCE(v_item->>'tipo', ''));
    v_item_data := COALESCE(NULLIF(v_item->>'data', '')::DATE, v_extrato_data, CURRENT_DATE);
    v_item_historico := COALESCE(
      NULLIF(v_item->>'historico', ''),
      NULLIF(v_item->>'descricao', ''),
      'Split conciliacao bancaria'
    );
    v_item_documento := NULLIF(v_item->>'documento', '');
    v_item_observacoes := NULLIF(v_item->>'observacoes', '');
    v_item_grupo_contas_id := NULLIF(v_item->>'grupo_contas_id', '')::UUID;
    v_item_valor_centavos := COALESCE(
      NULLIF(v_item->>'valor_centavos', '')::BIGINT,
      ROUND(ABS(COALESCE((v_item->>'valor')::NUMERIC, 0)) * 100)::BIGINT
    );

    IF v_item_tipo NOT IN ('entrada', 'saida') THEN
      RAISE EXCEPTION 'tipo invalido no split. Use entrada ou saida';
    END IF;

    IF v_item_valor_centavos IS NULL OR v_item_valor_centavos <= 0 THEN
      RAISE EXCEPTION 'valor_centavos invalido no split';
    END IF;

    v_item_valor := ROUND((v_item_valor_centavos::NUMERIC / 100), 2);

    INSERT INTO public.lancamentos_caixa (
      empresa_id,
      conta_bancaria_id,
      grupo_contas_id,
      data,
      historico,
      tipo,
      valor,
      documento,
      observacoes
    ) VALUES (
      v_empresa_id,
      v_conta_id,
      v_item_grupo_contas_id,
      v_item_data,
      v_item_historico,
      v_item_tipo,
      v_item_valor,
      v_item_documento,
      v_item_observacoes
    )
    RETURNING id INTO v_lancamento_id;

    v_item_id := public.fn_upsert_conciliacao_item_from_lancamento(v_lancamento_id);

    IF v_first_lancamento_id IS NULL THEN
      v_first_lancamento_id := v_lancamento_id;
    END IF;

    v_lancamento_ids := array_append(v_lancamento_ids, v_lancamento_id);
    v_item_ids := array_append(v_item_ids, v_item_id);

    INSERT INTO public.conciliacoes_bancarias (
      empresa_id,
      extrato_transacao_id,
      item_financeiro_id,
      lancamento_caixa_id,
      valor_alocado_centavos,
      status,
      confidence,
      method,
      explanation,
      confirmed_by,
      confirmed_at
    ) VALUES (
      v_empresa_id,
      v_extrato_tx_id,
      v_item_id,
      v_lancamento_id,
      v_item_valor_centavos,
      'confirmed',
      1.0,
      'manual',
      COALESCE(NULLIF(v_item->>'explanation', ''), 'Split confirmado manualmente.'),
      v_user_id,
      NOW()
    )
    RETURNING id INTO v_conciliacao_id;

    v_conciliacao_ids := array_append(v_conciliacao_ids, v_conciliacao_id);
    v_soma_centavos := v_soma_centavos + v_item_valor_centavos;
  END LOOP;

  IF v_soma_centavos <> v_extrato_valor_centavos THEN
    RAISE EXCEPTION 'Soma do split (% centavos) diferente do valor do extrato (% centavos)', v_soma_centavos, v_extrato_valor_centavos;
  END IF;

  v_novo_saldo := public.rpc_bank_recompute_account_balance(v_conta_id);

  v_result := jsonb_build_object(
    'ok', true,
    'conta_bancaria_id', v_conta_id,
    'extrato_transacao_id', v_extrato_tx_id,
    'lancamento_ids', to_jsonb(v_lancamento_ids),
    'item_financeiro_ids', to_jsonb(v_item_ids),
    'conciliacao_ids', to_jsonb(v_conciliacao_ids),
    'soma_centavos', v_soma_centavos,
    'novo_saldo', v_novo_saldo
  );

  BEGIN
    INSERT INTO public.conciliacao_bank_idempotency (
      empresa_id,
      idempotency_key,
      lancamento_caixa_id,
      resultado_json
    ) VALUES (
      v_empresa_id,
      v_idempotency_key,
      v_first_lancamento_id,
      v_result
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT resultado_json
    INTO v_existing
    FROM public.conciliacao_bank_idempotency
    WHERE empresa_id = v_empresa_id
      AND idempotency_key = v_idempotency_key;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END;

  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------
-- 13) RLS para novas tabelas
-- ------------------------------------------------------------
ALTER TABLE public.conciliacao_itens_financeiros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacao_extrato_resolucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacao_fechamentos_diarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users mng conciliacao_itens_financeiros" ON public.conciliacao_itens_financeiros;
CREATE POLICY "Users mng conciliacao_itens_financeiros"
  ON public.conciliacao_itens_financeiros
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "Users mng conciliacao_extrato_resolucoes" ON public.conciliacao_extrato_resolucoes;
CREATE POLICY "Users mng conciliacao_extrato_resolucoes"
  ON public.conciliacao_extrato_resolucoes
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "Users view conciliacao_fechamentos_diarios" ON public.conciliacao_fechamentos_diarios;
DROP POLICY IF EXISTS "Users write conciliacao_fechamentos_diarios" ON public.conciliacao_fechamentos_diarios;
DROP POLICY IF EXISTS "Users mng conciliacao_fechamentos_diarios" ON public.conciliacao_fechamentos_diarios;
DROP POLICY IF EXISTS "Users update conciliacao_fechamentos_diarios" ON public.conciliacao_fechamentos_diarios;

CREATE POLICY "Users view conciliacao_fechamentos_diarios"
  ON public.conciliacao_fechamentos_diarios
  FOR SELECT
  USING (empresa_id = public.get_user_empresa_id());

CREATE POLICY "Users write conciliacao_fechamentos_diarios"
  ON public.conciliacao_fechamentos_diarios
  FOR INSERT
  WITH CHECK (
    empresa_id = public.get_user_empresa_id()
    AND public.is_admin_or_financeiro(auth.uid())
  );

CREATE POLICY "Users update conciliacao_fechamentos_diarios"
  ON public.conciliacao_fechamentos_diarios
  FOR UPDATE
  USING (
    empresa_id = public.get_user_empresa_id()
    AND public.is_admin_or_financeiro(auth.uid())
  )
  WITH CHECK (
    empresa_id = public.get_user_empresa_id()
    AND public.is_admin_or_financeiro(auth.uid())
  );

-- ------------------------------------------------------------
-- 14) Grants
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_upsert_conciliacao_item_from_lancamento(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_upsert_conciliacao_item_from_movimentacao(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_conciliacao_item_from_lancamento(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_conciliacao_item_from_movimentacao(BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bank_daily_summary(UUID, UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_sync_conciliacao_itens(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_link_item_and_reconcile(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_ignore_extrato(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_daily_close(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_daily_reopen(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_create_lancamento_and_reconcile(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_split_reconciliation(JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_upsert_conciliacao_item_from_lancamento(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upsert_conciliacao_item_from_movimentacao(BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_conciliacao_item_from_lancamento(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_conciliacao_item_from_movimentacao(BIGINT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bank_daily_summary(UUID, UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_sync_conciliacao_itens(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_link_item_and_reconcile(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_ignore_extrato(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_daily_close(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_daily_reopen(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_create_lancamento_and_reconcile(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_split_reconciliation(JSONB) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 15) Comentarios
-- ------------------------------------------------------------
COMMENT ON TABLE public.conciliacao_itens_financeiros IS
  'Camada canonica de itens financeiros conciliaveis (lancamentos_caixa e movimentacoes_estoque).';

COMMENT ON TABLE public.conciliacao_extrato_resolucoes IS
  'Resolucao explicita de transacoes de extrato sem match, com justificativa auditavel.';

COMMENT ON TABLE public.conciliacao_fechamentos_diarios IS
  'Controle de fechamento diario por conta bancaria e empresa.';

COMMENT ON VIEW public.vw_conciliacao_item_status IS
  'Status derivado por item financeiro: nao_conciliado, parcial, verificado, divergente.';

COMMENT ON FUNCTION public.rpc_bank_sync_conciliacao_itens(JSONB) IS
  'Backfill e sincronizacao incremental da camada canonica de conciliacao.';

COMMENT ON FUNCTION public.rpc_bank_link_item_and_reconcile(JSONB) IS
  'Vincula transacao de extrato a item financeiro existente e confirma conciliacao com idempotencia.';

COMMENT ON FUNCTION public.rpc_bank_ignore_extrato(JSONB) IS
  'Marca transacao do extrato como ignorada com justificativa auditavel.';

COMMENT ON FUNCTION public.rpc_bank_daily_close(JSONB) IS
  'Fecha conciliacao diaria por conta apenas sem pendencias criticas.';

COMMENT ON FUNCTION public.rpc_bank_daily_reopen(JSONB) IS
  'Reabre fechamento diario por conta com auditoria de usuario.';
