-- ============================================
-- Correção da função gerar_previstos_mes
-- Adiciona proteção contra loops infinitos e timeout
-- ============================================

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
    v_iterations INTEGER;
    v_max_iterations INTEGER := 1000; -- Proteção contra loop infinito
BEGIN
    -- Validar parâmetros
    IF v_empresa IS NULL THEN
        RAISE EXCEPTION 'Empresa ID não pode ser nulo';
    END IF;

    FOR v_conta IN
        SELECT *
        FROM public.contas_fixas
        WHERE empresa_id = v_empresa
          AND ativo = TRUE
          AND proximo_evento IS NOT NULL
    LOOP
        v_evento := v_conta.proximo_evento;
        v_iterations := 0;

        -- Alinha o evento inicial ao início do período selecionado
        -- Proteção contra loop infinito
        WHILE v_evento < v_inicio AND v_iterations < v_max_iterations LOOP
            v_prev_evento := v_evento;
            v_evento := public.calculate_next_event(v_conta.periodicidade, v_conta.dia_ref, v_conta.weekday_ref, v_evento);
            
            -- Se o evento não mudou ou é NULL, sair do loop
            IF v_evento IS NULL OR v_evento = v_prev_evento THEN
                EXIT;
            END IF;
            
            v_iterations := v_iterations + 1;
        END LOOP;

        -- Se excedeu o limite de iterações, pular esta conta
        IF v_iterations >= v_max_iterations THEN
            CONTINUE;
        END IF;

        -- Se o evento está fora do período, pular
        IF v_evento IS NULL OR v_evento > v_fim THEN
            CONTINUE;
        END IF;

        v_iterations := 0;
        -- Gera eventos dentro do período
        WHILE v_evento IS NOT NULL AND v_evento <= v_fim AND v_iterations < v_max_iterations LOOP
            INSERT INTO public.lancamentos_previstos (
                empresa_id,
                fixa_id,
                competencia,
                vencimento,
                tipo,
                valor,
                status,
                conta_bancaria_id,
                grupo_contas_id,
                historico,
                observacoes
            )
            VALUES (
                v_empresa,
                v_conta.id,
                to_char(v_evento, 'YYYY-MM'),
                v_evento,
                v_conta.natureza,
                v_conta.valor,
                'previsto',
                v_conta.conta_bancaria_id,
                v_conta.grupo_contas_id,
                v_conta.descricao,
                v_conta.observacoes
            )
            ON CONFLICT (empresa_id, fixa_id, vencimento) DO NOTHING;

            v_count := v_count + 1;
            v_prev_evento := v_evento;
            v_evento := public.calculate_next_event(v_conta.periodicidade, v_conta.dia_ref, v_conta.weekday_ref, v_evento);
            
            -- Se o evento não mudou ou é NULL, sair do loop
            IF v_evento IS NULL OR v_evento = v_prev_evento THEN
                EXIT;
            END IF;
            
            v_iterations := v_iterations + 1;
        END LOOP;

        -- Atualiza o próximo evento apenas se não excedeu o limite
        IF v_iterations < v_max_iterations AND v_evento IS NOT NULL THEN
            UPDATE public.contas_fixas
            SET proximo_evento = v_evento,
                updated_at = NOW()
            WHERE id = v_conta.id;
        END IF;
    END LOOP;

    RETURN v_count;
EXCEPTION
    WHEN OTHERS THEN
        -- Log do erro e retorna 0
        RAISE WARNING 'Erro ao gerar previstos: %', SQLERRM;
        RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_previstos_mes(UUID, TEXT) TO authenticated;

