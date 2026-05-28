-- ============================================
-- CONCILIACAO BANCARIA + IA (Milestone A1)
-- ============================================

-- 1) Arquivos de extrato importados
CREATE TABLE IF NOT EXISTS public.extratos_import (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('bradesco', 'itau', 'ofx_generic')),
  file_format TEXT NOT NULL DEFAULT 'csv' CHECK (file_format IN ('csv', 'ofx')),
  file_storage_bucket TEXT NOT NULL DEFAULT 'extratos-bancarios',
  file_storage_key TEXT NOT NULL,
  original_filename TEXT,
  file_sha256 TEXT NOT NULL,
  periodo_inicio DATE,
  periodo_fim DATE,
  parse_status TEXT NOT NULL DEFAULT 'received' CHECK (
    parse_status IN ('received', 'processing', 'parsed', 'failed', 'duplicate')
  ),
  parse_attempts INTEGER NOT NULL DEFAULT 0 CHECK (parse_attempts >= 0),
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extratos_import_empresa
  ON public.extratos_import(empresa_id);
CREATE INDEX IF NOT EXISTS idx_extratos_import_conta
  ON public.extratos_import(conta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_extratos_import_status
  ON public.extratos_import(parse_status);
CREATE INDEX IF NOT EXISTS idx_extratos_import_created_at
  ON public.extratos_import(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_extratos_import_unique_hash
  ON public.extratos_import(empresa_id, conta_bancaria_id, file_sha256);

DROP TRIGGER IF EXISTS update_extratos_import_updated_at ON public.extratos_import;
CREATE TRIGGER update_extratos_import_updated_at
  BEFORE UPDATE ON public.extratos_import
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 2) Transacoes normalizadas do extrato
CREATE TABLE IF NOT EXISTS public.extrato_transacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  extrato_import_id UUID NOT NULL REFERENCES public.extratos_import(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,

  fit_id TEXT,
  hash_fallback TEXT NOT NULL,
  line_number INTEGER NOT NULL DEFAULT 1 CHECK (line_number > 0),
  dedupe_ordinal INTEGER NOT NULL DEFAULT 1 CHECK (dedupe_ordinal > 0),

  data_movimento DATE NOT NULL,
  data_compensacao DATE,
  descricao_raw TEXT NOT NULL,
  descricao_norm TEXT NOT NULL,
  valor_centavos BIGINT NOT NULL CHECK (valor_centavos >= 0),
  tipo TEXT NOT NULL CHECK (tipo IN ('credit', 'debit', 'other')),
  documento_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extrato_transacoes_import
  ON public.extrato_transacoes(extrato_import_id);
CREATE INDEX IF NOT EXISTS idx_extrato_transacoes_conta_data
  ON public.extrato_transacoes(conta_bancaria_id, data_movimento);
CREATE INDEX IF NOT EXISTS idx_extrato_transacoes_empresa_conta_data
  ON public.extrato_transacoes(empresa_id, conta_bancaria_id, data_movimento);
CREATE INDEX IF NOT EXISTS idx_extrato_transacoes_valor_tipo
  ON public.extrato_transacoes(conta_bancaria_id, valor_centavos, tipo);

CREATE UNIQUE INDEX IF NOT EXISTS idx_extrato_transacoes_unique_fit
  ON public.extrato_transacoes(conta_bancaria_id, fit_id)
  WHERE fit_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_extrato_transacoes_unique_hash
  ON public.extrato_transacoes(conta_bancaria_id, hash_fallback);

DROP TRIGGER IF EXISTS update_extrato_transacoes_updated_at ON public.extrato_transacoes;
CREATE TRIGGER update_extrato_transacoes_updated_at
  BEFORE UPDATE ON public.extrato_transacoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 3) Conciliacoes
CREATE TABLE IF NOT EXISTS public.conciliacoes_bancarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  extrato_transacao_id UUID NOT NULL REFERENCES public.extrato_transacoes(id) ON DELETE CASCADE,
  lancamento_caixa_id UUID NOT NULL REFERENCES public.lancamentos_caixa(id) ON DELETE CASCADE,

  valor_alocado_centavos BIGINT NOT NULL CHECK (valor_alocado_centavos >= 0),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (
    status IN ('suggested', 'confirmed', 'rejected')
  ),
  confidence NUMERIC(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'deterministic', 'rule', 'ai')),
  explanation TEXT,
  rule_id UUID,

  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conciliacoes_unique_pair
  ON public.conciliacoes_bancarias(extrato_transacao_id, lancamento_caixa_id);
CREATE INDEX IF NOT EXISTS idx_conciliacoes_lancamento
  ON public.conciliacoes_bancarias(lancamento_caixa_id);
CREATE INDEX IF NOT EXISTS idx_conciliacoes_extrato
  ON public.conciliacoes_bancarias(extrato_transacao_id);
CREATE INDEX IF NOT EXISTS idx_conciliacoes_empresa_status_created
  ON public.conciliacoes_bancarias(empresa_id, status, created_at DESC);

DROP TRIGGER IF EXISTS update_conciliacoes_bancarias_updated_at ON public.conciliacoes_bancarias;
CREATE TRIGGER update_conciliacoes_bancarias_updated_at
  BEFORE UPDATE ON public.conciliacoes_bancarias
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 4) Regras de conciliacao
CREATE TABLE IF NOT EXISTS public.regras_conciliacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conta_bancaria_id UUID REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,

  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'startswith', 'regex', 'exact')),
  pattern TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('credit', 'debit', 'both')),

  default_grupo_contas_id UUID REFERENCES public.grupos_contas(id) ON DELETE SET NULL,
  default_centro_custo TEXT,

  auto_create BOOLEAN NOT NULL DEFAULT FALSE,
  auto_confirm BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regras_conciliacao_empresa
  ON public.regras_conciliacao(empresa_id);
CREATE INDEX IF NOT EXISTS idx_regras_conciliacao_empresa_active_priority
  ON public.regras_conciliacao(empresa_id, active, priority DESC);

DROP TRIGGER IF EXISTS update_regras_conciliacao_updated_at ON public.regras_conciliacao;
CREATE TRIGGER update_regras_conciliacao_updated_at
  BEFORE UPDATE ON public.regras_conciliacao
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 5) Idempotencia de criacao + conciliacao
CREATE TABLE IF NOT EXISTS public.conciliacao_bank_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  lancamento_caixa_id UUID REFERENCES public.lancamentos_caixa(id) ON DELETE SET NULL,
  resultado_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_conciliacao_bank_idempotency UNIQUE (empresa_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_conciliacao_bank_idempotency_empresa_created
  ON public.conciliacao_bank_idempotency(empresa_id, created_at DESC);


-- 6) Bucket de extratos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'extratos-bancarios',
  'extratos-bancarios',
  false,
  52428800,
  ARRAY[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'text/plain',
    'application/x-ofx',
    'application/ofx'
  ]
)
ON CONFLICT (id) DO NOTHING;


-- 7) RLS
ALTER TABLE public.extratos_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extrato_transacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacoes_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regras_conciliacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacao_bank_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users mng extratos_import" ON public.extratos_import;
CREATE POLICY "Users mng extratos_import"
  ON public.extratos_import
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "Users mng extrato_transacoes" ON public.extrato_transacoes;
CREATE POLICY "Users mng extrato_transacoes"
  ON public.extrato_transacoes
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "Users mng conciliacoes" ON public.conciliacoes_bancarias;
CREATE POLICY "Users mng conciliacoes"
  ON public.conciliacoes_bancarias
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "Users mng regras" ON public.regras_conciliacao;
CREATE POLICY "Users mng regras"
  ON public.regras_conciliacao
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "Users mng idempotency" ON public.conciliacao_bank_idempotency;
CREATE POLICY "Users mng idempotency"
  ON public.conciliacao_bank_idempotency
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "Users can read bank statements files" ON storage.objects;
CREATE POLICY "Users can read bank statements files"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'extratos-bancarios'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can upload bank statements files" ON storage.objects;
CREATE POLICY "Users can upload bank statements files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'extratos-bancarios'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can update bank statements files" ON storage.objects;
CREATE POLICY "Users can update bank statements files"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'extratos-bancarios'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  )
  WITH CHECK (
    bucket_id = 'extratos-bancarios'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can delete bank statements files" ON storage.objects;
CREATE POLICY "Users can delete bank statements files"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'extratos-bancarios'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  );


-- ============================================
-- RPCs
-- ============================================

DROP FUNCTION IF EXISTS public.rpc_bank_recompute_account_balance(UUID);
CREATE OR REPLACE FUNCTION public.rpc_bank_recompute_account_balance(p_conta_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo_inicial NUMERIC := 0;
  v_saldo_base_ajustado NUMERIC;
  v_data_corte DATE;
  v_movimentacao NUMERIC := 0;
  v_novo_saldo NUMERIC := 0;
BEGIN
  SELECT
    COALESCE(c.saldo_inicial, 0),
    c.saldo_base_ajustado,
    c.data_corte_saldo
  INTO
    v_saldo_inicial,
    v_saldo_base_ajustado,
    v_data_corte
  FROM public.contas_bancarias c
  WHERE c.id = p_conta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta bancaria nao encontrada: %', p_conta_id;
  END IF;

  IF v_data_corte IS NOT NULL AND v_saldo_base_ajustado IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN l.tipo = 'entrada' THEN l.valor ELSE -l.valor END), 0)
      INTO v_movimentacao
    FROM public.lancamentos_caixa l
    WHERE l.conta_bancaria_id = p_conta_id
      AND l.data >= v_data_corte;

    v_novo_saldo := v_saldo_base_ajustado + v_movimentacao;
  ELSE
    SELECT COALESCE(SUM(CASE WHEN l.tipo = 'entrada' THEN l.valor ELSE -l.valor END), 0)
      INTO v_movimentacao
    FROM public.lancamentos_caixa l
    WHERE l.conta_bancaria_id = p_conta_id;

    v_novo_saldo := v_saldo_inicial + v_movimentacao;
  END IF;

  UPDATE public.contas_bancarias
  SET
    saldo_atual = v_novo_saldo,
    updated_at = NOW()
  WHERE id = p_conta_id;

  RETURN v_novo_saldo;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_bank_create_lancamento_and_reconcile(JSONB);
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

  INSERT INTO public.conciliacoes_bancarias (
    empresa_id,
    extrato_transacao_id,
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

DROP FUNCTION IF EXISTS public.rpc_bank_confirm_reconciliation(JSONB);
CREATE OR REPLACE FUNCTION public.rpc_bank_confirm_reconciliation(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conciliacao_id UUID := (payload->>'conciliacao_id')::UUID;
  v_explanation TEXT := NULLIF(payload->>'explanation', '');
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_conciliacao_id IS NULL THEN
    RAISE EXCEPTION 'conciliacao_id obrigatorio';
  END IF;

  UPDATE public.conciliacoes_bancarias cb
  SET
    status = 'confirmed',
    explanation = COALESCE(v_explanation, cb.explanation),
    confirmed_by = v_user_id,
    confirmed_at = NOW(),
    updated_at = NOW()
  WHERE cb.id = v_conciliacao_id
    AND cb.empresa_id = public.get_user_empresa_id()
  RETURNING to_jsonb(cb.*)
  INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Conciliacao nao encontrada para a empresa';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_bank_recompute_account_balance(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_create_lancamento_and_reconcile(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_bank_confirm_reconciliation(JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_bank_recompute_account_balance(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_create_lancamento_and_reconcile(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_bank_confirm_reconciliation(JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_bank_recompute_account_balance(UUID)
  IS 'Recalcula saldo_atual de conta considerando saldo_inicial ou data_corte_saldo/saldo_base_ajustado.';

COMMENT ON FUNCTION public.rpc_bank_create_lancamento_and_reconcile(JSONB)
  IS 'Cria lancamento_caixa, confirma conciliacao bancaria e recalcula saldo da conta com idempotencia.';

COMMENT ON FUNCTION public.rpc_bank_confirm_reconciliation(JSONB)
  IS 'Confirma conciliacao sugerida para a empresa autenticada.';
