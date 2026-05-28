-- ============================================
-- FIX: Corrigir função get_fornecedores_with_indicators
-- ============================================
-- Adiciona COALESCE para tratar valores NULL e garantir tipos corretos

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
$$ LANGUAGE plpgsql SECURITY DEFINER;;
