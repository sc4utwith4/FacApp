-- ============================================================
-- RPC: desfazer ignore justificado do extrato (undo)
-- ============================================================

DROP FUNCTION IF EXISTS public.rpc_bank_unignore_extrato(JSONB);
CREATE OR REPLACE FUNCTION public.rpc_bank_unignore_extrato(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_empresa_id UUID := COALESCE((payload->>'empresa_id')::UUID, public.get_user_empresa_id());
  v_resolucao_id UUID := (payload->>'conciliacao_id')::UUID;
  v_justificativa_undo TEXT := NULLIF(TRIM(payload->>'justificativa_undo'), '');
  v_resolucao RECORD;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio';
  END IF;

  IF v_empresa_id <> public.get_user_empresa_id() THEN
    RAISE EXCEPTION 'Acesso negado para empresa informada';
  END IF;

  IF v_resolucao_id IS NULL THEN
    RAISE EXCEPTION 'conciliacao_id obrigatorio para desfazer ignore';
  END IF;

  SELECT *
  INTO v_resolucao
  FROM public.conciliacao_extrato_resolucoes r
  WHERE r.id = v_resolucao_id
    AND r.empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolucao de extrato ignorado nao encontrada para a empresa';
  END IF;

  DELETE FROM public.conciliacao_extrato_resolucoes
  WHERE id = v_resolucao_id
    AND empresa_id = v_empresa_id;

  RETURN jsonb_build_object(
    'ok', true,
    'conciliacao_id', v_resolucao_id,
    'extrato_transacao_id', v_resolucao.extrato_transacao_id,
    'status', 'reopened',
    'justificativa_undo', v_justificativa_undo,
    'undone_by', v_user_id,
    'undone_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_bank_unignore_extrato(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_bank_unignore_extrato(JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_bank_unignore_extrato(JSONB) IS
  'Desfaz marcação de ignore justificado da transação de extrato para permitir nova decisão na revisão guiada.';
