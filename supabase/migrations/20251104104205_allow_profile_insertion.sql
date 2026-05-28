-- ============================================
-- PERMITIR INSERÇÃO DE PROFILES
-- ============================================

-- Adicionar política para permitir que usuários criem seu próprio perfil
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT
    WITH CHECK (
        (SELECT auth.role()) = 'authenticated' AND
        id = (SELECT auth.uid())
    );;
