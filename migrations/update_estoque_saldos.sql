-- ============================================
-- Script para atualizar saldos dos estoques
-- ============================================
-- Este script ajusta os saldos dos estoques para que
-- quando somados com a base no código, resultem nos valores desejados:
-- SPPRO: 9.939.582,93
-- SOI: 7.552.866,57
--
-- IMPORTANTE: Execute este script no Supabase SQL Editor
-- Substitua o empresa_id pelo ID correto da sua empresa

-- ============================================
-- 1. Verificar saldos atuais
-- ============================================
-- Execute esta query primeiro para ver os saldos atuais:
/*
SELECT 
  tipo,
  COUNT(*) as quantidade_estoques,
  SUM(saldo_atual) as saldo_total,
  AVG(saldo_atual) as saldo_medio
FROM public.estoques
WHERE empresa_id = 1 -- SUBSTITUA pelo seu empresa_id
  AND ativo = true
GROUP BY tipo;
*/

-- ============================================
-- 2. Calcular ajuste necessário
-- ============================================
-- Valores desejados finais:
-- SPPRO: 9.939.582,93
-- SOI: 7.552.866,57
--
-- Base atual no código (após atualização):
-- SPPRO: 9.789.176,89
-- SOI: 6.789.073,54
--
-- Portanto, a soma dos saldos dos estoques deve ser:
-- SPPRO: 9.939.582,93 - 9.789.176,89 = 150.406,04
-- SOI: 7.552.866,57 - 6.789.073,54 = 763.793,03

-- ============================================
-- 3. Opção A: Distribuir proporcionalmente entre os estoques existentes
-- ============================================
-- Esta opção mantém a proporção entre os estoques existentes
-- e ajusta todos proporcionalmente

DO $$
DECLARE
  v_empresa_id BIGINT := 1; -- SUBSTITUA pelo seu empresa_id
  v_saldo_total_sppro_atual NUMERIC;
  v_saldo_total_soi_atual NUMERIC;
  v_saldo_total_sppro_desejado NUMERIC := 150406.04;
  v_saldo_total_soi_desejado NUMERIC := 763793.03;
  v_fator_ajuste_sppro NUMERIC;
  v_fator_ajuste_soi NUMERIC;
BEGIN
  -- Calcular saldos atuais
  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_saldo_total_sppro_atual
  FROM public.estoques
  WHERE empresa_id = v_empresa_id
    AND tipo = 'SPPRO'
    AND ativo = true;
  
  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_saldo_total_soi_atual
  FROM public.estoques
  WHERE empresa_id = v_empresa_id
    AND tipo = 'SOI'
    AND ativo = true;
  
  -- Calcular fatores de ajuste
  IF v_saldo_total_sppro_atual > 0 THEN
    v_fator_ajuste_sppro := v_saldo_total_sppro_desejado / v_saldo_total_sppro_atual;
  ELSE
    v_fator_ajuste_sppro := 1;
  END IF;
  
  IF v_saldo_total_soi_atual > 0 THEN
    v_fator_ajuste_soi := v_saldo_total_soi_desejado / v_saldo_total_soi_atual;
  ELSE
    v_fator_ajuste_soi := 1;
  END IF;
  
  -- Atualizar saldos SPPRO proporcionalmente
  UPDATE public.estoques
  SET saldo_atual = ROUND(saldo_atual * v_fator_ajuste_sppro, 2),
      updated_at = NOW()
  WHERE empresa_id = v_empresa_id
    AND tipo = 'SPPRO'
    AND ativo = true;
  
  -- Atualizar saldos SOI proporcionalmente
  UPDATE public.estoques
  SET saldo_atual = ROUND(saldo_atual * v_fator_ajuste_soi, 2),
      updated_at = NOW()
  WHERE empresa_id = v_empresa_id
    AND tipo = 'SOI'
    AND ativo = true;
  
  RAISE NOTICE 'Saldos atualizados!';
  RAISE NOTICE 'SPPRO: Fator de ajuste = %', v_fator_ajuste_sppro;
  RAISE NOTICE 'SOI: Fator de ajuste = %', v_fator_ajuste_soi;
END $$;

-- ============================================
-- 4. Verificar resultado
-- ============================================
SELECT 
  tipo,
  COUNT(*) as quantidade_estoques,
  SUM(saldo_atual) as saldo_total,
  ROUND(AVG(saldo_atual), 2) as saldo_medio
FROM public.estoques
WHERE empresa_id = 1 -- SUBSTITUA pelo seu empresa_id
  AND ativo = true
GROUP BY tipo;

-- ============================================
-- 5. Opção B: Atualizar apenas o primeiro estoque de cada tipo
-- ============================================
-- Use esta opção se preferir ajustar apenas um estoque de cada tipo
-- Descomente e ajuste o empresa_id:

/*
-- Atualizar primeiro estoque SPPRO
UPDATE public.estoques
SET saldo_atual = 150406.04 - (
  SELECT COALESCE(SUM(saldo_atual), 0)
  FROM public.estoques
  WHERE empresa_id = 1
    AND tipo = 'SPPRO'
    AND ativo = true
    AND id != (SELECT MIN(id) FROM public.estoques WHERE empresa_id = 1 AND tipo = 'SPPRO' AND ativo = true)
),
updated_at = NOW()
WHERE id = (SELECT MIN(id) FROM public.estoques WHERE empresa_id = 1 AND tipo = 'SPPRO' AND ativo = true);

-- Atualizar primeiro estoque SOI
UPDATE public.estoques
SET saldo_atual = 763793.03 - (
  SELECT COALESCE(SUM(saldo_atual), 0)
  FROM public.estoques
  WHERE empresa_id = 1
    AND tipo = 'SOI'
    AND ativo = true
    AND id != (SELECT MIN(id) FROM public.estoques WHERE empresa_id = 1 AND tipo = 'SOI' AND ativo = true)
),
updated_at = NOW()
WHERE id = (SELECT MIN(id) FROM public.estoques WHERE empresa_id = 1 AND tipo = 'SOI' AND ativo = true);
*/

