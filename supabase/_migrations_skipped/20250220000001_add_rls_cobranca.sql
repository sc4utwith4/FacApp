-- ============================================
-- POLÍTICAS RLS - MÓDULO COBRANÇA BANCÁRIA
-- ============================================

-- Função helper para obter empresa_id do usuário
CREATE OR REPLACE FUNCTION get_user_empresa_id()
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    empresa_id UUID;
BEGIN
    SELECT p.empresa_id INTO empresa_id
    FROM profiles p
    WHERE p.id = auth.uid();
    
    RETURN empresa_id;
END;
$$;

-- 1. POLÍTICAS PARA carteiras_cobranca
DROP POLICY IF EXISTS "Users can view carteiras from their empresa" ON carteiras_cobranca;
CREATE POLICY "Users can view carteiras from their empresa"
    ON carteiras_cobranca FOR SELECT
    USING (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can insert carteiras in their empresa" ON carteiras_cobranca;
CREATE POLICY "Users can insert carteiras in their empresa"
    ON carteiras_cobranca FOR INSERT
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can update carteiras from their empresa" ON carteiras_cobranca;
CREATE POLICY "Users can update carteiras from their empresa"
    ON carteiras_cobranca FOR UPDATE
    USING (empresa_id = get_user_empresa_id())
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can delete carteiras from their empresa" ON carteiras_cobranca;
CREATE POLICY "Users can delete carteiras from their empresa"
    ON carteiras_cobranca FOR DELETE
    USING (empresa_id = get_user_empresa_id());

-- 2. POLÍTICAS PARA titulos_cobranca
DROP POLICY IF EXISTS "Users can view titulos from their empresa" ON titulos_cobranca;
CREATE POLICY "Users can view titulos from their empresa"
    ON titulos_cobranca FOR SELECT
    USING (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can insert titulos in their empresa" ON titulos_cobranca;
CREATE POLICY "Users can insert titulos in their empresa"
    ON titulos_cobranca FOR INSERT
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can update titulos from their empresa" ON titulos_cobranca;
CREATE POLICY "Users can update titulos from their empresa"
    ON titulos_cobranca FOR UPDATE
    USING (empresa_id = get_user_empresa_id())
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can delete titulos from their empresa" ON titulos_cobranca;
CREATE POLICY "Users can delete titulos from their empresa"
    ON titulos_cobranca FOR DELETE
    USING (empresa_id = get_user_empresa_id());

-- 3. POLÍTICAS PARA eventos_cobranca
-- Eventos são imutáveis após criação, mas permitimos leitura e inserção
DROP POLICY IF EXISTS "Users can view eventos from their empresa" ON eventos_cobranca;
CREATE POLICY "Users can view eventos from their empresa"
    ON eventos_cobranca FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM titulos_cobranca t
            WHERE t.id = eventos_cobranca.titulo_id
            AND t.empresa_id = get_user_empresa_id()
        )
    );

DROP POLICY IF EXISTS "Users can insert eventos in their empresa" ON eventos_cobranca;
CREATE POLICY "Users can insert eventos in their empresa"
    ON eventos_cobranca FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM titulos_cobranca t
            WHERE t.id = eventos_cobranca.titulo_id
            AND t.empresa_id = get_user_empresa_id()
        )
    );

-- Eventos são imutáveis - não permitir UPDATE ou DELETE
DROP POLICY IF EXISTS "Users cannot update eventos" ON eventos_cobranca;
DROP POLICY IF EXISTS "Users cannot delete eventos" ON eventos_cobranca;

-- 4. POLÍTICAS PARA fechamentos_diarios
DROP POLICY IF EXISTS "Users can view fechamentos from their empresa" ON fechamentos_diarios;
CREATE POLICY "Users can view fechamentos from their empresa"
    ON fechamentos_diarios FOR SELECT
    USING (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can insert fechamentos in their empresa" ON fechamentos_diarios;
CREATE POLICY "Users can insert fechamentos in their empresa"
    ON fechamentos_diarios FOR INSERT
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can update fechamentos from their empresa" ON fechamentos_diarios;
CREATE POLICY "Users can update fechamentos from their empresa"
    ON fechamentos_diarios FOR UPDATE
    USING (empresa_id = get_user_empresa_id())
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can delete fechamentos from their empresa" ON fechamentos_diarios;
CREATE POLICY "Users can delete fechamentos from their empresa"
    ON fechamentos_diarios FOR DELETE
    USING (empresa_id = get_user_empresa_id());

-- 5. POLÍTICAS PARA fila_ocorrencias
DROP POLICY IF EXISTS "Users can view fila from their empresa" ON fila_ocorrencias;
CREATE POLICY "Users can view fila from their empresa"
    ON fila_ocorrencias FOR SELECT
    USING (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can insert fila in their empresa" ON fila_ocorrencias;
CREATE POLICY "Users can insert fila in their empresa"
    ON fila_ocorrencias FOR INSERT
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can update fila from their empresa" ON fila_ocorrencias;
CREATE POLICY "Users can update fila from their empresa"
    ON fila_ocorrencias FOR UPDATE
    USING (empresa_id = get_user_empresa_id())
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can delete fila from their empresa" ON fila_ocorrencias;
CREATE POLICY "Users can delete fila from their empresa"
    ON fila_ocorrencias FOR DELETE
    USING (empresa_id = get_user_empresa_id());

-- 6. POLÍTICAS PARA importacoes_cobranca
DROP POLICY IF EXISTS "Users can view importacoes from their empresa" ON importacoes_cobranca;
CREATE POLICY "Users can view importacoes from their empresa"
    ON importacoes_cobranca FOR SELECT
    USING (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can insert importacoes in their empresa" ON importacoes_cobranca;
CREATE POLICY "Users can insert importacoes in their empresa"
    ON importacoes_cobranca FOR INSERT
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can update importacoes from their empresa" ON importacoes_cobranca;
CREATE POLICY "Users can update importacoes from their empresa"
    ON importacoes_cobranca FOR UPDATE
    USING (empresa_id = get_user_empresa_id())
    WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can delete importacoes from their empresa" ON importacoes_cobranca;
CREATE POLICY "Users can delete importacoes from their empresa"
    ON importacoes_cobranca FOR DELETE
    USING (empresa_id = get_user_empresa_id());

