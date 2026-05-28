-- ============================================
-- FASE 2.5: Diagnóstico e limpeza funcional de devoluções órfãs
-- ============================================
-- - Diagnóstico classifica órfãs em limpáveis x bloqueadas
-- - Limpeza executa somente casos deterministicamente excluíveis
-- - Casos ambíguos são reportados e não sofrem mutação
-- ============================================

-- 1) Idempotência da limpeza em lote
CREATE TABLE IF NOT EXISTS public.devolucoes_orfas_cleanup_requests (
  request_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resultado JSONB NOT NULL
);

COMMENT ON TABLE public.devolucoes_orfas_cleanup_requests IS
'Idempotência para limpeza de devoluções órfãs em lote (limpar_devolucoes_orfas_estoque)';

ALTER TABLE public.devolucoes_orfas_cleanup_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT requests cleanup orfas por usuario autenticado"
  ON public.devolucoes_orfas_cleanup_requests;

CREATE POLICY "SELECT requests cleanup orfas por usuario autenticado"
  ON public.devolucoes_orfas_cleanup_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "INSERT requests cleanup orfas por usuario autenticado"
  ON public.devolucoes_orfas_cleanup_requests;

CREATE POLICY "INSERT requests cleanup orfas por usuario autenticado"
  ON public.devolucoes_orfas_cleanup_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 2) Diagnóstico de órfãs
CREATE OR REPLACE FUNCTION public.diagnosticar_devolucoes_orfas_estoque()
RETURNS TABLE(
  devolucao_id INTEGER,
  motivo TEXT,
  pode_limpar BOOLEAN,
  lancamento_caixa_id UUID,
  operacao_entrada_devolucoes_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_empresa_id UUID;
  v_rec RECORD;
  v_motivo TEXT;
  v_pode_limpar BOOLEAN;
  v_operacao_entrada_valida BOOLEAN;
  v_transferencia_ambigua BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO: Usuário não autenticado';
  END IF;

  v_empresa_id := public.get_user_empresa_id();

  FOR v_rec IN
    SELECT
      de.id,
      COALESCE(de.status, 'pendente')::TEXT AS status,
      de.lancamento_caixa_id,
      de.operacao_entrada_devolucoes_id,
      lc.id AS lancamento_encontrado
    FROM public.devolucoes_estoque de
    LEFT JOIN public.lancamentos_caixa lc
      ON lc.id = de.lancamento_caixa_id
      AND lc.empresa_id = v_empresa_id
    WHERE de.empresa_id = v_empresa_id
      AND (de.lancamento_caixa_id IS NULL OR lc.id IS NULL)
    ORDER BY de.id
  LOOP
    v_motivo := CASE
      WHEN v_rec.lancamento_caixa_id IS NULL THEN 'SEM_LANCAMENTO'
      ELSE 'LANCAMENTO_INEXISTENTE'
    END;

    v_pode_limpar := TRUE;

    IF v_rec.status NOT IN ('pendente', 'parcialmente_transferida', 'transferida') THEN
      v_motivo := 'ESTADO_INVALIDO';
      v_pode_limpar := FALSE;
    END IF;

    IF v_pode_limpar THEN
      IF v_rec.operacao_entrada_devolucoes_id IS NULL THEN
        v_motivo := 'SEM_OPERACAO_ENTRADA';
        v_pode_limpar := FALSE;
      ELSE
        SELECT EXISTS (
          SELECT 1
          FROM public.operacoes_estoque oe
          JOIN public.estoques e ON e.id = oe.estoque_id
          WHERE oe.id = v_rec.operacao_entrada_devolucoes_id
            AND oe.empresa_id = v_empresa_id
            AND oe.tipo_operacao = 'entrada'
            AND e.tipo = 'DEVOLUCOES'
        ) INTO v_operacao_entrada_valida;

        IF NOT v_operacao_entrada_valida THEN
          v_motivo := 'SEM_OPERACAO_ENTRADA';
          v_pode_limpar := FALSE;
        END IF;
      END IF;
    END IF;

    IF v_pode_limpar THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.devolucoes_transferencias dt
        LEFT JOIN public.movimentacoes_estoque me ON me.id = dt.movimentacao_id
        WHERE dt.devolucao_id = v_rec.id
          AND (
            me.id IS NULL
            OR me.tipo NOT IN ('devolucao_para_conta', 'devolucao_para_estoque')
            OR (
              me.tipo = 'devolucao_para_conta'
              AND (me.conta_bancaria_id IS NULL OR me.lancamento_destino_id IS NULL)
            )
            OR (
              me.tipo = 'devolucao_para_estoque'
              AND (me.estoque_destino_id IS NULL OR me.operacao_destino_id IS NULL)
            )
          )
      ) INTO v_transferencia_ambigua;

      IF v_transferencia_ambigua THEN
        v_motivo := 'TRANSFERENCIA_SEM_DESTINO_DETERMINISTICO';
        v_pode_limpar := FALSE;
      END IF;
    END IF;

    devolucao_id := v_rec.id;
    motivo := v_motivo;
    pode_limpar := v_pode_limpar;
    lancamento_caixa_id := v_rec.lancamento_caixa_id;
    operacao_entrada_devolucoes_id := v_rec.operacao_entrada_devolucoes_id;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.diagnosticar_devolucoes_orfas_estoque() TO authenticated;

COMMENT ON FUNCTION public.diagnosticar_devolucoes_orfas_estoque IS
'Diagnostica devoluções órfãs e classifica entre limpáveis e bloqueadas por ambiguidade/estado';

-- 3) Limpeza em lote de órfãs (somente limpáveis)
CREATE OR REPLACE FUNCTION public.limpar_devolucoes_orfas_estoque(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
  v_existing JSONB;
  v_user_id UUID;

  v_diag RECORD;
  v_exclusao_result JSONB;

  v_total_orfas INTEGER := 0;
  v_total_limpaveis INTEGER := 0;
  v_limpas INTEGER := 0;
  v_falhas INTEGER := 0;

  v_bloqueadas JSONB := '[]'::JSONB;
  v_erros JSONB := '[]'::JSONB;
  v_resultado JSONB;
BEGIN
  v_request_id := (payload->>'request_id')::UUID;
  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object('error', 'request_id obrigatório', 'code', 'REQUEST_ID_INVALIDO');
  END IF;

  SELECT resultado INTO v_existing
  FROM public.devolucoes_orfas_cleanup_requests
  WHERE request_id = v_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não autenticado', 'code', 'NAO_AUTENTICADO');
  END IF;

  FOR v_diag IN
    SELECT *
    FROM public.diagnosticar_devolucoes_orfas_estoque()
  LOOP
    v_total_orfas := v_total_orfas + 1;

    IF v_diag.pode_limpar THEN
      v_total_limpaveis := v_total_limpaveis + 1;

      v_exclusao_result := public.excluir_devolucao_estoque(
        jsonb_build_object(
          'request_id', gen_random_uuid(),
          'devolucao_id', v_diag.devolucao_id
        )
      );

      IF COALESCE(v_exclusao_result->>'error', '') <> '' THEN
        v_falhas := v_falhas + 1;
        v_erros := v_erros || jsonb_build_array(
          jsonb_build_object(
            'devolucao_id', v_diag.devolucao_id,
            'code', COALESCE(v_exclusao_result->>'code', 'ESTADO_INVALIDO'),
            'erro', v_exclusao_result->>'error'
          )
        );
      ELSE
        v_limpas := v_limpas + 1;
      END IF;
    ELSE
      v_bloqueadas := v_bloqueadas || jsonb_build_array(
        jsonb_build_object(
          'devolucao_id', v_diag.devolucao_id,
          'motivo', v_diag.motivo
        )
      );
    END IF;
  END LOOP;

  v_resultado := jsonb_build_object(
    'total_orfas', v_total_orfas,
    'total_limpaveis', v_total_limpaveis,
    'limpas', v_limpas,
    'falhas', v_falhas,
    'bloqueadas', v_bloqueadas,
    'erros', v_erros
  );

  INSERT INTO public.devolucoes_orfas_cleanup_requests (request_id, resultado)
  VALUES (v_request_id, v_resultado);

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.limpar_devolucoes_orfas_estoque(JSONB) TO authenticated;

COMMENT ON FUNCTION public.limpar_devolucoes_orfas_estoque(JSONB) IS
'Limpa devoluções órfãs em lote com idempotência por request_id; executa exclusão apenas para casos deterministicamente limpáveis';
