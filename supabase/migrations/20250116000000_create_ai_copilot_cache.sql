-- ============================================
-- MIGRAÇÃO: Tabela de Cache do IA Copilot
-- Armazena respostas cacheadas para melhorar performance
-- ============================================

-- Tabela de cache
CREATE TABLE IF NOT EXISTS ai_copilot_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key VARCHAR(255) UNIQUE NOT NULL,
    cache_value JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Garantir que cache_key seja único
    CONSTRAINT unique_cache_key UNIQUE (cache_key)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_ai_copilot_cache_key ON ai_copilot_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_cache_expires_at ON ai_copilot_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_cache_created_at ON ai_copilot_cache(created_at DESC);

-- Função para limpar cache expirado
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM ai_copilot_cache
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para obter cache válido
CREATE OR REPLACE FUNCTION get_cache_value(p_cache_key VARCHAR)
RETURNS JSONB AS $$
DECLARE
    v_value JSONB;
BEGIN
    SELECT cache_value INTO v_value
    FROM ai_copilot_cache
    WHERE cache_key = p_cache_key
      AND expires_at > NOW()
    LIMIT 1;
    
    RETURN v_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para definir cache
CREATE OR REPLACE FUNCTION set_cache_value(
    p_cache_key VARCHAR,
    p_cache_value JSONB,
    p_ttl_seconds INTEGER DEFAULT 3600
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO ai_copilot_cache (cache_key, cache_value, expires_at)
    VALUES (p_cache_key, p_cache_value, NOW() + (p_ttl_seconds || ' seconds')::INTERVAL)
    ON CONFLICT (cache_key) 
    DO UPDATE SET 
        cache_value = EXCLUDED.cache_value,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS desabilitado para cache (chaves são hashadas, não contêm dados sensíveis)
-- Mas podemos habilitar se necessário no futuro
ALTER TABLE ai_copilot_cache ENABLE ROW LEVEL SECURITY;

-- Política permissiva para cache (pode ser acessado por qualquer usuário autenticado)
-- Como as chaves são hashadas, não há risco de exposição de dados
CREATE POLICY "Allow authenticated users to read cache"
    ON ai_copilot_cache
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated users to write cache"
    ON ai_copilot_cache
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update cache"
    ON ai_copilot_cache
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete cache"
    ON ai_copilot_cache
    FOR DELETE
    TO authenticated
    USING (true);

-- Comentários para documentação
COMMENT ON TABLE ai_copilot_cache IS 'Cache persistente para respostas do IA Copilot';
COMMENT ON COLUMN ai_copilot_cache.cache_key IS 'Chave única do cache (hash da pergunta + conversationId)';
COMMENT ON COLUMN ai_copilot_cache.cache_value IS 'Valor cacheado em formato JSONB';
COMMENT ON COLUMN ai_copilot_cache.expires_at IS 'Data/hora de expiração do cache';
COMMENT ON FUNCTION cleanup_expired_cache() IS 'Remove entradas de cache expiradas, retorna número de registros deletados';
COMMENT ON FUNCTION get_cache_value(VARCHAR) IS 'Obtém valor do cache se ainda válido (não expirado)';
COMMENT ON FUNCTION set_cache_value(VARCHAR, JSONB, INTEGER) IS 'Define ou atualiza valor no cache com TTL em segundos';

