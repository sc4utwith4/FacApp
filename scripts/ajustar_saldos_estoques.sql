-- ============================================
-- Script: Ajustar Saldos dos Estoques SPPRO e SOI
-- ============================================
-- Execute este script no Supabase SQL Editor
-- 
-- Ajusta os saldos dos estoques para que a soma resulte nos valores desejados:
-- SPPRO: 9.946.716,36 (base: 9.606.957,38, então soma deve ser: 339.758,98)
-- SOI: 7.401.554,09 (base: 6.790.632,92, então soma deve ser: 610.921,17)

-- Valores desejados para a soma dos saldos dos estoques
-- (valor_final - base_fixa)
DO $$
DECLARE
  v_soma_sppro_desejada NUMERIC(15,2) := 339758.98;
  v_soma_soi_desejada NUMERIC(15,2) := 610921.17;
  v_soma_sppro_atual NUMERIC(15,2);
  v_soma_soi_atual NUMERIC(15,2);
  v_diferenca_sppro NUMERIC(15,2);
  v_diferenca_soi NUMERIC(15,2);
  v_total_estoques_sppro INTEGER;
  v_total_estoques_soi INTEGER;
BEGIN
  -- Calcular soma atual dos saldos SPPRO
  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_soma_sppro_atual
  FROM public.estoques
  WHERE tipo = 'SPPRO' AND ativo = true;
  
  -- Calcular soma atual dos saldos SOI
  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_soma_soi_atual
  FROM public.estoques
  WHERE tipo = 'SOI' AND ativo = true;
  
  -- Mostrar valores atuais
  RAISE NOTICE 'Valores atuais:';
  RAISE NOTICE 'SPPRO - Soma atual: %', v_soma_sppro_atual;
  RAISE NOTICE 'SOI - Soma atual: %', v_soma_soi_atual;
  
  -- Calcular diferenças
  v_diferenca_sppro := v_soma_sppro_desejada - v_soma_sppro_atual;
  v_diferenca_soi := v_soma_soi_desejada - v_soma_soi_atual;
  
  RAISE NOTICE 'Diferenças necessárias:';
  RAISE NOTICE 'SPPRO - Diferença: %', v_diferenca_sppro;
  RAISE NOTICE 'SOI - Diferença: %', v_diferenca_soi;
  
  -- Contar estoques ativos por tipo
  SELECT COUNT(*) INTO v_total_estoques_sppro
  FROM public.estoques
  WHERE tipo = 'SPPRO' AND ativo = true;
  
  SELECT COUNT(*) INTO v_total_estoques_soi
  FROM public.estoques
  WHERE tipo = 'SOI' AND ativo = true;
  
  RAISE NOTICE 'Total de estoques:';
  RAISE NOTICE 'SPPRO: %, SOI: %', v_total_estoques_sppro, v_total_estoques_soi;
  
  -- Ajustar saldos SPPRO proporcionalmente
  IF v_total_estoques_sppro > 0 AND v_diferenca_sppro != 0 THEN
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
  
  -- Ajustar saldos SOI proporcionalmente
  IF v_total_estoques_soi > 0 AND v_diferenca_soi != 0 THEN
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

-- Verificar os valores finais
SELECT 
  tipo,
  COUNT(*) as total_estoques,
  SUM(saldo_atual) as soma_saldos,
  AVG(saldo_atual) as media_saldos,
  MIN(saldo_atual) as menor_saldo,
  MAX(saldo_atual) as maior_saldo
FROM public.estoques
WHERE ativo = true
GROUP BY tipo
ORDER BY tipo;

