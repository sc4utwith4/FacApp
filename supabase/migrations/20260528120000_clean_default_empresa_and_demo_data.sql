-- ============================================
-- LIMPEZA: remove identidade ASSFAC do tenant padrão e dados de demonstração
-- ============================================
-- Objetivo: deixar a aplicação sem nenhuma afiliação à empresa antiga e sem
-- dados de exemplo, mantendo o tenant estrutural (UUID ...0001) como slot em
-- branco pronto para a empresa nova. Idempotente e defensivo: só altera linhas
-- que ainda correspondem à identidade/dados demo originais.
-- ============================================

DO $$
DECLARE
    v_empresa UUID := '00000000-0000-0000-0000-000000000001'::uuid;
BEGIN
    -- 1. Remover lançamentos de demonstração (vinculados às contas demo).
    DELETE FROM public.lancamentos_caixa lc
    USING public.contas_bancarias cb
    WHERE lc.conta_bancaria_id = cb.id
      AND cb.empresa_id = v_empresa
      AND cb.descricao IN (
          'Conta Corrente Principal - BB',
          'Conta Corrente - CEF',
          'Conta Corrente - Bradesco'
      );

    -- 2. Remover as contas bancárias de demonstração.
    DELETE FROM public.contas_bancarias
    WHERE empresa_id = v_empresa
      AND descricao IN (
          'Conta Corrente Principal - BB',
          'Conta Corrente - CEF',
          'Conta Corrente - Bradesco'
      );

    -- 3. Zerar a identidade ASSFAC do tenant padrão (só se ainda for a original).
    UPDATE public.empresas
    SET nome = 'Minha Empresa',
        razao_social = NULL,
        cnpj = NULL,
        email = NULL,
        telefone = NULL,
        updated_at = NOW()
    WHERE id = v_empresa
      AND (
          nome = 'ASSFAC Platform'
          OR email = 'contato@assfac.com.br'
          OR cnpj = '12345678000190'
      );

    RAISE NOTICE 'Limpeza concluída: tenant padrão neutralizado e dados demo removidos.';
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'Skipped limpeza: tabela ainda não existe';
WHEN OTHERS THEN
    RAISE NOTICE 'Skipped limpeza: %', SQLERRM;
END $$;
