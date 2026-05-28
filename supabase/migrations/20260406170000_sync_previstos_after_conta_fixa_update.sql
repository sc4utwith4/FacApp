-- ============================================
-- Sincroniza lancamentos_previstos ao editar contas_fixas
-- ============================================

CREATE OR REPLACE FUNCTION public.atualizar_conta_fixa(
    p_id BIGINT,
    p_descricao TEXT DEFAULT NULL,
    p_natureza TEXT DEFAULT NULL,
    p_grupo_contas_id UUID DEFAULT NULL,
    p_conta_bancaria_id UUID DEFAULT NULL,
    p_periodicidade TEXT DEFAULT NULL,
    p_dia_ref SMALLINT DEFAULT NULL,
    p_weekday_ref SMALLINT DEFAULT NULL,
    p_valor NUMERIC DEFAULT NULL,
    p_ativo BOOLEAN DEFAULT NULL,
    p_proximo_evento TEXT DEFAULT NULL,
    p_tolerancia_dias SMALLINT DEFAULT NULL,
    p_observacoes TEXT DEFAULT NULL
) RETURNS TABLE (
    id BIGINT,
    empresa_id UUID,
    descricao TEXT,
    natureza TEXT,
    grupo_contas_id UUID,
    conta_bancaria_id UUID,
    periodicidade TEXT,
    dia_ref SMALLINT,
    weekday_ref SMALLINT,
    valor NUMERIC,
    ativo BOOLEAN,
    proximo_evento DATE,
    tolerancia_dias SMALLINT,
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_empresa UUID := get_user_empresa_id();
    v_proximo_evento_date DATE;
    v_result RECORD;
BEGIN
    p_proximo_evento := NULLIF(TRIM(p_proximo_evento), '');

    IF NOT EXISTS (
        SELECT 1
        FROM public.contas_fixas AS cf
        WHERE cf.id = p_id
          AND cf.empresa_id = v_empresa
    ) THEN
        RAISE EXCEPTION 'Conta fixa não encontrada ou sem permissão.';
    END IF;

    IF p_proximo_evento IS NOT NULL THEN
        v_proximo_evento_date := public.normalize_date_string(p_proximo_evento);
    END IF;

    UPDATE public.contas_fixas AS cf
    SET
        descricao = COALESCE(p_descricao, cf.descricao),
        natureza = COALESCE(p_natureza, cf.natureza),
        grupo_contas_id = COALESCE(p_grupo_contas_id, cf.grupo_contas_id),
        conta_bancaria_id = COALESCE(p_conta_bancaria_id, cf.conta_bancaria_id),
        periodicidade = COALESCE(p_periodicidade, cf.periodicidade),
        dia_ref = COALESCE(p_dia_ref, cf.dia_ref),
        weekday_ref = COALESCE(p_weekday_ref, cf.weekday_ref),
        valor = COALESCE(p_valor, cf.valor),
        ativo = COALESCE(p_ativo, cf.ativo),
        proximo_evento = COALESCE(v_proximo_evento_date, cf.proximo_evento),
        tolerancia_dias = COALESCE(p_tolerancia_dias, cf.tolerancia_dias),
        observacoes = COALESCE(p_observacoes, cf.observacoes),
        updated_at = NOW()
    WHERE cf.id = p_id
      AND cf.empresa_id = v_empresa
    RETURNING cf.* INTO v_result;

    UPDATE public.lancamentos_previstos AS lp
    SET
        conta_bancaria_id = v_result.conta_bancaria_id,
        grupo_contas_id = v_result.grupo_contas_id,
        historico = v_result.descricao,
        observacoes = v_result.observacoes,
        valor = v_result.valor,
        tipo = v_result.natureza,
        updated_at = NOW()
    WHERE lp.fixa_id = v_result.id
      AND lp.empresa_id = v_result.empresa_id
      AND lp.status <> 'pago'
      AND lp.vencimento >= CURRENT_DATE
      AND (
        lp.conta_bancaria_id IS DISTINCT FROM v_result.conta_bancaria_id
        OR lp.grupo_contas_id IS DISTINCT FROM v_result.grupo_contas_id
        OR lp.historico IS DISTINCT FROM v_result.descricao
        OR lp.observacoes IS DISTINCT FROM v_result.observacoes
        OR lp.valor IS DISTINCT FROM v_result.valor
        OR lp.tipo IS DISTINCT FROM v_result.natureza
      );

    RETURN QUERY SELECT
        v_result.id,
        v_result.empresa_id,
        v_result.descricao,
        v_result.natureza,
        v_result.grupo_contas_id,
        v_result.conta_bancaria_id,
        v_result.periodicidade,
        v_result.dia_ref,
        v_result.weekday_ref,
        v_result.valor,
        v_result.ativo,
        v_result.proximo_evento,
        v_result.tolerancia_dias,
        v_result.observacoes,
        v_result.created_at,
        v_result.updated_at;
END;
$$;

UPDATE public.lancamentos_previstos AS lp
SET
    conta_bancaria_id = cf.conta_bancaria_id,
    grupo_contas_id = cf.grupo_contas_id,
    historico = cf.descricao,
    observacoes = cf.observacoes,
    valor = cf.valor,
    tipo = cf.natureza,
    updated_at = NOW()
FROM public.contas_fixas AS cf
WHERE lp.fixa_id = cf.id
  AND lp.empresa_id = cf.empresa_id
  AND lp.status <> 'pago'
  AND lp.vencimento >= CURRENT_DATE
  AND (
    lp.conta_bancaria_id IS DISTINCT FROM cf.conta_bancaria_id
    OR lp.grupo_contas_id IS DISTINCT FROM cf.grupo_contas_id
    OR lp.historico IS DISTINCT FROM cf.descricao
    OR lp.observacoes IS DISTINCT FROM cf.observacoes
    OR lp.valor IS DISTINCT FROM cf.valor
    OR lp.tipo IS DISTINCT FROM cf.natureza
  );

GRANT EXECUTE ON FUNCTION public.atualizar_conta_fixa(
    BIGINT, TEXT, TEXT, UUID, UUID, TEXT, SMALLINT, SMALLINT, NUMERIC, BOOLEAN, TEXT, SMALLINT, TEXT
) TO authenticated;
