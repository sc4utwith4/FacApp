-- ============================================
-- MIGRATION: Zerar e Atualizar Valores de Estoque
-- ============================================
-- 1. Zera todos os valores dos estoques
-- 2. Define os novos valores:
--    SPPRO: 9.914.424,12
--    SOI: 7.149.102,01

DO $$
DECLARE
  v_empresa_id UUID := '00000000-0000-0000-0000-000000000001';
  v_sppro_desejado NUMERIC(15,2) := 9914424.12;
  v_soi_desejado NUMERIC(15,2) := 7149102.01;
  v_estoque_sppro_id BIGINT;
  v_estoque_soi_id BIGINT;
  v_total_estoques_sppro INTEGER;
  v_total_estoques_soi INTEGER;
BEGIN
  -- Verificar se empresa existe
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = v_empresa_id) THEN
    RAISE EXCEPTION 'Empresa padrão não encontrada';
  END IF;

  -- Contar estoques existentes
  SELECT COUNT(*) INTO v_total_estoques_sppro
  FROM public.estoques
  WHERE tipo = 'SPPRO' AND ativo = true;

  SELECT COUNT(*) INTO v_total_estoques_soi
  FROM public.estoques
  WHERE tipo = 'SOI' AND ativo = true;

  -- ZERAR todos os saldos dos estoques
  UPDATE public.estoques
  SET saldo_atual = 0
  WHERE ativo = true;

  RAISE NOTICE 'Todos os saldos dos estoques foram zerados';

  -- SPPRO: Atualizar ou criar estoque
  IF v_total_estoques_sppro > 0 THEN
    -- Atualizar o primeiro estoque SPPRO com o valor desejado
    UPDATE public.estoques
    SET saldo_atual = v_sppro_desejado
    WHERE id = (
      SELECT id FROM public.estoques
      WHERE tipo = 'SPPRO' AND ativo = true
      ORDER BY id
      LIMIT 1
    );
    
    RAISE NOTICE 'SPPRO: Estoque atualizado com saldo: %', v_sppro_desejado;
  ELSE
    -- Criar estoque SPPRO se não existir
    INSERT INTO public.estoques (empresa_id, tipo, descricao, saldo_atual, ativo)
    VALUES (v_empresa_id, 'SPPRO', 'Estoque SPPRO Principal', v_sppro_desejado, true)
    RETURNING id INTO v_estoque_sppro_id;
    
    RAISE NOTICE 'SPPRO: Estoque criado com saldo: %', v_sppro_desejado;
  END IF;

  -- SOI: Atualizar ou criar estoque
  IF v_total_estoques_soi > 0 THEN
    -- Atualizar o primeiro estoque SOI com o valor desejado
    UPDATE public.estoques
    SET saldo_atual = v_soi_desejado
    WHERE id = (
      SELECT id FROM public.estoques
      WHERE tipo = 'SOI' AND ativo = true
      ORDER BY id
      LIMIT 1
    );
    
    RAISE NOTICE 'SOI: Estoque atualizado com saldo: %', v_soi_desejado;
  ELSE
    -- Criar estoque SOI se não existir
    INSERT INTO public.estoques (empresa_id, tipo, descricao, saldo_atual, ativo)
    VALUES (v_empresa_id, 'SOI', 'Estoque SOI Principal', v_soi_desejado, true)
    RETURNING id INTO v_estoque_soi_id;
    
    RAISE NOTICE 'SOI: Estoque criado com saldo: %', v_soi_desejado;
  END IF;

  -- Verificar resultados finais
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Valores finais dos estoques:';
  RAISE NOTICE 'SPPRO - Total: %', (SELECT COALESCE(SUM(saldo_atual), 0) FROM public.estoques WHERE tipo = 'SPPRO' AND ativo = true);
  RAISE NOTICE 'SOI - Total: %', (SELECT COALESCE(SUM(saldo_atual), 0) FROM public.estoques WHERE tipo = 'SOI' AND ativo = true);
  RAISE NOTICE '========================================';
END $$;

