-- ============================================
-- Criação de estrutura para Contas Fixas
-- ============================================

-- 1. TABELA contas_fixas
CREATE TABLE IF NOT EXISTS public.contas_fixas (
    id BIGSERIAL PRIMARY KEY,
    empresa_id UUID NOT NULL DEFAULT get_user_empresa_id(),
    descricao TEXT NOT NULL,
    natureza TEXT NOT NULL CHECK (natureza IN ('entrada', 'saida')),
    grupo_contas_id UUID NOT NULL REFERENCES public.grupos_contas(id) ON DELETE RESTRICT,
    conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE RESTRICT,
    periodicidade TEXT NOT NULL CHECK (periodicidade IN ('mensal', 'semanal', 'quinzenal', 'anual')),
    dia_ref SMALLINT DEFAULT 1 CHECK (dia_ref BETWEEN 1 AND 31),
    weekday_ref SMALLINT CHECK (weekday_ref BETWEEN 0 AND 6),
    valor NUMERIC(15,2) NOT NULL CHECK (valor >= 0),
    ativo BOOLEAN DEFAULT TRUE,
    proximo_evento DATE NOT NULL,
    tolerancia_dias SMALLINT DEFAULT 0 CHECK (tolerancia_dias >= 0),
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contas_fixas_empresa_idx ON public.contas_fixas(empresa_id);
CREATE INDEX IF NOT EXISTS contas_fixas_proximo_evento_idx ON public.contas_fixas(empresa_id, proximo_evento);

-- Trigger para manter updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_contas_fixas_updated_at'
    ) THEN
        CREATE TRIGGER update_contas_fixas_updated_at
        BEFORE UPDATE ON public.contas_fixas
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END;
$$;

-- Row Level Security
ALTER TABLE public.contas_fixas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contas_fixas' AND policyname = 'contas_fixas_select_policy'
    ) THEN
        CREATE POLICY contas_fixas_select_policy
        ON public.contas_fixas FOR SELECT
        USING (empresa_id = get_user_empresa_id());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contas_fixas' AND policyname = 'contas_fixas_modify_policy'
    ) THEN
        CREATE POLICY contas_fixas_modify_policy
        ON public.contas_fixas FOR ALL
        USING (empresa_id = get_user_empresa_id())
        WITH CHECK (empresa_id = get_user_empresa_id());
    END IF;
END;
$$;

-- 2. TABELA lancamentos_previstos
CREATE TABLE IF NOT EXISTS public.lancamentos_previstos (
    id BIGSERIAL PRIMARY KEY,
    empresa_id UUID NOT NULL DEFAULT get_user_empresa_id(),
    fixa_id BIGINT NOT NULL REFERENCES public.contas_fixas(id) ON DELETE CASCADE,
    competencia TEXT NOT NULL CHECK (competencia ~ '^\d{4}-\d{2}$'),
    vencimento DATE NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
    valor NUMERIC(15,2) NOT NULL CHECK (valor >= 0),
    status TEXT NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto', 'agendado', 'pago', 'atrasado')),
    conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE RESTRICT,
    grupo_contas_id UUID NOT NULL REFERENCES public.grupos_contas(id) ON DELETE RESTRICT,
    historico TEXT,
    pago_em DATE,
    lancamento_caixa_id UUID REFERENCES public.lancamentos_caixa(id) ON DELETE SET NULL,
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (empresa_id, fixa_id, vencimento)
);

CREATE INDEX IF NOT EXISTS lancamentos_previstos_empresa_idx ON public.lancamentos_previstos(empresa_id);
CREATE INDEX IF NOT EXISTS lancamentos_previstos_status_idx ON public.lancamentos_previstos(empresa_id, status, vencimento);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_lancamentos_previstos_updated_at'
    ) THEN
        CREATE TRIGGER update_lancamentos_previstos_updated_at
        BEFORE UPDATE ON public.lancamentos_previstos
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END;
$$;

ALTER TABLE public.lancamentos_previstos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lancamentos_previstos' AND policyname = 'lancamentos_previstos_select_policy'
    ) THEN
        CREATE POLICY lancamentos_previstos_select_policy
        ON public.lancamentos_previstos FOR SELECT
        USING (empresa_id = get_user_empresa_id());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lancamentos_previstos' AND policyname = 'lancamentos_previstos_modify_policy'
    ) THEN
        CREATE POLICY lancamentos_previstos_modify_policy
        ON public.lancamentos_previstos FOR ALL
        USING (empresa_id = get_user_empresa_id())
        WITH CHECK (empresa_id = get_user_empresa_id());
    END IF;
END;
$$;

-- 3. FUNÇÃO AUXILIAR PARA CALCULAR PRÓXIMO EVENTO
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
        IF v_base >= v_month_start + (GREATEST(1, COALESCE(p_dia_ref, 1) - 1)) THEN
            v_month_start := (v_month_start + INTERVAL '1 year')::DATE;
        END IF;
        v_days_in_month := EXTRACT(DAY FROM (date_trunc('month', v_month_start) + INTERVAL '1 month - 1 day'))::INT;
        RETURN date_trunc('month', v_month_start)::DATE + (LEAST(GREATEST(1, COALESCE(p_dia_ref, 1)), v_days_in_month) - 1);
    ELSE
        v_month_start := date_trunc('month', v_base)::DATE;
        IF v_base >= v_month_start + (GREATEST(1, COALESCE(p_dia_ref, 1) - 1)) THEN
            v_month_start := (v_month_start + INTERVAL '1 month')::DATE;
        END IF;
        v_days_in_month := EXTRACT(DAY FROM (date_trunc('month', v_month_start) + INTERVAL '1 month - 1 day'))::INT;
        RETURN date_trunc('month', v_month_start)::DATE + (LEAST(GREATEST(1, COALESCE(p_dia_ref, 1)), v_days_in_month) - 1);
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_next_event(TEXT, SMALLINT, SMALLINT, DATE) TO authenticated;

-- 4. FUNÇÃO PARA GERAR PREVISTOS DO MÊS
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

GRANT EXECUTE ON FUNCTION public.gerar_previstos_mes(UUID, TEXT) TO authenticated;

-- 5. FUNÇÃO PARA MARCAR PREVISTO COMO PAGO
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

    UPDATE public.lancamentos_previstos
    SET status = 'pago',
        pago_em = COALESCE(p_data_pagamento, CURRENT_DATE),
        observacoes = COALESCE(p_observacoes, observacoes),
        updated_at = NOW()
    WHERE id = p_previsto_id;

    RETURN p_previsto_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_previsto_pago(BIGINT, DATE, TEXT) TO authenticated;

