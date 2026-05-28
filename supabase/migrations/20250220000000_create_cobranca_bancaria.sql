-- ============================================
-- MÓDULO CONTROLE DE COBRANÇA BANCÁRIA
-- Criação completa do schema do módulo
-- ============================================

-- 1. TABELA: Carteiras de Cobrança
CREATE TABLE IF NOT EXISTS carteiras_cobranca (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    banco_id INTEGER REFERENCES bancos(id) ON DELETE SET NULL,
    agencia VARCHAR(20),
    conta VARCHAR(50),
    convenio VARCHAR(50),
    carteira VARCHAR(50),
    beneficiario_razao_social VARCHAR(255) NOT NULL,
    beneficiario_cnpj VARCHAR(18),
    regras_juros_multa JSONB DEFAULT '{}',
    parametros_cobranca JSONB DEFAULT '{}',
    status BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. TABELA: Títulos de Cobrança
CREATE TABLE IF NOT EXISTS titulos_cobranca (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    carteira_id UUID REFERENCES carteiras_cobranca(id) ON DELETE SET NULL,
    operacao_id UUID REFERENCES operacoes(id) ON DELETE SET NULL,
    identificador_interno VARCHAR(100),
    nosso_numero VARCHAR(50),
    seu_numero VARCHAR(50),
    sacado_nome VARCHAR(255),
    sacado_documento VARCHAR(20),
    sacado_contato JSONB DEFAULT '{}',
    valor_nominal DECIMAL(15,2) NOT NULL,
    vencimento DATE NOT NULL,
    data_emissao DATE,
    status_atual VARCHAR(50) NOT NULL DEFAULT 'ABERTO' CHECK (
        status_atual IN (
            'ABERTO', 'LIQUIDADO', 'BAIXADO', 'DEVOLVIDO', 
            'PROTESTO_INSTRUIDO', 'EM_CARTORIO', 'ACORDO_DESCONTO', 'DIVERGENCIA'
        )
    ),
    tags TEXT[] DEFAULT '{}',
    cliente_codigo VARCHAR(50),
    registrado_banco BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. TABELA: Eventos de Cobrança (Histórico Imutável)
CREATE TABLE IF NOT EXISTS eventos_cobranca (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    titulo_id UUID REFERENCES titulos_cobranca(id) ON DELETE CASCADE NOT NULL,
    carteira_id UUID REFERENCES carteiras_cobranca(id) ON DELETE SET NULL,
    tipo_evento VARCHAR(50) NOT NULL CHECK (
        tipo_evento IN (
            'REGISTRO', 'ENTRADA', 'LIQUIDACAO', 'BAIXA', 'DEVOLUCAO', 
            'PROTESTO', 'CARTORIO', 'DESCONTO_CONCEDIDO', 'TARIFA', 'AJUSTE_MANUAL'
        )
    ),
    data_evento TIMESTAMP NOT NULL,
    data_referencia DATE,
    codigo_banco VARCHAR(20),
    descricao_banco TEXT,
    valor_principal DECIMAL(15,2) DEFAULT 0,
    juros DECIMAL(15,2) DEFAULT 0,
    multa DECIMAL(15,2) DEFAULT 0,
    desconto DECIMAL(15,2) DEFAULT 0,
    abatimento DECIMAL(15,2) DEFAULT 0,
    tarifa DECIMAL(15,2) DEFAULT 0,
    valor_liquido DECIMAL(15,2) DEFAULT 0,
    origem JSONB DEFAULT '{}',
    conciliado BOOLEAN DEFAULT false,
    confianca_conciliacao INTEGER DEFAULT 0 CHECK (confianca_conciliacao >= 0 AND confianca_conciliacao <= 100),
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. TABELA: Fechamentos Diários
CREATE TABLE IF NOT EXISTS fechamentos_diarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    data_fechamento DATE NOT NULL,
    saldo_anterior_qtd INTEGER DEFAULT 0,
    saldo_anterior_valor DECIMAL(15,2) DEFAULT 0,
    entradas_qtd INTEGER DEFAULT 0,
    entradas_valor DECIMAL(15,2) DEFAULT 0,
    baixas_qtd INTEGER DEFAULT 0,
    baixas_valor DECIMAL(15,2) DEFAULT 0,
    saldo_atual_qtd INTEGER DEFAULT 0,
    saldo_atual_valor DECIMAL(15,2) DEFAULT 0,
    indicadores JSONB DEFAULT '{}',
    confirmado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    confirmado_em TIMESTAMP,
    exportado_pdf_url TEXT,
    exportado_excel_url TEXT,
    validado_contra_banco BOOLEAN DEFAULT false,
    divergencia_valor DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(empresa_id, data_fechamento)
);

-- 5. TABELA: Fila de Ocorrências
CREATE TABLE IF NOT EXISTS fila_ocorrencias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    titulo_id UUID REFERENCES titulos_cobranca(id) ON DELETE SET NULL,
    data_ocorrencia DATE NOT NULL,
    identificador VARCHAR(100),
    acao VARCHAR(255),
    status_motivo VARCHAR(100),
    valor DECIMAL(15,2),
    observacoes TEXT,
    tags TEXT[] DEFAULT '{}',
    referencia_cruzada JSONB DEFAULT '{}',
    valor_ref DECIMAL(15,2),
    resolvido BOOLEAN DEFAULT false,
    resolvido_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    resolvido_em TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 6. TABELA: Importações de Cobrança
CREATE TABLE IF NOT EXISTS importacoes_cobranca (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    tipo_importacao VARCHAR(20) NOT NULL CHECK (tipo_importacao IN ('PDF', 'PLANILHA', 'CNAB')),
    arquivo_nome VARCHAR(255) NOT NULL,
    arquivo_url TEXT,
    arquivo_hash VARCHAR(64),
    total_registros INTEGER DEFAULT 0,
    registros_processados INTEGER DEFAULT 0,
    registros_erro INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'processando' CHECK (status IN ('processando', 'concluido', 'erro')),
    erros JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 7. ÍNDICES PARA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_titulos_identificador ON titulos_cobranca(identificador_interno);
CREATE INDEX IF NOT EXISTS idx_titulos_nosso_numero ON titulos_cobranca(nosso_numero);
CREATE INDEX IF NOT EXISTS idx_titulos_status ON titulos_cobranca(status_atual);
CREATE INDEX IF NOT EXISTS idx_titulos_vencimento ON titulos_cobranca(vencimento);
CREATE INDEX IF NOT EXISTS idx_titulos_operacao ON titulos_cobranca(operacao_id);
CREATE INDEX IF NOT EXISTS idx_titulos_empresa ON titulos_cobranca(empresa_id);
CREATE INDEX IF NOT EXISTS idx_titulos_carteira ON titulos_cobranca(carteira_id);

CREATE INDEX IF NOT EXISTS idx_eventos_titulo ON eventos_cobranca(titulo_id);
CREATE INDEX IF NOT EXISTS idx_eventos_data ON eventos_cobranca(data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_eventos_tipo ON eventos_cobranca(tipo_evento);
CREATE INDEX IF NOT EXISTS idx_eventos_conciliado ON eventos_cobranca(conciliado);

CREATE INDEX IF NOT EXISTS idx_fila_resolvido ON fila_ocorrencias(resolvido);
CREATE INDEX IF NOT EXISTS idx_fila_data ON fila_ocorrencias(data_ocorrencia DESC);
CREATE INDEX IF NOT EXISTS idx_fila_status ON fila_ocorrencias(status_motivo);
CREATE INDEX IF NOT EXISTS idx_fila_empresa ON fila_ocorrencias(empresa_id);

CREATE INDEX IF NOT EXISTS idx_fechamentos_empresa_data ON fechamentos_diarios(empresa_id, data_fechamento DESC);
CREATE INDEX IF NOT EXISTS idx_importacoes_empresa ON importacoes_cobranca(empresa_id);
CREATE INDEX IF NOT EXISTS idx_importacoes_status ON importacoes_cobranca(status);

CREATE INDEX IF NOT EXISTS idx_carteiras_empresa ON carteiras_cobranca(empresa_id);

-- 8. TRIGGERS PARA updated_at
CREATE TRIGGER update_carteiras_cobranca_updated_at BEFORE UPDATE ON carteiras_cobranca
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_titulos_cobranca_updated_at BEFORE UPDATE ON titulos_cobranca
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fechamentos_diarios_updated_at BEFORE UPDATE ON fechamentos_diarios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fila_ocorrencias_updated_at BEFORE UPDATE ON fila_ocorrencias
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_importacoes_cobranca_updated_at BEFORE UPDATE ON importacoes_cobranca
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. HABILITAR RLS
ALTER TABLE carteiras_cobranca ENABLE ROW LEVEL SECURITY;
ALTER TABLE titulos_cobranca ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_cobranca ENABLE ROW LEVEL SECURITY;
ALTER TABLE fechamentos_diarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE fila_ocorrencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE importacoes_cobranca ENABLE ROW LEVEL SECURITY;

