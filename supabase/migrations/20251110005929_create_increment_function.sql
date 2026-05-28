-- ============================================
-- CRIAR FUNÇÃO RPC INCREMENT
-- Função genérica para incrementar valores numéricos em tabelas
-- Usada para atualizar saldos de estoque de forma segura
-- ============================================

CREATE OR REPLACE FUNCTION public.increment(
  table_name TEXT,
  id_column TEXT,
  id_value BIGINT,
  amount_column TEXT,
  amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sql_query TEXT;
BEGIN
  -- Validar que table_name e columns são nomes válidos (prevenir SQL injection)
  IF table_name !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid table name: %', table_name;
  END IF;
  
  IF id_column !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid id column name: %', id_column;
  END IF;
  
  IF amount_column !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid amount column name: %', amount_column;
  END IF;

  -- Construir query dinâmica de forma segura
  sql_query := format(
    'UPDATE %I SET %I = %I + $1 WHERE %I = $2',
    table_name,
    amount_column,
    amount_column,
    id_column
  );

  -- Executar update
  EXECUTE sql_query USING amount, id_value;
END;
$$;

-- Conceder permissão de execução para usuários autenticados
GRANT EXECUTE ON FUNCTION public.increment(TEXT, TEXT, BIGINT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment(TEXT, TEXT, BIGINT, TEXT, NUMERIC) TO anon;

-- Comentário para documentação
COMMENT ON FUNCTION public.increment IS 
'Função genérica para incrementar valores numéricos em colunas de tabelas. Usada principalmente para atualizar saldos de estoque de forma segura e atômica.';

