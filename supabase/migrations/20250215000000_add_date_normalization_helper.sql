-- ============================================
-- Função Auxiliar para Normalização de Datas
-- ============================================
-- Esta migration cria uma função auxiliar para normalizar datas
-- garantindo tratamento consistente em toda a plataforma

-- Função auxiliar para normalizar string de data para DATE
-- Garante que a data seja sempre tratada como local sem conversão de timezone
CREATE OR REPLACE FUNCTION public.normalize_date_string(
    p_date_input TEXT
) RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    v_date_text TEXT;
    v_date_result DATE;
BEGIN
    -- Se NULL, retornar NULL
    IF p_date_input IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Garantir que é TEXT
    v_date_text := p_date_input::TEXT;
    
    -- Remover espaços em branco
    v_date_text := TRIM(v_date_text);
    
    -- Validar formato básico (deve ter pelo menos 10 caracteres para YYYY-MM-DD)
    IF LENGTH(v_date_text) < 10 THEN
        RAISE EXCEPTION 'Formato de data inválido. String muito curta: %', v_date_text;
    END IF;
    
    -- Extrair apenas a parte da data (primeiros 10 caracteres para YYYY-MM-DD)
    -- Isso garante que mesmo se vier com timestamp, pegamos só a data
    IF LENGTH(v_date_text) > 10 THEN
        v_date_text := SUBSTRING(v_date_text, 1, 10);
    END IF;
    
    -- Validar formato YYYY-MM-DD usando regex
    IF v_date_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'Formato de data inválido. Esperado YYYY-MM-DD, recebido: %', v_date_text;
    END IF;
    
    -- Converter usando TO_DATE - trata como data local sem timezone
    -- TO_DATE não considera timezone, trata como data literal
    v_date_result := TO_DATE(v_date_text, 'YYYY-MM-DD');
    
    RETURN v_date_result;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao normalizar data: %. Valor recebido: %', SQLERRM, p_date_input;
END;
$$;

-- Comentário na função
COMMENT ON FUNCTION public.normalize_date_string(TEXT) IS 
'Normaliza uma string de data para DATE, garantindo tratamento como data local sem conversão de timezone. Aceita formato YYYY-MM-DD.';

-- Grant de permissão
GRANT EXECUTE ON FUNCTION public.normalize_date_string(TEXT) TO authenticated;

-- Atualizar funções RPC para usar a função auxiliar
CREATE OR REPLACE FUNCTION public.criar_conta_fixa(
    p_descricao TEXT,
    p_natureza TEXT,
    p_grupo_contas_id UUID,
    p_conta_bancaria_id UUID,
    p_periodicidade TEXT,
    p_dia_ref SMALLINT,
    p_valor NUMERIC,
    p_proximo_evento TEXT, -- Recebe como string para evitar conversão de timezone
    p_weekday_ref SMALLINT DEFAULT NULL,
    p_ativo BOOLEAN DEFAULT TRUE,
    p_tolerancia_dias SMALLINT DEFAULT 0,
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
    -- Usar função auxiliar para normalizar a data
    v_proximo_evento_date := public.normalize_date_string(p_proximo_evento);
    
    -- Inserir conta fixa
    INSERT INTO public.contas_fixas (
        empresa_id,
        descricao,
        natureza,
        grupo_contas_id,
        conta_bancaria_id,
        periodicidade,
        dia_ref,
        weekday_ref,
        valor,
        ativo,
        proximo_evento,
        tolerancia_dias,
        observacoes
    )
    VALUES (
        v_empresa,
        p_descricao,
        p_natureza,
        p_grupo_contas_id,
        p_conta_bancaria_id,
        p_periodicidade,
        p_dia_ref,
        p_weekday_ref,
        p_valor,
        p_ativo,
        v_proximo_evento_date,
        p_tolerancia_dias,
        p_observacoes
    )
    RETURNING * INTO v_result;
    
    -- Retornar o registro inserido
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

-- Atualizar função de atualização também
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
    p_proximo_evento TEXT DEFAULT NULL, -- Recebe como string para evitar conversão de timezone
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
    -- Verificar se a conta fixa pertence à empresa do usuário
    IF NOT EXISTS (
        SELECT 1 FROM public.contas_fixas 
        WHERE id = p_id AND empresa_id = v_empresa
    ) THEN
        RAISE EXCEPTION 'Conta fixa não encontrada ou sem permissão.';
    END IF;
    
    -- Converter string de data para DATE se fornecida usando função auxiliar
    IF p_proximo_evento IS NOT NULL THEN
        v_proximo_evento_date := public.normalize_date_string(p_proximo_evento);
    END IF;
    
    -- Atualizar conta fixa
    UPDATE public.contas_fixas
    SET 
        descricao = COALESCE(p_descricao, descricao),
        natureza = COALESCE(p_natureza, natureza),
        grupo_contas_id = COALESCE(p_grupo_contas_id, grupo_contas_id),
        conta_bancaria_id = COALESCE(p_conta_bancaria_id, conta_bancaria_id),
        periodicidade = COALESCE(p_periodicidade, periodicidade),
        dia_ref = COALESCE(p_dia_ref, dia_ref),
        weekday_ref = COALESCE(p_weekday_ref, weekday_ref),
        valor = COALESCE(p_valor, valor),
        ativo = COALESCE(p_ativo, ativo),
        proximo_evento = COALESCE(v_proximo_evento_date, proximo_evento),
        tolerancia_dias = COALESCE(p_tolerancia_dias, tolerancia_dias),
        observacoes = COALESCE(p_observacoes, observacoes),
        updated_at = NOW()
    WHERE id = p_id AND empresa_id = v_empresa
    RETURNING * INTO v_result;
    
    -- Retornar o registro atualizado
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

