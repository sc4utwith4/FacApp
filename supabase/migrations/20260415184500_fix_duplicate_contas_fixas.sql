-- =============================================
-- FIX: Evitar duplicação de lançamentos ao editar Contas Fixas
-- =============================================

-- 1. Atualizar calcular_next_event para ser mais resiliente
CREATE OR REPLACE FUNCTION public.calculate_next_event(
    p_periodicidade TEXT,
    p_dia_ref SMALLINT,
    p_weekday_ref SMALLINT,
    p_referencia DATE
) RETURNS DATE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_base DATE := COALESCE(p_referencia, CURRENT_DATE);
    v_result DATE;
    v_month_start DATE;
    v_days_in_month INTEGER;
    v_offset INTEGER;
BEGIN
    IF p_periodicidade = 'semanal' THEN
        IF p_weekday_ref IS NULL THEN
            RETURN v_base + INTERVAL '7 days';
        END IF;
        v_offset := ((p_weekday_ref + 7 - EXTRACT(DOW FROM v_base)::INT) % 7);
        IF v_offset = 0 THEN
            v_offset := 7;
        END IF;
        RETURN (v_base + (v_offset || ' days')::INTERVAL)::DATE;
    ELSIF p_periodicidade = 'quinzenal' THEN
        RETURN (v_base + INTERVAL '15 days')::DATE;
    ELSIF p_periodicidade = 'anual' THEN
        v_month_start := make_date(EXTRACT(YEAR FROM v_base)::INT, EXTRACT(MONTH FROM v_base)::INT, 1);
        -- Se já passou do dia de referência no mês atual, pula para o próximo ano
        IF v_base >= v_month_start + (GREATEST(1, COALESCE(p_dia_ref, 1) - 1)) THEN
            v_month_start := (v_month_start + INTERVAL '1 year')::DATE;
        END IF;
        v_days_in_month := EXTRACT(DAY FROM (date_trunc('month', v_month_start) + INTERVAL '1 month - 1 day'))::INT;
        RETURN date_trunc('month', v_month_start)::DATE + (LEAST(GREATEST(1, COALESCE(p_dia_ref, 1)), v_days_in_month) - 1);
    ELSE -- MENSAL
        -- Se dermos uma data que é o último dia do mês anterior, ele deve retornar o dia_ref do mês atual
        v_month_start := date_trunc('month', v_base + INTERVAL '1 day')::DATE;
        
        -- Se a base já é no mês atual e já passou do dia_ref, pula para o próximo mês
        IF v_base >= v_month_start + (GREATEST(1, COALESCE(p_dia_ref, 1) - 1)) THEN
            v_month_start := (v_month_start + INTERVAL '1 month')::DATE;
        END IF;
        
        v_days_in_month := EXTRACT(DAY FROM (date_trunc('month', v_month_start) + INTERVAL '1 month - 1 day'))::INT;
        RETURN date_trunc('month', v_month_start)::DATE + (LEAST(GREATEST(1, COALESCE(p_dia_ref, 1)), v_days_in_month) - 1);
    END IF;
END;
$$;

-- 2. Atualizar atualizar_conta_fixa para SINCRONIZAR DATAS
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
    v_old RECORD;
    v_rule_changed BOOLEAN := FALSE;
BEGIN
    p_proximo_evento := NULLIF(TRIM(p_proximo_evento), '');

    -- Captura estado atual para detectar mudanças de regra
    SELECT * INTO v_old
    FROM public.contas_fixas
    WHERE public.contas_fixas.id = p_id
      AND public.contas_fixas.empresa_id = v_empresa;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta fixa não encontrada ou sem permissão.';
    END IF;

    IF p_proximo_evento IS NOT NULL THEN
        v_proximo_evento_date := public.normalize_date_string(p_proximo_evento);
    END IF;

    -- Verifica se a regra de recorrência mudou
    IF (p_dia_ref IS NOT NULL AND p_dia_ref <> v_old.dia_ref) OR
       (p_periodicidade IS NOT NULL AND p_periodicidade <> v_old.periodicidade) OR
       (p_weekday_ref IS NOT NULL AND p_weekday_ref IS DISTINCT FROM v_old.weekday_ref) THEN
        v_rule_changed := TRUE;
    END IF;

    -- Atualiza a conta fixa
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

    -- Sincroniza os previstos PENDENTES
    -- Se a regra mudou, recalculamos o vencimento com base na nova regra e na competência atual
    UPDATE public.lancamentos_previstos AS lp
    SET
        conta_bancaria_id = v_result.conta_bancaria_id,
        grupo_contas_id = v_result.grupo_contas_id,
        historico = v_result.descricao,
        observacoes = v_result.observacoes,
        valor = v_result.valor,
        tipo = v_result.natureza,
        vencimento = CASE 
            WHEN v_rule_changed THEN 
                public.calculate_next_event(
                    v_result.periodicidade, 
                    v_result.dia_ref, 
                    v_result.weekday_ref, 
                    (TO_DATE(lp.competencia || '-01', 'YYYY-MM-DD') - INTERVAL '1 day')::DATE
                )
            ELSE lp.vencimento
        END,
        competencia = CASE 
            WHEN v_rule_changed THEN 
                to_char(
                    public.calculate_next_event(
                        v_result.periodicidade, 
                        v_result.dia_ref, 
                        v_result.weekday_ref, 
                        (TO_DATE(lp.competencia || '-01', 'YYYY-MM-DD') - INTERVAL '1 day')::DATE
                    ), 
                    'YYYY-MM'
                )
            ELSE lp.competencia
        END,
        updated_at = NOW()
    WHERE lp.fixa_id = v_result.id
      AND lp.empresa_id = v_result.empresa_id
      AND lp.status <> 'pago'
      AND lp.vencimento >= CURRENT_DATE;

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

-- 3. Atualizar gerar_previstos_mes para ser IDEMPOTENTE por competência (para mensal)
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
    v_existente_id BIGINT;
BEGIN
    FOR v_conta IN
        SELECT *
        FROM public.contas_fixas
        WHERE empresa_id = v_empresa
          AND ativo = TRUE
    LOOP
        v_evento := v_conta.proximo_evento;

        -- Alinha o evento inicial ao início do período selecionado
        WHILE v_evento < v_inicio LOOP
            v_evento := public.calculate_next_event(v_conta.periodicidade, v_conta.dia_ref, v_conta.weekday_ref, v_evento);
        END LOOP;

        WHILE v_evento IS NOT NULL AND v_evento <= v_fim LOOP
            -- Tenta encontrar um lançamento pendente já existente para esta competência
            -- Se for mensal, deve haver apenas 1 p/ competência.
            SELECT id INTO v_existente_id
            FROM public.lancamentos_previstos
            WHERE empresa_id = v_empresa
              AND fixa_id = v_conta.id
              AND competencia = to_char(v_evento, 'YYYY-MM')
              AND status <> 'pago'
            LIMIT 1;

            IF v_existente_id IS NOT NULL THEN
                -- Atualiza o existente (move a data se necessário)
                UPDATE public.lancamentos_previstos
                SET vencimento = v_evento,
                    valor = v_conta.valor,
                    historico = v_conta.descricao,
                    conta_bancaria_id = v_conta.conta_bancaria_id,
                    grupo_contas_id = v_conta.grupo_contas_id,
                    updated_at = NOW()
                WHERE id = v_existente_id;
            ELSE
                -- Insere novo se realmente não existir conflito de data única
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
            v_evento := public.calculate_next_event(v_conta.periodicidade, v_conta.dia_ref, v_conta.weekday_ref, v_evento);
        END LOOP;

        UPDATE public.contas_fixas
        SET proximo_evento = v_evento,
            updated_at = NOW()
        WHERE id = v_conta.id;
    END LOOP;

    RETURN v_count;
END;
$$;
