-- ============================================
-- CONCILIAÇÃO BANCÁRIA: FASE 2 (IA + Split + Auditoria)
-- ============================================

-- 1) Tabela de Auditoria Operacional (Logs detalhados)
CREATE TABLE IF NOT EXISTS public.bank_reconciliation_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  extrato_import_id UUID REFERENCES public.extratos_import(id) ON DELETE SET NULL,
  extrato_transacao_id UUID REFERENCES public.extrato_transacoes(id) ON DELETE SET NULL,
  
  action TEXT NOT NULL, -- ex: 'ai_pending_requested', 'ai_suggestion_created', 'match_confirmed'
  status TEXT NOT NULL DEFAULT 'info' CHECK (status IN ('info', 'success', 'warning', 'error')),
  message TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_audit_empresa_created 
  ON public.bank_reconciliation_audit_log(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_audit_import 
  ON public.bank_reconciliation_audit_log(extrato_import_id);

-- RLS Auditoria
ALTER TABLE public.bank_reconciliation_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view audit logs" ON public.bank_reconciliation_audit_log;
CREATE POLICY "Users view audit logs" ON public.bank_reconciliation_audit_log
  FOR SELECT USING (empresa_id = public.get_user_empresa_id());
DROP POLICY IF EXISTS "Users insert audit logs" ON public.bank_reconciliation_audit_log;
CREATE POLICY "Users insert audit logs" ON public.bank_reconciliation_audit_log
  FOR INSERT WITH CHECK (empresa_id = public.get_user_empresa_id());


-- 2) Tabela de Sugestões de IA (Staging Area)
CREATE TABLE IF NOT EXISTS public.bank_ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  extrato_transacao_id UUID NOT NULL REFERENCES public.extrato_transacoes(id) ON DELETE CASCADE,
  
  suggestion_action TEXT NOT NULL CHECK (suggestion_action IN ('match_existing', 'create_new', 'ignore', 'needs_review')),
  confidence NUMERIC(5,4), -- 0.0000 a 1.0000
  
  -- Se match_existing
  lancamento_caixa_id UUID REFERENCES public.lancamentos_caixa(id) ON DELETE SET NULL,
  
  -- Se create_new
  proposed_lancamento JSONB, -- Payload sugerido para criação
  
  explanation TEXT,
  warnings TEXT[], -- Array de strings com alertas
  
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'rejected', 'applied')),
  source TEXT DEFAULT 'n8n_ai',
  
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Se null, foi sistema/n8n
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_ai_suggestions_empresa_status 
  ON public.bank_ai_suggestions(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_bank_ai_suggestions_transacao 
  ON public.bank_ai_suggestions(extrato_transacao_id);

-- Trigger updated_at para sugestões
DROP TRIGGER IF EXISTS update_bank_ai_suggestions_updated_at ON public.bank_ai_suggestions;
CREATE TRIGGER update_bank_ai_suggestions_updated_at
  BEFORE UPDATE ON public.bank_ai_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Sugestões
ALTER TABLE public.bank_ai_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users mng ai suggestions" ON public.bank_ai_suggestions;
CREATE POLICY "Users mng ai suggestions" ON public.bank_ai_suggestions
  FOR ALL USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());


-- 3) RPC: Split Reconciliation (Dividir 1 transação em N lançamentos)
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
  v_splits JSONB := payload->'splits'; -- Array de objetos de lancamento
  
  v_tx_valor_centavos BIGINT;
  v_tx_tipo TEXT;
  v_soma_splits BIGINT := 0;
  v_split_item JSONB;
  v_lancamento_id UUID;
  v_conciliacao_id UUID;
  v_novo_saldo NUMERIC;
  v_result JSONB;
  v_existing JSONB;
  v_ids_criados UUID[] := ARRAY[]::UUID[];
BEGIN
  -- Validações Básicas
  IF v_empresa_id IS NULL OR v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado ou empresa invalida';
  END IF;

  IF v_extrato_tx_id IS NULL OR v_idempotency_key IS NULL OR v_splits IS NULL OR jsonb_array_length(v_splits) = 0 THEN
    RAISE EXCEPTION 'Parametros obrigatorios invalidos (tx_id, idempotency, splits)';
  END IF;

  -- Checa Idempotência Global
  SELECT resultado_json INTO v_existing
  FROM public.conciliacao_bank_idempotency
  WHERE empresa_id = v_empresa_id AND idempotency_key = v_idempotency_key;
  
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Busca transação original para validar valor total
  SELECT valor_centavos, tipo INTO v_tx_valor_centavos, v_tx_tipo
  FROM public.extrato_transacoes
  WHERE id = v_extrato_tx_id AND empresa_id = v_empresa_id AND conta_bancaria_id = v_conta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transacao de extrato nao encontrada ou nao pertence a conta';
  END IF;

  -- Valida soma dos splits
  FOR v_split_item IN SELECT * FROM jsonb_array_elements(v_splits)
  LOOP
    v_soma_splits := v_soma_splits + (COALESCE((v_split_item->>'valor_centavos')::BIGINT, 0));
  END LOOP;

  IF v_soma_splits <> v_tx_valor_centavos THEN
    RAISE EXCEPTION 'Soma dos splits (% centavos) difere do valor da transacao (% centavos)', v_soma_splits, v_tx_valor_centavos;
  END IF;

  -- Loop de criação e conciliação
  FOR v_split_item IN SELECT * FROM jsonb_array_elements(v_splits)
  LOOP
    -- Criar Lançamento
    INSERT INTO public.lancamentos_caixa (
      empresa_id,
      conta_bancaria_id,
      grupo_contas_id,
      data,
      historico,
      tipo, -- 'entrada' ou 'saida', deve bater com extrato se for regra estrita, mas aqui flexibilizamos ou validamos antes?
            -- Assumindo que o front envia o tipo correto
      valor,
      documento,
      observacoes,
      created_by
    ) VALUES (
      v_empresa_id,
      v_conta_id,
      NULLIF(v_split_item->>'grupo_contas_id', '')::UUID,
      (v_split_item->>'data')::DATE,
      v_split_item->>'historico',
      v_split_item->>'tipo',
      (v_split_item->>'valor')::NUMERIC,
      v_split_item->>'documento',
      v_split_item->>'observacoes',
      v_user_id
    ) RETURNING id INTO v_lancamento_id;

    v_ids_criados := array_append(v_ids_criados, v_lancamento_id);

    -- Criar Conciliação (Vincula este lançamento à MESMA transação de extrato)
    -- Nota: Unique index 'idx_conciliacoes_unique_pair' é (extrato_transacao_id, lancamento_caixa_id), então Ok ter varios lancamentos p/ 1 extrato_tx
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
      (COALESCE((v_split_item->>'valor_centavos')::BIGINT, 0)),
      'confirmed',
      1.0,
      'manual_split',
      'Conciliacao via split manual',
      v_user_id,
      NOW()
    );
  END LOOP;

  -- Recalcula saldo
  v_novo_saldo := public.rpc_bank_recompute_account_balance(v_conta_id);

  v_result := jsonb_build_object(
    'ok', true,
    'lancamentos_ids', v_ids_criados,
    'novo_saldo', v_novo_saldo,
    'message', 'Split realizado com sucesso'
  );

  -- Grava Idempotência
  INSERT INTO public.conciliacao_bank_idempotency (
    empresa_id, idempotency_key, resultado_json
  ) VALUES (
    v_empresa_id, v_idempotency_key, v_result
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Em caso de erro, rollback automático do PG acontece, mas auditoria de erro pode ser útil se fosse fora da tx
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_bank_split_reconciliation(JSONB) TO authenticated, service_role;
COMMENT ON FUNCTION public.rpc_bank_split_reconciliation(JSONB) IS 'Cria multiplos lancamentos e concilia com uma unica transacao de extrato (Split), validando soma.';
