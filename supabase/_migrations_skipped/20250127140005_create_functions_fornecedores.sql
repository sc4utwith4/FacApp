-- ============================================
-- MIGRATION: Criar Funções para Fornecedores (Factoring)
-- ============================================
-- Funções RPC para cálculos de indicadores e agregações

-- ============================================
-- 1. Função para calcular indicadores de fornecedor
-- ============================================
CREATE OR REPLACE FUNCTION calcular_indicadores_fornecedor(p_fornecedor_id UUID, p_empresa_id UUID)
RETURNS TABLE (
  limite_utilizado NUMERIC(15,2),
  saldo_a_liberar NUMERIC(15,2),
  titulos_em_atraso INTEGER,
  valor_titulos_atraso NUMERIC(15,2),
  total_duplicatas_pendentes NUMERIC(15,2),
  total_duplicatas_antecipadas NUMERIC(15,2),
  total_pagamentos NUMERIC(15,2),
  total_tarifas NUMERIC(15,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Limite utilizado (soma de duplicatas pendentes + antecipadas)
    COALESCE((
      SELECT SUM(valor_face)
      FROM public.duplicatas_fornecedor
      WHERE fornecedor_id = p_fornecedor_id
        AND empresa_id = p_empresa_id
        AND status IN ('pendente', 'antecipada')
    ), 0)::NUMERIC(15,2) AS limite_utilizado,
    
    -- Saldo a liberar (duplicatas pendentes)
    COALESCE((
      SELECT SUM(valor_face)
      FROM public.duplicatas_fornecedor
      WHERE fornecedor_id = p_fornecedor_id
        AND empresa_id = p_empresa_id
        AND status = 'pendente'
    ), 0)::NUMERIC(15,2) AS saldo_a_liberar,
    
    -- Títulos em atraso (quantidade)
    COALESCE((
      SELECT COUNT(*)
      FROM public.duplicatas_fornecedor
      WHERE fornecedor_id = p_fornecedor_id
        AND empresa_id = p_empresa_id
        AND data_vencimento < CURRENT_DATE
        AND status NOT IN ('paga', 'cancelada')
    ), 0)::INTEGER AS titulos_em_atraso,
    
    -- Valor de títulos em atraso
    COALESCE((
      SELECT SUM(valor_face)
      FROM public.duplicatas_fornecedor
      WHERE fornecedor_id = p_fornecedor_id
        AND empresa_id = p_empresa_id
        AND data_vencimento < CURRENT_DATE
        AND status NOT IN ('paga', 'cancelada')
    ), 0)::NUMERIC(15,2) AS valor_titulos_atraso,
    
    -- Total duplicatas pendentes
    COALESCE((
      SELECT SUM(valor_face)
      FROM public.duplicatas_fornecedor
      WHERE fornecedor_id = p_fornecedor_id
        AND empresa_id = p_empresa_id
        AND status = 'pendente'
    ), 0)::NUMERIC(15,2) AS total_duplicatas_pendentes,
    
    -- Total duplicatas antecipadas
    COALESCE((
      SELECT SUM(valor_antecipado)
      FROM public.duplicatas_fornecedor
      WHERE fornecedor_id = p_fornecedor_id
        AND empresa_id = p_empresa_id
        AND status = 'antecipada'
    ), 0)::NUMERIC(15,2) AS total_duplicatas_antecipadas,
    
    -- Total pagamentos
    COALESCE((
      SELECT SUM(valor)
      FROM public.pagamentos_fornecedor
      WHERE fornecedor_id = p_fornecedor_id
        AND empresa_id = p_empresa_id
    ), 0)::NUMERIC(15,2) AS total_pagamentos,
    
    -- Total tarifas
    COALESCE((
      SELECT SUM(valor)
      FROM public.tarifas_fornecedor
      WHERE fornecedor_id = p_fornecedor_id
        AND empresa_id = p_empresa_id
    ), 0)::NUMERIC(15,2) AS total_tarifas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2. Função para atualizar indicadores de fornecedor
-- ============================================
CREATE OR REPLACE FUNCTION atualizar_indicadores_fornecedor(p_fornecedor_id UUID, p_empresa_id UUID)
RETURNS void AS $$
DECLARE
  v_indicadores RECORD;
BEGIN
  -- Calcular indicadores
  SELECT * INTO v_indicadores
  FROM calcular_indicadores_fornecedor(p_fornecedor_id, p_empresa_id);

  -- Atualizar fornecedor
  UPDATE public.fornecedores
  SET
    limite_utilizado = v_indicadores.limite_utilizado,
    saldo_a_liberar = v_indicadores.saldo_a_liberar,
    titulos_em_atraso = v_indicadores.titulos_em_atraso,
    valor_titulos_atraso = v_indicadores.valor_titulos_atraso,
    data_ultima_operacao = CURRENT_DATE
  WHERE id = p_fornecedor_id
    AND empresa_id = p_empresa_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. Função para buscar fornecedores com indicadores
-- ============================================
CREATE OR REPLACE FUNCTION get_fornecedores_with_indicators(p_empresa_id UUID)
RETURNS TABLE (
  id UUID,
  razao_social VARCHAR,
  nome_fantasia VARCHAR,
  cnpj VARCHAR,
  situacao VARCHAR,
  limite_credito NUMERIC(15,2),
  limite_utilizado NUMERIC(15,2),
  saldo_a_liberar NUMERIC(15,2),
  titulos_em_atraso INTEGER,
  valor_titulos_atraso NUMERIC(15,2),
  status BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.razao_social,
    COALESCE(f.nome_fantasia, '')::VARCHAR as nome_fantasia,
    COALESCE(f.cnpj, '')::VARCHAR as cnpj,
    COALESCE(f.situacao, 'ativo')::VARCHAR as situacao,
    COALESCE(f.limite_credito, 0)::NUMERIC(15,2) as limite_credito,
    COALESCE(f.limite_utilizado, 0)::NUMERIC(15,2) as limite_utilizado,
    COALESCE(f.saldo_a_liberar, 0)::NUMERIC(15,2) as saldo_a_liberar,
    COALESCE(f.titulos_em_atraso, 0)::INTEGER as titulos_em_atraso,
    COALESCE(f.valor_titulos_atraso, 0)::NUMERIC(15,2) as valor_titulos_atraso,
    COALESCE(f.status, true)::BOOLEAN as status,
    COALESCE(f.created_at, NOW())::TIMESTAMPTZ as created_at
  FROM public.fornecedores f
  WHERE f.empresa_id = p_empresa_id
  ORDER BY f.razao_social;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. Trigger para atualizar indicadores automaticamente
-- ============================================
CREATE OR REPLACE FUNCTION trigger_atualizar_indicadores_fornecedor()
RETURNS TRIGGER AS $$
BEGIN
  -- Atualizar indicadores quando duplicata for inserida/atualizada
  IF TG_TABLE_NAME = 'duplicatas_fornecedor' THEN
    PERFORM atualizar_indicadores_fornecedor(NEW.fornecedor_id, NEW.empresa_id);
  END IF;
  
  -- Atualizar indicadores quando pagamento for inserido/atualizado
  IF TG_TABLE_NAME = 'pagamentos_fornecedor' THEN
    PERFORM atualizar_indicadores_fornecedor(NEW.fornecedor_id, NEW.empresa_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para atualizar indicadores automaticamente
CREATE TRIGGER trigger_atualizar_indicadores_duplicata
  AFTER INSERT OR UPDATE OR DELETE ON public.duplicatas_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION trigger_atualizar_indicadores_fornecedor();

CREATE TRIGGER trigger_atualizar_indicadores_pagamento
  AFTER INSERT OR UPDATE OR DELETE ON public.pagamentos_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION trigger_atualizar_indicadores_fornecedor();

-- Comentários
COMMENT ON FUNCTION calcular_indicadores_fornecedor IS 'Calcula indicadores de factoring para um fornecedor';
COMMENT ON FUNCTION atualizar_indicadores_fornecedor IS 'Atualiza indicadores de factoring para um fornecedor';
COMMENT ON FUNCTION get_fornecedores_with_indicators IS 'Busca fornecedores com indicadores calculados';

