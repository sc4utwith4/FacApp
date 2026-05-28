-- ============================================
-- TABELA: Relatórios Banco PDF
-- Armazena PDFs de relatórios bancários (Posição de Carteira)
-- com dados extraídos e histórico de versões
-- ============================================

CREATE TABLE IF NOT EXISTS relatorios_banco_pdf (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    fechamento_id UUID REFERENCES fechamentos_diarios(id) ON DELETE SET NULL,
    banco_id INTEGER REFERENCES bancos(id) ON DELETE SET NULL,
    
    -- Metadados do arquivo
    arquivo_nome VARCHAR(255) NOT NULL,
    arquivo_url TEXT NOT NULL, -- URL no Supabase Storage
    arquivo_hash VARCHAR(64), -- SHA-256 para detecção de duplicatas
    arquivo_tamanho BIGINT,
    data_upload TIMESTAMP DEFAULT NOW(),
    uploaded_by UUID REFERENCES auth.users(id),
    
    -- Dados da Consulta (extraídos do PDF)
    agencia VARCHAR(20),
    conta VARCHAR(50),
    beneficiario_nome VARCHAR(255),
    beneficiario_razao VARCHAR(50),
    data_operacao DATE,
    hora_operacao TIME,
    
    -- Posição de Carteira (extraídos do PDF)
    saldo_anterior_qtd INTEGER,
    saldo_anterior_valor DECIMAL(15,2),
    saldo_entradas_qtd INTEGER,
    saldo_entradas_valor DECIMAL(15,2),
    saldo_baixas_qtd INTEGER,
    saldo_baixas_valor DECIMAL(15,2),
    saldo_atual_qtd INTEGER,
    saldo_atual_valor DECIMAL(15,2),
    registrados_mes_qtd INTEGER,
    registrados_mes_valor DECIMAL(15,2),
    registrados_mes_anterior_qtd INTEGER,
    registrados_mes_anterior_valor DECIMAL(15,2),
    acumulados_pagos_mes_qtd INTEGER,
    acumulados_pagos_mes_valor DECIMAL(15,2),
    acumulados_nao_pagos_mes_qtd INTEGER,
    acumulados_nao_pagos_mes_valor DECIMAL(15,2),
    acumulados_pagos_compensacao_mes_qtd INTEGER,
    acumulados_pagos_compensacao_mes_valor DECIMAL(15,2),
    pagos_mes_anterior_qtd INTEGER,
    pagos_mes_anterior_valor DECIMAL(15,2),
    pagos_compensacao_mes_anterior_qtd INTEGER,
    pagos_compensacao_mes_anterior_valor DECIMAL(15,2),
    titulos_instrucao_protesto_qtd INTEGER,
    titulos_instrucao_protesto_valor DECIMAL(15,2),
    titulos_poder_cartorio_qtd INTEGER,
    titulos_poder_cartorio_valor DECIMAL(15,2),
    
    -- Índice Liquidez
    liquidez_diaria_percent DECIMAL(5,2),
    liquidez_mensal_percent DECIMAL(5,2),
    
    -- Validação
    validado_contra_fechamento BOOLEAN DEFAULT false,
    divergencia_valor DECIMAL(15,2) DEFAULT 0,
    divergencia_qtd INTEGER DEFAULT 0,
    divergencias_detalhadas JSONB DEFAULT '{}', -- Detalhes das divergências
    validado_em TIMESTAMP,
    validado_por UUID REFERENCES auth.users(id),
    
    -- Histórico
    versao INTEGER DEFAULT 1, -- Versão do PDF para o mesmo fechamento
    versao_anterior_id UUID REFERENCES relatorios_banco_pdf(id), -- Link para versão anterior
    
    -- Status
    status VARCHAR(20) DEFAULT 'processando', -- 'processando', 'extraido', 'validado', 'erro'
    observacoes TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_relatorios_banco_empresa ON relatorios_banco_pdf(empresa_id);
CREATE INDEX idx_relatorios_banco_fechamento ON relatorios_banco_pdf(fechamento_id);
CREATE INDEX idx_relatorios_banco_data_upload ON relatorios_banco_pdf(data_upload DESC);
CREATE UNIQUE INDEX idx_relatorios_banco_hash ON relatorios_banco_pdf(arquivo_hash) WHERE arquivo_hash IS NOT NULL;
CREATE INDEX idx_relatorios_banco_versao_anterior ON relatorios_banco_pdf(versao_anterior_id);

-- Trigger para updated_at
CREATE TRIGGER update_relatorios_banco_pdf_updated_at
    BEFORE UPDATE ON relatorios_banco_pdf
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

