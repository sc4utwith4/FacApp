-- ============================================
-- BANK RECONCILIATION HOTFIX (Phase 2)
-- ============================================

-- 1) Audit log compatibility
ALTER TABLE IF EXISTS public.bank_reconciliation_audit_log
  ADD COLUMN IF NOT EXISTS conciliacao_id UUID REFERENCES public.conciliacoes_bancarias(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_audit_conciliacao_created
  ON public.bank_reconciliation_audit_log (conciliacao_id, created_at DESC);

-- 2) RLS/policies/trigger rerunnable hardening
ALTER TABLE IF EXISTS public.bank_reconciliation_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view audit logs" ON public.bank_reconciliation_audit_log;
DROP POLICY IF EXISTS "Users insert audit logs" ON public.bank_reconciliation_audit_log;
DROP POLICY IF EXISTS "Users mng bank_reconciliation_audit_log" ON public.bank_reconciliation_audit_log;
CREATE POLICY "Users mng bank_reconciliation_audit_log"
  ON public.bank_reconciliation_audit_log
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

ALTER TABLE IF EXISTS public.bank_ai_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users mng ai suggestions" ON public.bank_ai_suggestions;
DROP POLICY IF EXISTS "Users mng bank_ai_suggestions" ON public.bank_ai_suggestions;
CREATE POLICY "Users mng bank_ai_suggestions"
  ON public.bank_ai_suggestions
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP TRIGGER IF EXISTS update_bank_ai_suggestions_updated_at ON public.bank_ai_suggestions;
CREATE TRIGGER update_bank_ai_suggestions_updated_at
  BEFORE UPDATE ON public.bank_ai_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3) Split RPC contract + constraints hotfix
DROP FUNCTION IF EXISTS public.rpc_bank_split_reconciliation(JSONB);
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
  v_conciliacao_id UUID;
  v_lancamento_ids UUID[] := '{}';
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

    IF v_first_lancamento_id IS NULL THEN
      v_first_lancamento_id := v_lancamento_id;
    END IF;

    v_lancamento_ids := array_append(v_lancamento_ids, v_lancamento_id);

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

REVOKE ALL ON FUNCTION public.rpc_bank_split_reconciliation(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_bank_split_reconciliation(JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_bank_split_reconciliation(JSONB)
  IS 'Aplica split 1 extrato para N lancamentos em transacao unica com validacao de soma exata, idempotencia e compatibilidade items/splits.';
