-- Helpers explícitos para evitar ambiguidade de sobrecarga no PostgREST
-- Cenário: public.increment possui versões BIGINT e UUID para id_value.
-- Em algumas chamadas RPC, o resolvedor não escolhe assinatura única.

CREATE OR REPLACE FUNCTION public.increment_bigint(
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
BEGIN
  PERFORM public.increment(table_name, id_column, id_value, amount_column, amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_uuid(
  table_name TEXT,
  id_column TEXT,
  id_value UUID,
  amount_column TEXT,
  amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.increment(table_name, id_column, id_value, amount_column, amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_bigint(TEXT, TEXT, BIGINT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_bigint(TEXT, TEXT, BIGINT, TEXT, NUMERIC) TO anon;

GRANT EXECUTE ON FUNCTION public.increment_uuid(TEXT, TEXT, UUID, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_uuid(TEXT, TEXT, UUID, TEXT, NUMERIC) TO anon;

COMMENT ON FUNCTION public.increment_bigint(TEXT, TEXT, BIGINT, TEXT, NUMERIC) IS
'Wrapper sem ambiguidade para incrementar colunas numéricas por ID BIGINT.';

COMMENT ON FUNCTION public.increment_uuid(TEXT, TEXT, UUID, TEXT, NUMERIC) IS
'Wrapper sem ambiguidade para incrementar colunas numéricas por ID UUID.';
