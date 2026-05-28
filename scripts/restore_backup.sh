#!/bin/bash

# Script para restaurar backup do Supabase
# Execute: bash scripts/restore_backup.sh

set -e

PROJECT_REF="zhsucbowsxfwmsrdvhre"
BACKUP_DIR="./backups"

echo "🔄 Script de Restauração de Backup do Supabase"
echo "================================================"
echo ""

# Verificar se o Supabase CLI está instalado
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI não está instalado."
    echo "   Instale em: https://supabase.com/docs/guides/cli/getting-started"
    exit 1
fi

echo "📋 Instruções para restaurar backup:"
echo ""
echo "1. Acesse o Dashboard do Supabase:"
echo "   https://app.supabase.com/project/${PROJECT_REF}/settings/database/backups"
echo ""
echo "2. Selecione o backup mais recente ANTES da limpeza (hoje ou ontem)"
echo ""
echo "3. Clique em 'Restore' ou 'Download'"
echo ""
echo "4. Se baixar o backup:"
echo "   - Baixe o arquivo .sql"
echo "   - Execute: psql <backup_file.sql>"
echo ""

# Tentar listar backups via API (se possível)
echo "🔍 Tentando verificar backups disponíveis..."
echo ""

# Verificar se está logado
if supabase projects list &> /dev/null; then
    echo "✅ Conectado ao Supabase"
    echo ""
    echo "⚠️  Nota: O Supabase CLI não tem comando direto para listar/restaurar backups."
    echo "   Você precisa usar o Dashboard web para restaurar."
    echo ""
else
    echo "⚠️  Não está logado no Supabase CLI"
    echo "   Execute: supabase login"
    echo ""
fi

echo "📝 Alternativa: Restaurar via Dashboard"
echo "========================================"
echo ""
echo "1. Acesse: https://app.supabase.com/project/${PROJECT_REF}/settings/database/backups"
echo "2. Selecione o backup desejado"
echo "3. Clique em 'Restore'"
echo ""
echo "Os backups automáticos do Supabase são mantidos por 30 dias."
echo ""

