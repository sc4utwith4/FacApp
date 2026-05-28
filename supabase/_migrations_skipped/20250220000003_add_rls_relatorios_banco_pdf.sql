-- ============================================
-- POLÍTICAS RLS - RELATÓRIOS BANCO PDF
-- ============================================

-- 1. POLÍTICAS PARA relatorios_banco_pdf
DROP POLICY IF EXISTS "Users can view relatorios from their empresa" ON relatorios_banco_pdf;
CREATE POLICY "Users can view relatorios from their empresa"
    ON relatorios_banco_pdf FOR SELECT
    USING (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can insert relatorios in their empresa" ON relatorios_banco_pdf;
CREATE POLICY "Users can insert relatorios in their empresa"
    ON relatorios_banco_pdf FOR INSERT
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can update relatorios from their empresa" ON relatorios_banco_pdf;
CREATE POLICY "Users can update relatorios from their empresa"
    ON relatorios_banco_pdf FOR UPDATE
    USING (empresa_id = get_user_empresa_id())
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can delete relatorios from their empresa" ON relatorios_banco_pdf;
CREATE POLICY "Users can delete relatorios from their empresa"
    ON relatorios_banco_pdf FOR DELETE
    USING (empresa_id = get_user_empresa_id());

