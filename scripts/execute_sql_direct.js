#!/usr/bin/env node

/**
 * Executa SQL diretamente no Supabase usando Management API
 * Requer: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sqlPath = join(__dirname, '..', 'supabase', 'migrations', '20251201164747_clear_all_data_again.sql');
const sql = readFileSync(sqlPath, 'utf-8');

// Executar via Management API
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) {
  console.error('❌ Não foi possível extrair o project_ref da URL');
  process.exit(1);
}

const managementApiUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

console.log('🚀 Executando limpeza completa de dados...\n');
console.log('⚠️  ATENÇÃO: Esta operação é IRREVERSÍVEL!\n');

try {
  const response = await fetch(managementApiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: sql
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('❌ Erro ao executar SQL:', error);
    console.log('\n💡 Alternativa: Execute via Supabase Dashboard (SQL Editor)');
    process.exit(1);
  }

  const result = await response.json();
  console.log('✅ Limpeza executada com sucesso!');
  console.log('📊 Resultado:', result);
  
} catch (error) {
  console.error('❌ Erro:', error.message);
  console.log('\n💡 Execute via Supabase Dashboard:');
  console.log('   1. Acesse: https://app.supabase.com');
  console.log('   2. Vá em SQL Editor');
  console.log(`   3. Cole o conteúdo de: ${sqlPath}`);
  console.log('   4. Clique em "Run"');
}



