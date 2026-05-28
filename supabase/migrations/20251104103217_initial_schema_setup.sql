-- ============================================
-- MIGRAÇÃO INICIAL - ASSFAC Platform
-- Criação completa do schema do banco de dados
-- ============================================

-- 1. EXTENSÕES NECESSÁRIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABELAS PRINCIPAIS

-- Tabela de Empresas
CREATE TABLE IF NOT EXISTS empresas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(255) NOT NULL,
    razao_social VARCHAR(255),
    cnpj VARCHAR(18) UNIQUE,
    inscricao_estadual VARCHAR(20),
    email VARCHAR(255),
    telefone VARCHAR(20),
    endereco JSONB,
    status BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Perfis de Usuários
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    perfil VARCHAR(50) DEFAULT 'Operacional', -- 'Admin', 'Financeiro', 'Operacional'
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Bancos Brasileiros
CREATE TABLE IF NOT EXISTS bancos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(10) UNIQUE NOT NULL,
    nome VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Contas Bancárias
CREATE TABLE IF NOT EXISTS contas_bancarias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    banco_id INTEGER REFERENCES bancos(id) ON DELETE SET NULL,
    agencia VARCHAR(20),
    conta VARCHAR(50),
    descricao VARCHAR(255),
    saldo_inicial DECIMAL(15,2) DEFAULT 0,
    status BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Grupos de Contas
CREATE TABLE IF NOT EXISTS grupos_contas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    nome VARCHAR(255) NOT NULL,
    natureza VARCHAR(10) NOT NULL CHECK (natureza IN ('entrada', 'saida')),
    descricao TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Clientes
CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('fisica', 'juridica')),
    nome VARCHAR(255) NOT NULL,
    razao_social VARCHAR(255),
    documento VARCHAR(20) NOT NULL, -- CPF ou CNPJ
    inscricao_estadual VARCHAR(20),
    email VARCHAR(255),
    telefone VARCHAR(20),
    celular VARCHAR(20),
    endereco JSONB,
    status BOOLEAN DEFAULT true,
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Fornecedores
CREATE TABLE IF NOT EXISTS fornecedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    razao_social VARCHAR(255) NOT NULL,
    nome_fantasia VARCHAR(255),
    cnpj VARCHAR(18) UNIQUE,
    inscricao_estadual VARCHAR(20),
    email VARCHAR(255),
    telefone VARCHAR(20),
    endereco JSONB,
    categoria VARCHAR(100),
    status BOOLEAN DEFAULT true,
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Lançamentos de Caixa
CREATE TABLE IF NOT EXISTS lancamentos_caixa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    conta_bancaria_id UUID REFERENCES contas_bancarias(id) ON DELETE SET NULL,
    grupo_contas_id UUID REFERENCES grupos_contas(id) ON DELETE SET NULL,
    data DATE NOT NULL,
    historico TEXT NOT NULL,
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada', 'saida')),
    valor DECIMAL(15,2) NOT NULL CHECK (valor >= 0),
    documento VARCHAR(100),
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Operações Complexas
CREATE TABLE IF NOT EXISTS operacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE NOT NULL,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    fornecedor_id UUID REFERENCES fornecedores(id) ON DELETE SET NULL,
    data DATE NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    descricao TEXT,
    valor_total DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pendente',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Rateio de Despesas
CREATE TABLE IF NOT EXISTS despesas_operacao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operacao_id UUID REFERENCES operacoes(id) ON DELETE CASCADE NOT NULL,
    grupo_contas_id UUID REFERENCES grupos_contas(id) ON DELETE SET NULL,
    valor DECIMAL(15,2) NOT NULL,
    percentual DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Cheques
CREATE TABLE IF NOT EXISTS cheques (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conta_bancaria_id UUID REFERENCES contas_bancarias(id) ON DELETE CASCADE NOT NULL,
    numero VARCHAR(50) NOT NULL,
    valor DECIMAL(15,2) NOT NULL,
    data_emissao DATE,
    data_vencimento DATE,
    favorecido VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pendente',
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Estados Brasileiros (UF)
CREATE TABLE IF NOT EXISTS ufs (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(2) UNIQUE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. ÍNDICES PARA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_lancamentos_data ON lancamentos_caixa(data DESC);
CREATE INDEX IF NOT EXISTS idx_lancamentos_conta ON lancamentos_caixa(conta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_empresa ON lancamentos_caixa(empresa_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_tipo ON lancamentos_caixa(tipo);
CREATE INDEX IF NOT EXISTS idx_operacoes_data ON operacoes(data DESC);
CREATE INDEX IF NOT EXISTS idx_operacoes_empresa ON operacoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON clientes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_fornecedores_empresa ON fornecedores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contas_empresa ON contas_bancarias(empresa_id);
CREATE INDEX IF NOT EXISTS idx_grupos_empresa ON grupos_contas(empresa_id);

-- 4. TRIGGER PARA updated_at AUTOMÁTICO
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger em todas as tabelas com updated_at
CREATE TRIGGER update_empresas_updated_at BEFORE UPDATE ON empresas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contas_bancarias_updated_at BEFORE UPDATE ON contas_bancarias
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_grupos_contas_updated_at BEFORE UPDATE ON grupos_contas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fornecedores_updated_at BEFORE UPDATE ON fornecedores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lancamentos_caixa_updated_at BEFORE UPDATE ON lancamentos_caixa
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_operacoes_updated_at BEFORE UPDATE ON operacoes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cheques_updated_at BEFORE UPDATE ON cheques
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. ENABLE ROW LEVEL SECURITY
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupos_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE lancamentos_caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE operacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas_operacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;

-- 6. POLÍTICAS RLS BÁSICAS (Permitir tudo para usuários autenticados - ajustar conforme necessário)
-- Por enquanto, políticas básicas. Em produção, ajustar conforme regras de negócio.

-- Políticas para empresas
CREATE POLICY "Users can view own empresa" ON empresas FOR SELECT
    USING (true);

CREATE POLICY "Authenticated users can manage empresas" ON empresas FOR ALL
    USING (auth.role() = 'authenticated');

-- Políticas para profiles
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
    USING (auth.uid() = id);

-- Políticas para contas_bancarias
CREATE POLICY "Authenticated users can manage contas_bancarias" ON contas_bancarias FOR ALL
    USING (auth.role() = 'authenticated');

-- Políticas para grupos_contas
CREATE POLICY "Authenticated users can manage grupos_contas" ON grupos_contas FOR ALL
    USING (auth.role() = 'authenticated');

-- Políticas para clientes
CREATE POLICY "Authenticated users can manage clientes" ON clientes FOR ALL
    USING (auth.role() = 'authenticated');

-- Políticas para fornecedores
CREATE POLICY "Authenticated users can manage fornecedores" ON fornecedores FOR ALL
    USING (auth.role() = 'authenticated');

-- Políticas para lancamentos_caixa
CREATE POLICY "Authenticated users can manage lancamentos_caixa" ON lancamentos_caixa FOR ALL
    USING (auth.role() = 'authenticated');

-- Políticas para operacoes
CREATE POLICY "Authenticated users can manage operacoes" ON operacoes FOR ALL
    USING (auth.role() = 'authenticated');

-- Políticas para despesas_operacao
CREATE POLICY "Authenticated users can manage despesas_operacao" ON despesas_operacao FOR ALL
    USING (auth.role() = 'authenticated');

-- Políticas para cheques
CREATE POLICY "Authenticated users can manage cheques" ON cheques FOR ALL
    USING (auth.role() = 'authenticated');

-- Tabelas públicas (sem RLS necessário)
-- bancos e ufs são dados de referência públicos;
