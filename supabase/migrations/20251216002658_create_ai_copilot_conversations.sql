-- ============================================
-- MIGRAÇÃO: Tabela de Conversas do IA Copilot
-- Armazena histórico de conversas do assistente de IA
-- ============================================

-- Tabela principal de conversas
CREATE TABLE IF NOT EXISTS ai_copilot_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    conversation_id UUID NOT NULL,
    title VARCHAR(255), -- Título gerado automaticamente ou pelo usuário
    messages JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array de mensagens
    message_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Garantir que cada conversation_id seja único por usuário
    CONSTRAINT unique_conversation_per_user UNIQUE (user_id, conversation_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_ai_copilot_conversations_user_id ON ai_copilot_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_conversations_empresa_id ON ai_copilot_conversations(empresa_id);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_conversations_conversation_id ON ai_copilot_conversations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_conversations_last_message_at ON ai_copilot_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_conversations_created_at ON ai_copilot_conversations(created_at DESC);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_ai_copilot_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ai_copilot_conversations_updated_at
    BEFORE UPDATE ON ai_copilot_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_copilot_conversations_updated_at();

-- Row Level Security (RLS)
ALTER TABLE ai_copilot_conversations ENABLE ROW LEVEL SECURITY;

-- Política: Usuários só podem ver suas próprias conversas
CREATE POLICY "Users can view their own conversations"
    ON ai_copilot_conversations
    FOR SELECT
    USING (auth.uid() = user_id);

-- Política: Usuários só podem criar conversas para si mesmos
CREATE POLICY "Users can insert their own conversations"
    ON ai_copilot_conversations
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Política: Usuários só podem atualizar suas próprias conversas
CREATE POLICY "Users can update their own conversations"
    ON ai_copilot_conversations
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Política: Usuários só podem deletar suas próprias conversas
CREATE POLICY "Users can delete their own conversations"
    ON ai_copilot_conversations
    FOR DELETE
    USING (auth.uid() = user_id);

-- Função helper para obter empresa_id do usuário
CREATE OR REPLACE FUNCTION get_user_empresa_id()
RETURNS UUID AS $$
DECLARE
    user_empresa_id UUID;
BEGIN
    SELECT empresa_id INTO user_empresa_id
    FROM profiles
    WHERE id = auth.uid();
    
    RETURN user_empresa_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentários para documentação
COMMENT ON TABLE ai_copilot_conversations IS 'Armazena histórico de conversas do IA Copilot por usuário';
COMMENT ON COLUMN ai_copilot_conversations.conversation_id IS 'ID único da conversa (UUID gerado no frontend)';
COMMENT ON COLUMN ai_copilot_conversations.messages IS 'Array JSON com todas as mensagens da conversa';
COMMENT ON COLUMN ai_copilot_conversations.title IS 'Título da conversa (gerado automaticamente ou definido pelo usuário)';

