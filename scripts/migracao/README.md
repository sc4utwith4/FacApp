# Scripts de Migração - Access para PostgreSQL

Este diretório contém todos os scripts necessários para migrar dados do Microsoft Access (.mdb) para Supabase/PostgreSQL.

## Estrutura

```
scripts/migracao/
├── README.md                    # Este arquivo
├── requirements.txt             # Dependências Python
├── transform_config.json        # Configuração de transformação
├── extract_mdb_data.py          # Extração de dados do Access
├── analyze_structure.py         # Análise de estrutura
├── transform_data.py           # Transformação e limpeza
├── validate_data.py            # Validação de dados
├── migrate_to_supabase.ts       # Migração para Supabase
├── rollback_migration.ts       # Rollback de migração
└── logs/                       # Logs de execução
```

## Pré-requisitos

### Python 3.8+

```bash
# Verificar versão
python3 --version

# Instalar dependências
pip install -r requirements.txt
```

### Ferramentas de Extração

**Opção 1: mdb-tools (Recomendado para macOS/Linux)**

```bash
# macOS
brew install mdb-tools

# Linux (Ubuntu/Debian)
sudo apt-get install mdb-tools

# Verificar instalação
mdb-version
```

**Opção 2: pyodbc (Windows ou com driver Access)**

```bash
pip install pyodbc
# Requer driver Microsoft Access Driver instalado
```

### Node.js/TypeScript

```bash
# Verificar versão
node --version
npm --version

# Instalar ts-node globalmente (se necessário)
npm install -g ts-node typescript
```

## Variáveis de Ambiente

Criar arquivo `.env.local` na raiz do projeto:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
```

**IMPORTANTE**: Use `SERVICE_ROLE_KEY` (não a chave pública) para bypass de RLS durante migração.

## Uso

### 1. Extrair Dados do Access

```bash
# Extrair dados de todos os arquivos .mdb
python scripts/migracao/extract_mdb_data.py

# Ou usando npm script
npm run migrate:extract
```

**Saída**: 
- `docs/migracao/dados_extraidos/{arquivo}/` - Dados extraídos (JSON e CSV)
- `docs/migracao/estrutura_access.json` - Estrutura dos bancos

### 2. Analisar Estrutura

```bash
# Gerar documentação da estrutura
python scripts/migracao/analyze_structure.py

# Ou usando npm script
npm run migrate:analyze
```

**Saída**:
- `docs/migracao/estrutura_access.md` - Documentação Markdown
- `docs/migracao/estrutura_resumo.json` - Resumo JSON

### 3. Transformar Dados

```bash
# Transformar e limpar dados
python scripts/migracao/transform_data.py

# Ou usando npm script
npm run migrate:transform
```

**Saída**:
- `docs/migracao/dados_extraidos/transformed/` - Dados transformados
- `docs/migracao/dados_extraidos/mappings/` - Mapeamentos de IDs

### 4. Validar Dados

```bash
# Validar dados extraídos
python scripts/migracao/validate_data.py

# Ou usando npm script
npm run migrate:validate
```

**Saída**:
- `docs/migracao/validacao_resultados.json` - Resultados da validação
- `docs/migracao/validacao_relatorio.md` - Relatório Markdown

### 5. Migrar para Supabase

```bash
# Migrar dados para Supabase
npm run migrate:to-supabase

# Ou diretamente
ts-node scripts/migracao/migrate_to_supabase.ts
```

**Saída**:
- `scripts/migracao/logs/migration_{timestamp}.json` - Logs detalhados

### 6. Rollback (se necessário)

```bash
# Fazer rollback da migração
npm run migrate:rollback -- --confirm

# Ou diretamente
ts-node scripts/migracao/rollback_migration.ts --confirm
```

**ATENÇÃO**: Rollback remove TODOS os dados migrados!

## Fluxo Completo

```bash
# 1. Extrair dados
npm run migrate:extract

# 2. Analisar estrutura
npm run migrate:analyze

# 3. Transformar dados
npm run migrate:transform

# 4. Validar dados
npm run migrate:validate

# 5. Revisar relatório de validação
cat docs/migracao/validacao_relatorio.md

# 6. Fazer backup do Supabase (IMPORTANTE!)

# 7. Migrar para Supabase
npm run migrate:to-supabase

# 8. Validar migração
# (Verificar logs e testar app)
```

## Configuração de Transformação

Editar `transform_config.json` para configurar transformações por tabela:

```json
{
  "nome_tabela": {
    "date_fields": ["campo_data"],
    "decimal_fields": ["campo_valor"],
    "cnpj_fields": ["cnpj"],
    "cpf_fields": ["cpf"],
    "phone_fields": ["telefone"],
    "string_fields": ["nome"],
    "generate_uuid": true
  }
}
```

## Troubleshooting

### Erro: "mdb-tools não encontrado"

```bash
# Instalar mdb-tools
brew install mdb-tools  # macOS
# ou
sudo apt-get install mdb-tools  # Linux
```

### Erro: "SUPABASE_URL não definido"

Verificar arquivo `.env.local` na raiz do projeto.

### Erro: "RLS bloqueando inserção"

Verificar se está usando `SERVICE_ROLE_KEY` (não a chave pública).

### Erro: "Foreign key não encontrada"

Verificar se tabelas base foram migradas antes das dependentes. Verificar ordem de migração em `migrate_to_supabase.ts`.

## Logs

Todos os logs são salvos em `scripts/migracao/logs/`:

- `migration_{timestamp}.json` - Logs detalhados da migração
- Logs incluem: timestamp, nível, mensagem e dados relacionados

## Segurança

- **Dados Sensíveis**: Diretório `docs/migracao/dados_extraidos/` está no `.gitignore`
- **Service Role Key**: Nunca commitar `.env.local` com service role key
- **Backup**: Sempre fazer backup do Supabase antes da migração

## Suporte

Para problemas ou dúvidas, consultar:
- `docs/migracao/README.md` - Documentação geral
- `docs/migracao/mapeamento_tabelas.md` - Mapeamento detalhado
- `docs/migracao/estrutura_access.md` - Estrutura dos bancos Access

