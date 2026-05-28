#!/usr/bin/env node

/**
 * Script para executar a limpeza completa de dados do Supabase
 * 
 * Uso:
 *   node scripts/execute_clear_data.js
 * 
 * Requer variáveis de ambiente:
 *   SUPABASE_URL - URL do projeto Supabase
 *   SUPABASE_SERVICE_ROLE_KEY - Service Role Key (com permissões administrativas)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carregar variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Erro: Variáveis de ambiente não configuradas!');
  console.error('\nConfigure as seguintes variáveis:');
  console.error('  SUPABASE_URL=https://seu-projeto.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key');
  console.error('\nOu execute via Supabase Dashboard (SQL Editor)');
  process.exit(1);
}

// Criar cliente Supabase com Service Role Key (permite executar SQL)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function executeClearData() {
  console.log('🚀 Iniciando limpeza completa de dados do Supabase...\n');

  try {
    // Ler o arquivo SQL da migração
    const sqlPath = join(__dirname, '..', 'supabase', 'migrations', '20251201164747_clear_all_data_again.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('📄 Arquivo SQL carregado');
    console.log('⚠️  ATENÇÃO: Esta operação é IRREVERSÍVEL!\n');

    // Executar SQL via RPC (se houver função) ou via Management API
    // Como o Supabase não expõe execução direta de SQL via client,
    // vamos usar a abordagem de executar via psql ou Management API
    
    console.log('💡 Para executar via script, você precisa:');
    console.log('   1. Usar o Supabase CLI: supabase db push');
    console.log('   2. Ou executar via Dashboard (SQL Editor)');
    console.log('   3. Ou usar psql diretamente\n');

    console.log('📋 SQL para executar:');
    console.log('─'.repeat(60));
    console.log(sql.substring(0, 500) + '...\n');
    console.log('─'.repeat(60));

    console.log('\n✅ Para executar a limpeza:');
    console.log('   1. Acesse: https://app.supabase.com');
    console.log('   2. Vá em SQL Editor');
    console.log('   3. Cole o conteúdo do arquivo:');
    console.log(`      ${sqlPath}`);
    console.log('   4. Clique em "Run"\n');

  } catch (error) {
    console.error('❌ Erro ao executar limpeza:', error.message);
    process.exit(1);
  }
}

// Executar
executeClearData();



