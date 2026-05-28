-- ============================================
-- MIGRATION: Atualizar Valores de Estoque
-- ============================================
-- Atualiza os valores totais dos estoques para:
-- SOI: 7.149.102,01
-- SPPRO: 991.424,12

DO $$
DECLARE
  v_empresa_id UUID := '00000000-0000-0000-0000-000000000001';
  v_soma_sppro_desejada NUMERIC(15,2) := 991424.12;
  v_soma_soi_desejada NUMERIC(15,2) := 7149102.01;
  v_soma_sppro_atual NUMERIC(15,2);
  v_soma_soi_atual NUMERIC(15,2);
  v_diferenca_sppro NUMERIC(15,2);
  v_diferenca_soi NUMERIC(15,2);
  v_total_estoques_sppro INTEGER;
  v_total_estoques_soi INTEGER;
  v_estoque_sppro_id BIGINT;
  v_estoque_soi_id BIGINT;
BEGIN
  -- Verificar se empresa existe
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = v_empresa_id) THEN
    RAISE EXCEPTION 'Empresa padrão não encontrada';
  END IF;

  -- Calcular soma atual dos saldos SPPRO
  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_soma_sppro_atual
  FROM public.estoques
  WHERE tipo = 'SPPRO' AND ativo = true;

  -- Calcular soma atual dos saldos SOI
  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_soma_soi_atual
  FROM public.estoques
  WHERE tipo = 'SOI' AND ativo = true;

  -- Contar estoques ativos por tipo
  SELECT COUNT(*) INTO v_total_estoques_sppro
  FROM public.estoques
  WHERE tipo = 'SPPRO' AND ativo = true;

  SELECT COUNT(*) INTO v_total_estoques_soi
  FROM public.estoques
  WHERE tipo = 'SOI' AND ativo = true;

  -- Se não há estoques SPPRO, criar um estoque padrão
  IF v_total_estoques_sppro = 0 THEN
    INSERT INTO public.estoques (empresa_id, tipo, descricao, saldo_atual, ativo)
    VALUES (v_empresa_id, 'SPPRO', 'Estoque SPPRO Principal', v_soma_sppro_desejada, true)
    RETURNING id INTO v_estoque_sppro_id;
    
    RAISE NOTICE 'Estoque SPPRO criado com saldo: %', v_soma_sppro_desejada;
  ELSE
    -- Calcular diferença
    v_diferenca_sppro := v_soma_sppro_desejada - v_soma_sppro_atual;
    
    -- Ajustar saldos SPPRO proporcionalmente
    IF v_diferenca_sppro != 0 THEN
      IF v_soma_sppro_atual > 0 THEN
        -- Distribuir proporcionalmente baseado no saldo atual de cada estoque
        UPDATE public.estoques
        SET saldo_atual = saldo_atual + (v_diferenca_sppro * (saldo_atual / v_soma_sppro_atual))
        WHERE tipo = 'SPPRO' AND ativo = true;
        
        RAISE NOTICE 'SPPRO: Saldos ajustados proporcionalmente';
      ELSE
        -- Se não há saldo, distribuir igualmente
        UPDATE public.estoques
        SET saldo_atual = saldo_atual + (v_diferenca_sppro / v_total_estoques_sppro)
        WHERE tipo = 'SPPRO' AND ativo = true;
        
        RAISE NOTICE 'SPPRO: Saldos ajustados igualmente';
      END IF;
    END IF;
  END IF;

  -- Se não há estoques SOI, criar um estoque padrão
  IF v_total_estoques_soi = 0 THEN
    INSERT INTO public.estoques (empresa_id, tipo, descricao, saldo_atual, ativo)
    VALUES (v_empresa_id, 'SOI', 'Estoque SOI Principal', v_soma_soi_desejada, true)
    RETURNING id INTO v_estoque_soi_id;
    
    RAISE NOTICE 'Estoque SOI criado com saldo: %', v_soma_soi_desejada;
  ELSE
    -- Calcular diferença
    v_diferenca_soi := v_soma_soi_desejada - v_soma_soi_atual;
    
    -- Ajustar saldos SOI proporcionalmente
    IF v_diferenca_soi != 0 THEN
      IF v_soma_soi_atual > 0 THEN
        -- Distribuir proporcionalmente baseado no saldo atual de cada estoque
        UPDATE public.estoques
        SET saldo_atual = saldo_atual + (v_diferenca_soi * (saldo_atual / v_soma_soi_atual))
        WHERE tipo = 'SOI' AND ativo = true;
        
        RAISE NOTICE 'SOI: Saldos ajustados proporcionalmente';
      ELSE
        -- Se não há saldo, distribuir igualmente
        UPDATE public.estoques
        SET saldo_atual = saldo_atual + (v_diferenca_soi / v_total_estoques_soi)
        WHERE tipo = 'SOI' AND ativo = true;
        
        RAISE NOTICE 'SOI: Saldos ajustados igualmente';
      END IF;
    END IF;
  END IF;

  -- Verificar resultados finais
  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_soma_sppro_atual
  FROM public.estoques
  WHERE tipo = 'SPPRO' AND ativo = true;

  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_soma_soi_atual
  FROM public.estoques
  WHERE tipo = 'SOI' AND ativo = true;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Ajuste concluído:';
  RAISE NOTICE 'SPPRO - Soma atual: %, Desejada: %', v_soma_sppro_atual, v_soma_sppro_desejada;
  RAISE NOTICE 'SOI - Soma atual: %, Desejada: %', v_soma_soi_atual, v_soma_soi_desejada;
  RAISE NOTICE '========================================';
END $$;

