-- ============================================
-- Atualizar constraint de natureza em grupos_contas
-- para permitir 'escrito_imob' e 'aplic'
-- ============================================

-- Remover a constraint antiga
ALTER TABLE public.grupos_contas
DROP CONSTRAINT IF EXISTS grupos_contas_natureza_check;

-- Adicionar nova constraint que permite os novos valores
ALTER TABLE public.grupos_contas
ADD CONSTRAINT grupos_contas_natureza_check 
CHECK (natureza IN ('entrada', 'saida', 'escrito_imob', 'aplic'));

-- Atualizar o tamanho do VARCHAR se necessário (de 10 para 15 para acomodar 'escrito_imob')
ALTER TABLE public.grupos_contas
ALTER COLUMN natureza TYPE VARCHAR(15);

-- Comentário para documentação
COMMENT ON COLUMN public.grupos_contas.natureza IS 'Natureza do grupo: entrada, saida, escrito_imob ou aplic';

