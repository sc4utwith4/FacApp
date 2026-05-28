-- ============================================
-- Fix: FULL JOIN non-merge-joinable no trigger de conciliação
-- ============================================
-- Causa: trg_sync_conciliacao_item_movimentacao usava FULL OUTER JOIN com
-- condições que não relacionam colunas de ambas as tabelas, gerando erro
-- "FULL JOIN is only supported with merge-joinable or hash-joinable join conditions"
-- ao inserir em movimentacoes_estoque (ex.: transferência de devoluções).
-- Solução: obter empresa_id via COALESCE de subqueries escalares.
-- ============================================

CREATE OR REPLACE FUNCTION public.trg_sync_conciliacao_item_movimentacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_hint UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT COALESCE(
      (SELECT op.empresa_id FROM public.operacoes_estoque op WHERE op.id = OLD.operacao_estoque_id LIMIT 1),
      (SELECT eo.empresa_id FROM public.estoques eo WHERE eo.id = OLD.estoque_origem_id LIMIT 1),
      (SELECT ed.empresa_id FROM public.estoques ed WHERE ed.id = OLD.estoque_destino_id LIMIT 1),
      (SELECT cb.empresa_id FROM public.contas_bancarias cb WHERE cb.id = OLD.conta_bancaria_id LIMIT 1),
      (SELECT co.empresa_id FROM public.contas_bancarias co WHERE co.id = OLD.conta_origem_id LIMIT 1)
    ) INTO v_empresa_hint;

    PERFORM public.fn_sync_conciliacao_item_from_movimentacao(OLD.id, v_empresa_hint);
    RETURN OLD;
  END IF;

  SELECT COALESCE(
    (SELECT op.empresa_id FROM public.operacoes_estoque op WHERE op.id = NEW.operacao_estoque_id LIMIT 1),
    (SELECT eo.empresa_id FROM public.estoques eo WHERE eo.id = NEW.estoque_origem_id LIMIT 1),
    (SELECT ed.empresa_id FROM public.estoques ed WHERE ed.id = NEW.estoque_destino_id LIMIT 1),
    (SELECT cb.empresa_id FROM public.contas_bancarias cb WHERE cb.id = NEW.conta_bancaria_id LIMIT 1),
    (SELECT co.empresa_id FROM public.contas_bancarias co WHERE co.id = NEW.conta_origem_id LIMIT 1)
  ) INTO v_empresa_hint;

  PERFORM public.fn_sync_conciliacao_item_from_movimentacao(NEW.id, v_empresa_hint);
  RETURN NEW;
END;
$$;
