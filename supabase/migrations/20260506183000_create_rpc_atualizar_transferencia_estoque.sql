-- ============================================================================
-- RPC transacional para editar transferencias de estoque/conta com vinculo
-- deterministico em lancamentos_caixa.
-- ============================================================================
-- Objetivo:
-- - Editar movimentacoes novas sem heuristica por valor/data/historico.
-- - Atualizar movimentacao, lancamentos de caixa e saldos de estoque na mesma
--   transacao do Postgres.
-- - Deixar triggers de lancamentos_caixa recalcularem saldos das contas.
-- - Bloquear dados legados sem tag movimentacao_estoque_id:<id>.
-- ============================================================================

ALTER TABLE public.movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS conta_bancaria_destino_id UUID REFERENCES public.contas_bancarias(id) ON DELETE SET NULL;

ALTER TABLE public.movimentacoes_estoque
  ALTER COLUMN tipo TYPE VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_conta_bancaria_destino
  ON public.movimentacoes_estoque(conta_bancaria_destino_id)
  WHERE conta_bancaria_destino_id IS NOT NULL;

ALTER TABLE public.movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS movimentacoes_estoque_tipo_check;

ALTER TABLE public.movimentacoes_estoque
  ADD CONSTRAINT movimentacoes_estoque_tipo_check
  CHECK (tipo IN (
    'acrescimos',
    'receita_juros',
    'entre_contas',
    'lancar_receitas',
    'devolucao_cheque',
    'conta_para_estoque',
    'estoque_para_conta',
    'estoque_para_estoque',
    'conta_para_conta',
    'distribuicao_conta',
    'retido_estoque',
    'recompra',
    'devolucao_para_conta',
    'devolucao_para_estoque'
  ));

COMMENT ON COLUMN public.movimentacoes_estoque.conta_bancaria_destino_id IS
'Conta bancaria de destino para movimentacoes conta_para_conta.';

CREATE OR REPLACE FUNCTION public.atualizar_transferencia_estoque(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_empresa_id UUID;

  v_movimentacao_id BIGINT;
  v_mov RECORD;
  v_operacao RECORD;

  v_novo_valor NUMERIC;
  v_nova_data DATE;
  v_novo_historico TEXT;
  v_nova_conta_id UUID;
  v_nova_conta_destino_id UUID;
  v_novo_estoque_origem_id BIGINT;
  v_novo_estoque_destino_id BIGINT;

  v_tag_regex TEXT;
  v_lanc_count INTEGER;
  v_lanc_saida RECORD;
  v_lanc_entrada RECORD;

  v_delta_estoque NUMERIC;
  v_saldo_resultante NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario nao autenticado', 'code', 'NAO_AUTENTICADO');
  END IF;

  v_empresa_id := public.get_user_empresa_id();
  IF v_empresa_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Empresa nao encontrada', 'code', 'EMPRESA_NAO_ENCONTRADA');
  END IF;

  v_movimentacao_id := NULLIF(payload->>'movimentacao_id', '')::BIGINT;
  IF v_movimentacao_id IS NULL OR v_movimentacao_id <= 0 THEN
    RETURN jsonb_build_object('error', 'movimentacao_id obrigatorio e valido', 'code', 'MOVIMENTACAO_NAO_ENCONTRADA');
  END IF;

  SELECT me.*
  INTO v_mov
  FROM public.movimentacoes_estoque me
  WHERE me.id = v_movimentacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Movimentacao nao encontrada', 'code', 'MOVIMENTACAO_NAO_ENCONTRADA');
  END IF;

  IF v_mov.tipo NOT IN ('conta_para_conta', 'conta_para_estoque', 'estoque_para_conta', 'estoque_para_estoque') THEN
    RETURN jsonb_build_object('error', 'Tipo de movimentacao nao e transferencia editavel', 'code', 'TIPO_INVALIDO');
  END IF;

  IF v_mov.tipo = 'estoque_para_estoque' THEN
    RETURN jsonb_build_object(
      'error',
      'Edicao de estoque_para_estoque exige rastreabilidade deterministica da operacao de origem e fica bloqueada nesta fase',
      'code',
      'TIPO_TRANSFERENCIA_NAO_SUPORTADO'
    );
  END IF;

  v_novo_valor := COALESCE(NULLIF(payload->>'valor', '')::NUMERIC, COALESCE(v_mov.valor, 0)::NUMERIC);
  v_nova_data := COALESCE(NULLIF(payload->>'data', '')::DATE, v_mov.data);
  v_novo_historico := COALESCE(NULLIF(payload->>'historico', ''), v_mov.historico);

  IF v_novo_valor <= 0 THEN
    RETURN jsonb_build_object('error', 'Valor deve ser maior que zero', 'code', 'VALOR_INVALIDO');
  END IF;

  IF v_nova_data IS NULL THEN
    RETURN jsonb_build_object('error', 'Data obrigatoria', 'code', 'DATA_INVALIDA');
  END IF;

  v_nova_conta_id := COALESCE(NULLIF(payload->>'conta_bancaria_id', '')::UUID, v_mov.conta_bancaria_id);
  v_nova_conta_destino_id := COALESCE(NULLIF(payload->>'conta_bancaria_destino_id', '')::UUID, v_mov.conta_bancaria_destino_id);
  v_novo_estoque_origem_id := COALESCE(NULLIF(payload->>'estoque_origem_id', '')::BIGINT, v_mov.estoque_origem_id);
  v_novo_estoque_destino_id := COALESCE(NULLIF(payload->>'estoque_destino_id', '')::BIGINT, v_mov.estoque_destino_id);

  v_tag_regex := 'movimentacao_estoque_id:' || v_movimentacao_id::TEXT || '([^0-9]|$)';

  SELECT COUNT(*)
  INTO v_lanc_count
  FROM public.lancamentos_caixa lc
  WHERE lc.empresa_id = v_empresa_id
    AND COALESCE(lc.observacoes, '') ~ v_tag_regex;

  IF v_mov.tipo IN ('conta_para_estoque', 'estoque_para_conta') AND v_lanc_count <> 1 THEN
    RETURN jsonb_build_object(
      'error',
      'Movimentacao sem exatamente um lancamento vinculado por tag',
      'code',
      CASE WHEN v_lanc_count = 0 THEN 'MOVIMENTACAO_SEM_VINCULO' ELSE 'LEGADO_AMBIGUO' END
    );
  END IF;

  IF v_mov.tipo = 'conta_para_conta' AND v_lanc_count <> 2 THEN
    RETURN jsonb_build_object(
      'error',
      'Movimentacao conta_para_conta sem exatamente dois lancamentos vinculados por tag',
      'code',
      CASE WHEN v_lanc_count = 0 THEN 'MOVIMENTACAO_SEM_VINCULO' ELSE 'LEGADO_AMBIGUO' END
    );
  END IF;

  IF v_mov.tipo = 'conta_para_estoque' THEN
    IF v_nova_conta_id IS NULL OR v_novo_estoque_destino_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Conta origem e estoque destino sao obrigatorios', 'code', 'PAYLOAD_INVALIDO');
    END IF;

    PERFORM 1 FROM public.contas_bancarias WHERE id = v_mov.conta_bancaria_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Conta original nao encontrada na empresa', 'code', 'MOVIMENTACAO_NAO_ENCONTRADA');
    END IF;

    PERFORM 1 FROM public.contas_bancarias WHERE id = v_nova_conta_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Conta informada nao encontrada na empresa', 'code', 'CONTA_NAO_ENCONTRADA');
    END IF;

    PERFORM 1 FROM public.estoques WHERE id = v_mov.estoque_destino_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Estoque original nao encontrado na empresa', 'code', 'MOVIMENTACAO_NAO_ENCONTRADA');
    END IF;

    PERFORM 1 FROM public.estoques WHERE id = v_novo_estoque_destino_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Estoque informado nao encontrado na empresa', 'code', 'ESTOQUE_NAO_ENCONTRADO');
    END IF;

    SELECT lc.*
    INTO v_lanc_saida
    FROM public.lancamentos_caixa lc
    WHERE lc.empresa_id = v_empresa_id
      AND COALESCE(lc.observacoes, '') ~ v_tag_regex
      AND lc.tipo = 'saida'
      AND lc.conta_bancaria_id = v_mov.conta_bancaria_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Lancamento vinculado nao encontrado para conta_para_estoque', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF ABS(COALESCE(v_lanc_saida.valor, 0)::NUMERIC - COALESCE(v_mov.valor, 0)::NUMERIC) > 0.01
       OR v_lanc_saida.data <> v_mov.data THEN
      RETURN jsonb_build_object('error', 'Lancamento vinculado inconsistente com conta_para_estoque', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF v_mov.operacao_estoque_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Transferencia sem operacao de estoque vinculada', 'code', 'MOVIMENTACAO_SEM_OPERACAO');
    END IF;

    SELECT oe.*
    INTO v_operacao
    FROM public.operacoes_estoque oe
    WHERE oe.id = v_mov.operacao_estoque_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Operacao de estoque vinculada nao encontrada', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF v_operacao.empresa_id <> v_empresa_id
       OR v_operacao.tipo_operacao <> 'entrada'
       OR v_operacao.estoque_id <> v_mov.estoque_destino_id
       OR ABS(COALESCE(v_operacao.liquido_operacao, 0)::NUMERIC - COALESCE(v_mov.valor, 0)::NUMERIC) > 0.01 THEN
      RETURN jsonb_build_object('error', 'Operacao de estoque inconsistente com conta_para_estoque', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF v_mov.estoque_destino_id = v_novo_estoque_destino_id THEN
      v_delta_estoque := v_novo_valor - COALESCE(v_mov.valor, 0)::NUMERIC;
      SELECT COALESCE(saldo_atual, 0) + v_delta_estoque
      INTO v_saldo_resultante
      FROM public.estoques
      WHERE id = v_novo_estoque_destino_id;

      IF v_saldo_resultante < 0 THEN
        RETURN jsonb_build_object('error', 'Saldo do estoque ficaria negativo', 'code', 'SALDO_ESTOQUE_INSUFICIENTE');
      END IF;

      UPDATE public.estoques
      SET saldo_atual = v_saldo_resultante
      WHERE id = v_novo_estoque_destino_id;
    ELSE
      SELECT COALESCE(saldo_atual, 0) - COALESCE(v_mov.valor, 0)::NUMERIC
      INTO v_saldo_resultante
      FROM public.estoques
      WHERE id = v_mov.estoque_destino_id;

      IF v_saldo_resultante < 0 THEN
        RETURN jsonb_build_object('error', 'Saldo do estoque original ficaria negativo', 'code', 'SALDO_ESTOQUE_INSUFICIENTE');
      END IF;

      UPDATE public.estoques
      SET saldo_atual = v_saldo_resultante
      WHERE id = v_mov.estoque_destino_id;

      UPDATE public.estoques
      SET saldo_atual = COALESCE(saldo_atual, 0) + v_novo_valor
      WHERE id = v_novo_estoque_destino_id;
    END IF;

    UPDATE public.operacoes_estoque
    SET estoque_id = v_novo_estoque_destino_id,
        liquido_operacao = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        updated_at = NOW()
    WHERE id = v_operacao.id;

    UPDATE public.lancamentos_caixa
    SET conta_bancaria_id = v_nova_conta_id,
        valor = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        updated_at = NOW()
    WHERE id = v_lanc_saida.id;

    UPDATE public.movimentacoes_estoque
    SET valor = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        conta_bancaria_id = v_nova_conta_id,
        estoque_destino_id = v_novo_estoque_destino_id,
        updated_at = NOW()
    WHERE id = v_mov.id;

    RETURN jsonb_build_object(
      'status', 'atualizada',
      'movimentacao_id', v_mov.id,
      'tipo', v_mov.tipo,
      'lancamentos_atualizados', jsonb_build_array(v_lanc_saida.id),
      'operacao_estoque_id', v_operacao.id
    );
  END IF;

  IF v_mov.tipo = 'estoque_para_conta' THEN
    IF v_novo_estoque_origem_id IS NULL OR v_nova_conta_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Estoque origem e conta destino sao obrigatorios', 'code', 'PAYLOAD_INVALIDO');
    END IF;

    PERFORM 1 FROM public.estoques WHERE id = v_mov.estoque_origem_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Estoque original nao encontrado na empresa', 'code', 'MOVIMENTACAO_NAO_ENCONTRADA');
    END IF;

    PERFORM 1 FROM public.estoques WHERE id = v_novo_estoque_origem_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Estoque informado nao encontrado na empresa', 'code', 'ESTOQUE_NAO_ENCONTRADO');
    END IF;

    PERFORM 1 FROM public.contas_bancarias WHERE id = v_mov.conta_bancaria_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Conta original nao encontrada na empresa', 'code', 'MOVIMENTACAO_NAO_ENCONTRADA');
    END IF;

    PERFORM 1 FROM public.contas_bancarias WHERE id = v_nova_conta_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Conta informada nao encontrada na empresa', 'code', 'CONTA_NAO_ENCONTRADA');
    END IF;

    SELECT lc.*
    INTO v_lanc_entrada
    FROM public.lancamentos_caixa lc
    WHERE lc.empresa_id = v_empresa_id
      AND COALESCE(lc.observacoes, '') ~ v_tag_regex
      AND lc.tipo = 'entrada'
      AND lc.conta_bancaria_id = v_mov.conta_bancaria_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Lancamento vinculado nao encontrado para estoque_para_conta', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF ABS(COALESCE(v_lanc_entrada.valor, 0)::NUMERIC - COALESCE(v_mov.valor, 0)::NUMERIC) > 0.01
       OR v_lanc_entrada.data <> v_mov.data THEN
      RETURN jsonb_build_object('error', 'Lancamento vinculado inconsistente com estoque_para_conta', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF v_mov.operacao_estoque_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Transferencia sem operacao de estoque vinculada', 'code', 'MOVIMENTACAO_SEM_OPERACAO');
    END IF;

    SELECT oe.*
    INTO v_operacao
    FROM public.operacoes_estoque oe
    WHERE oe.id = v_mov.operacao_estoque_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Operacao de estoque vinculada nao encontrada', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF v_operacao.empresa_id <> v_empresa_id
       OR v_operacao.tipo_operacao <> 'saida'
       OR v_operacao.estoque_id <> v_mov.estoque_origem_id
       OR ABS(COALESCE(v_operacao.liquido_operacao, 0)::NUMERIC - COALESCE(v_mov.valor, 0)::NUMERIC) > 0.01 THEN
      RETURN jsonb_build_object('error', 'Operacao de estoque inconsistente com estoque_para_conta', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF v_mov.estoque_origem_id = v_novo_estoque_origem_id THEN
      v_delta_estoque := COALESCE(v_mov.valor, 0)::NUMERIC - v_novo_valor;
      SELECT COALESCE(saldo_atual, 0) + v_delta_estoque
      INTO v_saldo_resultante
      FROM public.estoques
      WHERE id = v_novo_estoque_origem_id;

      IF v_saldo_resultante < 0 THEN
        RETURN jsonb_build_object('error', 'Saldo do estoque ficaria negativo', 'code', 'SALDO_ESTOQUE_INSUFICIENTE');
      END IF;

      UPDATE public.estoques
      SET saldo_atual = v_saldo_resultante
      WHERE id = v_novo_estoque_origem_id;
    ELSE
      UPDATE public.estoques
      SET saldo_atual = COALESCE(saldo_atual, 0) + COALESCE(v_mov.valor, 0)::NUMERIC
      WHERE id = v_mov.estoque_origem_id;

      SELECT COALESCE(saldo_atual, 0) - v_novo_valor
      INTO v_saldo_resultante
      FROM public.estoques
      WHERE id = v_novo_estoque_origem_id;

      IF v_saldo_resultante < 0 THEN
        RETURN jsonb_build_object('error', 'Saldo do novo estoque ficaria negativo', 'code', 'SALDO_ESTOQUE_INSUFICIENTE');
      END IF;

      UPDATE public.estoques
      SET saldo_atual = v_saldo_resultante
      WHERE id = v_novo_estoque_origem_id;
    END IF;

    UPDATE public.operacoes_estoque
    SET estoque_id = v_novo_estoque_origem_id,
        liquido_operacao = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        updated_at = NOW()
    WHERE id = v_operacao.id;

    UPDATE public.lancamentos_caixa
    SET conta_bancaria_id = v_nova_conta_id,
        valor = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        updated_at = NOW()
    WHERE id = v_lanc_entrada.id;

    UPDATE public.movimentacoes_estoque
    SET valor = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        conta_bancaria_id = v_nova_conta_id,
        estoque_origem_id = v_novo_estoque_origem_id,
        updated_at = NOW()
    WHERE id = v_mov.id;

    RETURN jsonb_build_object(
      'status', 'atualizada',
      'movimentacao_id', v_mov.id,
      'tipo', v_mov.tipo,
      'lancamentos_atualizados', jsonb_build_array(v_lanc_entrada.id),
      'operacao_estoque_id', v_operacao.id
    );
  END IF;

  IF v_mov.tipo = 'conta_para_conta' THEN
    IF v_nova_conta_id IS NULL OR v_nova_conta_destino_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Conta origem e conta destino sao obrigatorias', 'code', 'PAYLOAD_INVALIDO');
    END IF;

    IF v_nova_conta_id = v_nova_conta_destino_id THEN
      RETURN jsonb_build_object('error', 'Conta origem e destino devem ser diferentes', 'code', 'ORIGEM_DESTINO_IGUAIS');
    END IF;

    PERFORM 1 FROM public.contas_bancarias WHERE id = v_mov.conta_bancaria_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Conta origem original nao encontrada na empresa', 'code', 'MOVIMENTACAO_NAO_ENCONTRADA');
    END IF;

    PERFORM 1 FROM public.contas_bancarias WHERE id = v_mov.conta_bancaria_destino_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Conta destino original nao encontrada na empresa', 'code', 'MOVIMENTACAO_NAO_ENCONTRADA');
    END IF;

    PERFORM 1 FROM public.contas_bancarias WHERE id = v_nova_conta_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Conta origem informada nao encontrada na empresa', 'code', 'CONTA_NAO_ENCONTRADA');
    END IF;

    PERFORM 1 FROM public.contas_bancarias WHERE id = v_nova_conta_destino_id AND empresa_id = v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Conta destino informada nao encontrada na empresa', 'code', 'CONTA_NAO_ENCONTRADA');
    END IF;

    SELECT lc.*
    INTO v_lanc_saida
    FROM public.lancamentos_caixa lc
    WHERE lc.empresa_id = v_empresa_id
      AND COALESCE(lc.observacoes, '') ~ v_tag_regex
      AND lc.tipo = 'saida'
      AND lc.conta_bancaria_id = v_mov.conta_bancaria_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Lancamento de saida vinculado nao encontrado', 'code', 'LEGADO_AMBIGUO');
    END IF;

    SELECT lc.*
    INTO v_lanc_entrada
    FROM public.lancamentos_caixa lc
    WHERE lc.empresa_id = v_empresa_id
      AND COALESCE(lc.observacoes, '') ~ v_tag_regex
      AND lc.tipo = 'entrada'
      AND lc.conta_bancaria_id = v_mov.conta_bancaria_destino_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Lancamento de entrada vinculado nao encontrado', 'code', 'LEGADO_AMBIGUO');
    END IF;

    IF ABS(COALESCE(v_lanc_saida.valor, 0)::NUMERIC - COALESCE(v_mov.valor, 0)::NUMERIC) > 0.01
       OR ABS(COALESCE(v_lanc_entrada.valor, 0)::NUMERIC - COALESCE(v_mov.valor, 0)::NUMERIC) > 0.01
       OR v_lanc_saida.data <> v_mov.data
       OR v_lanc_entrada.data <> v_mov.data THEN
      RETURN jsonb_build_object('error', 'Lancamentos vinculados inconsistentes com conta_para_conta', 'code', 'LEGADO_AMBIGUO');
    END IF;

    UPDATE public.lancamentos_caixa
    SET conta_bancaria_id = v_nova_conta_id,
        valor = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        updated_at = NOW()
    WHERE id = v_lanc_saida.id;

    UPDATE public.lancamentos_caixa
    SET conta_bancaria_id = v_nova_conta_destino_id,
        valor = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        updated_at = NOW()
    WHERE id = v_lanc_entrada.id;

    UPDATE public.movimentacoes_estoque
    SET valor = v_novo_valor,
        data = v_nova_data,
        historico = v_novo_historico,
        conta_bancaria_id = v_nova_conta_id,
        conta_bancaria_destino_id = v_nova_conta_destino_id,
        updated_at = NOW()
    WHERE id = v_mov.id;

    RETURN jsonb_build_object(
      'status', 'atualizada',
      'movimentacao_id', v_mov.id,
      'tipo', v_mov.tipo,
      'lancamentos_atualizados', jsonb_build_array(v_lanc_saida.id, v_lanc_entrada.id)
    );
  END IF;

  RETURN jsonb_build_object('error', 'Tipo nao tratado', 'code', 'TIPO_INVALIDO');
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_transferencia_estoque(JSONB) TO authenticated;

COMMENT ON FUNCTION public.atualizar_transferencia_estoque(JSONB) IS
'Edita transferencias conta/estoque de forma transacional usando vinculo movimentacao_estoque_id em lancamentos_caixa. Bloqueia legado ambiguo e estoque_para_estoque nesta fase.';
