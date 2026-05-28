-- Adicionar DEVOLUCOES como novo tipo de estoque
ALTER TABLE public.estoques 
  DROP CONSTRAINT IF EXISTS estoques_tipo_check;

ALTER TABLE public.estoques 
  ADD CONSTRAINT estoques_tipo_check 
  CHECK (tipo IN ('SPPRO', 'SOI', 'DEVOLUCOES'));

-- Criar estoque de devoluções para todas as empresas existentes
INSERT INTO public.estoques (empresa_id, tipo, descricao, saldo_atual, ativo)
SELECT 
  id as empresa_id,
  'DEVOLUCOES' as tipo,
  'Estoque de Devoluções' as descricao,
  0 as saldo_atual,
  true as ativo
FROM public.empresas
WHERE NOT EXISTS (
  SELECT 1 FROM public.estoques 
  WHERE estoques.empresa_id = empresas.id 
  AND estoques.tipo = 'DEVOLUCOES'
);

