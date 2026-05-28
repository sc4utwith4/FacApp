-- Atualiza função que marca previstos como pagos para inserir lançamento no caixa
CREATE OR REPLACE FUNCTION public.marcar_previsto_pago(
    p_previsto_id BIGINT,
    p_data_pagamento DATE DEFAULT CURRENT_DATE,
    p_observacoes TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_empresa UUID := get_user_empresa_id();
    v_previsto public.lancamentos_previstos%ROWTYPE;
    v_pagamento DATE := COALESCE(p_data_pagamento, CURRENT_DATE);
    v_historico TEXT;
    v_lancamento_id UUID;
BEGIN
    SELECT *
    INTO v_previsto
    FROM public.lancamentos_previstos
    WHERE id = p_previsto_id
      AND empresa_id = v_empresa
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lançamento previsto não encontrado ou sem permissão.';
    END IF;

    IF v_previsto.status = 'pago' AND v_previsto.lancamento_caixa_id IS NOT NULL THEN
        -- Atualizar data/observações se necessário
        UPDATE public.lancamentos_caixa
        SET data = v_pagamento,
            observacoes = COALESCE(p_observacoes, observacoes),
            updated_at = NOW()
        WHERE id = v_previsto.lancamento_caixa_id;

        UPDATE public.lancamentos_previstos
        SET pago_em = v_pagamento,
            observacoes = COALESCE(p_observacoes, observacoes),
            updated_at = NOW()
        WHERE id = p_previsto_id;

        RETURN p_previsto_id;
    END IF;

    SELECT COALESCE(v_previsto.historico, cf.descricao, 'Lançamento previsto liquidado')
    INTO v_historico
    FROM public.contas_fixas cf
    WHERE cf.id = v_previsto.fixa_id;

    IF v_previsto.lancamento_caixa_id IS NULL THEN
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
        )
        VALUES (
            v_previsto.empresa_id,
            v_previsto.conta_bancaria_id,
            v_previsto.grupo_contas_id,
            v_pagamento,
            v_historico,
            v_previsto.tipo,
            v_previsto.valor,
            NULL,
            p_observacoes
        )
        RETURNING id INTO v_lancamento_id;
    ELSE
        UPDATE public.lancamentos_caixa
        SET data = v_pagamento,
            conta_bancaria_id = v_previsto.conta_bancaria_id,
            grupo_contas_id = v_previsto.grupo_contas_id,
            historico = v_historico,
            tipo = v_previsto.tipo,
            valor = v_previsto.valor,
            observacoes = COALESCE(p_observacoes, observacoes),
            updated_at = NOW()
        WHERE id = v_previsto.lancamento_caixa_id
        RETURNING id INTO v_lancamento_id;
    END IF;

    UPDATE public.lancamentos_previstos
    SET status = 'pago',
        pago_em = v_pagamento,
        observacoes = COALESCE(p_observacoes, observacoes),
        lancamento_caixa_id = v_lancamento_id,
        updated_at = NOW()
    WHERE id = p_previsto_id;

    RETURN p_previsto_id;
END;
$$;

