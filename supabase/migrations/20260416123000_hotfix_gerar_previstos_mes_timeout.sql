-- ============================================
-- Hotfix: evitar 500 por statement timeout em gerar_previstos_mes
-- - Proteção anti-loop
-- - Evita esperar locks em contas_fixas (SKIP LOCKED)
-- - Índice para lookup por competência (idempotência)
-- ============================================

-- Índice para acelerar lookup do idempotente por competência
-- (usado por gerar_previstos_mes ao procurar um previsto pendente existente)
CREATE INDEX IF NOT EXISTS lancamentos_previstos_empresa_fixa_competencia_nao_pago_idx
ON public.lancamentos_previstos (empresa_id, fixa_id, competencia)
WHERE status <> 'pago';

CREATE OR REPLACE FUNCTION public.gerar_previstos_mes(
    p_empresa_id UUID DEFAULT NULL,
    p_competencia TEXT DEFAULT to_char(CURRENT_DATE, 'YYYY-MM')
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_empresa UUID := COALESCE(p_empresa_id, get_user_empresa_id());
    v_inicio DATE := TO_DATE(p_competencia || '-01', 'YYYY-MM-DD');
    v_fim DATE := (v_inicio + INTERVAL '1 month - 1 day')::DATE;
    v_count INTEGER := 0;
    v_conta RECORD;
    v_evento DATE;
    v_prev_evento DATE;
    v_existente_id BIGINT;
    v_iterations INTEGER;
    v_max_iterations INTEGER := 4000;
BEGIN
    IF v_empresa IS NULL THEN
        RAISE EXCEPTION 'Empresa ID não pode ser nulo';
    END IF;

    FOR v_conta IN
        SELECT *
        FROM public.contas_fixas
        WHERE empresa_id = v_empresa
          AND ativo = TRUE
          AND proximo_evento IS NOT NULL
        FOR UPDATE SKIP LOCKED
    LOOP
        v_evento := v_conta.proximo_evento;
        v_iterations := 0;

        -- Alinha o evento inicial ao início do período selecionado
        WHILE v_evento < v_inicio AND v_iterations < v_max_iterations LOOP
            v_prev_evento := v_evento;
            v_evento := public.calculate_next_event(v_conta.periodicidade, v_conta.dia_ref, v_conta.weekday_ref, v_evento);

            IF v_evento IS NULL OR v_evento = v_prev_evento THEN
                EXIT;
            END IF;

            v_iterations := v_iterations + 1;
        END LOOP;

        -- Se excedeu o limite de iterações, pular esta conta para evitar timeout
        IF v_iterations >= v_max_iterations THEN
            RAISE WARNING '[gerar_previstos_mes] Max iterations atingido ao alinhar. empresa=%, conta_fixa_id=%, proximo_evento=%',
              v_empresa, v_conta.id, v_conta.proximo_evento;
            CONTINUE;
        END IF;

        -- Se o evento está fora do período, ainda assim tentamos atualizar o proximo_evento só se v_evento não for nulo.
        IF v_evento IS NULL OR v_evento > v_fim THEN
            IF v_evento IS NOT NULL AND v_evento IS DISTINCT FROM v_conta.proximo_evento THEN
                UPDATE public.contas_fixas
                SET proximo_evento = v_evento,
                    updated_at = NOW()
                WHERE id = v_conta.id;
            END IF;
            CONTINUE;
        END IF;

        v_iterations := 0;
        WHILE v_evento IS NOT NULL AND v_evento <= v_fim AND v_iterations < v_max_iterations LOOP
            v_existente_id := NULL;

            -- Idempotência por competência: preferir atualizar previsto pendente existente
            SELECT id INTO v_existente_id
            FROM public.lancamentos_previstos
            WHERE empresa_id = v_empresa
              AND fixa_id = v_conta.id
              AND competencia = to_char(v_evento, 'YYYY-MM')
              AND status <> 'pago'
            LIMIT 1;

            IF v_existente_id IS NOT NULL THEN
                UPDATE public.lancamentos_previstos
                SET vencimento = v_evento,
                    valor = v_conta.valor,
                    historico = v_conta.descricao,
                    conta_bancaria_id = v_conta.conta_bancaria_id,
                    grupo_contas_id = v_conta.grupo_contas_id,
                    updated_at = NOW()
                WHERE id = v_existente_id;
            ELSE
                INSERT INTO public.lancamentos_previstos (
                    empresa_id, fixa_id, competencia, vencimento, tipo, valor, status,
                    conta_bancaria_id, grupo_contas_id, historico, observacoes
                )
                VALUES (
                    v_empresa, v_conta.id, to_char(v_evento, 'YYYY-MM'), v_evento, v_conta.natureza, v_conta.valor, 'previsto',
                    v_conta.conta_bancaria_id, v_conta.grupo_contas_id, v_conta.descricao, v_conta.observacoes
                )
                ON CONFLICT (empresa_id, fixa_id, vencimento) DO UPDATE SET
                    valor = EXCLUDED.valor,
                    historico = EXCLUDED.historico,
                    updated_at = NOW()
                WHERE lancamentos_previstos.status <> 'pago';
            END IF;

            v_count := v_count + 1;
            v_prev_evento := v_evento;
            v_evento := public.calculate_next_event(v_conta.periodicidade, v_conta.dia_ref, v_conta.weekday_ref, v_evento);

            IF v_evento IS NULL OR v_evento = v_prev_evento THEN
                EXIT;
            END IF;

            v_iterations := v_iterations + 1;
        END LOOP;

        IF v_iterations >= v_max_iterations THEN
            RAISE WARNING '[gerar_previstos_mes] Max iterations atingido ao gerar. empresa=%, conta_fixa_id=%, competencia=%',
              v_empresa, v_conta.id, p_competencia;
            CONTINUE;
        END IF;

        -- Atualiza o próximo evento (somente quando for válido)
        IF v_evento IS NOT NULL THEN
            UPDATE public.contas_fixas
            SET proximo_evento = v_evento,
                updated_at = NOW()
            WHERE id = v_conta.id;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_previstos_mes(UUID, TEXT) TO authenticated;

