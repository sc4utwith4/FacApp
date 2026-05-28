#!/usr/bin/env node

/**
 * Script para listar e restaurar backups do Supabase via Management API
 * 
 * Uso:
 *   export SUPABASE_ACCESS_TOKEN="seu-token"
 *   node scripts/restore_backup_management_api.js
 * 
 * Obter token em: https://app.supabase.com/account/tokens
 */

const PROJECT_REF = 'zhsucbowsxfwmsrdvhre';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ Configure SUPABASE_ACCESS_TOKEN');
  console.error('   Obtenha em: https://app.supabase.com/account/tokens');
  process.exit(1);
}

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';

async function listBackups() {
  console.log('🔍 Listando backups disponíveis...\n');
  
  try {
    const response = await fetch(
      `${MANAGEMENT_API_BASE}/projects/${PROJECT_REF}/database/backups`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erro ao listar backups:', error);
      console.error(`   Status: ${response.status}`);
      return null;
    }

    const backups = await response.json();
    return backups;
  } catch (error) {
    console.error('❌ Erro:', error.message);
    return null;
  }
}

async function restoreBackup(backupId) {
  console.log(`🔄 Restaurando backup ${backupId}...\n`);
  
  try {
    // Para backups lógicos (daily backups), a restauração é feita via Dashboard
    // Para PITR, usar o endpoint restore-pitr
    console.log('⚠️  Backups lógicos precisam ser restaurados via Dashboard');
    console.log(`   Acesse: https://app.supabase.com/project/${PROJECT_REF}/settings/database/backups`);
    return false;
  } catch (error) {
    console.error('❌ Erro:', error.message);
    return false;
  }
}

async function main() {
  console.log('🔄 Script de Restauração de Backup via Management API\n');
  console.log('─'.repeat(60));
  
  const backups = await listBackups();
  
  if (!backups) {
    console.log('\n⚠️  Não foi possível listar backups.');
    console.log('   Verifique se o ACCESS_TOKEN está correto.');
    console.log('   Obtenha em: https://app.supabase.com/account/tokens');
    return;
  }

  if (backups.length === 0) {
    console.log('⚠️  Nenhum backup encontrado.');
    return;
  }

  console.log('\n📋 Backups disponíveis:');
  console.log('─'.repeat(60));
  
  backups.forEach((backup, index) => {
    const date = new Date(backup.created_at || backup.start_time);
    console.log(`${index + 1}. ${backup.id || 'N/A'}`);
    console.log(`   Data: ${date.toLocaleString('pt-BR')}`);
    if (backup.size) {
      console.log(`   Tamanho: ${(backup.size / 1024 / 1024).toFixed(2)} MB`);
    }
    console.log('');
  });

  // Para backups lógicos, a restauração deve ser feita via Dashboard
  console.log('\n💡 Para restaurar:');
  console.log(`   1. Acesse: https://app.supabase.com/project/${PROJECT_REF}/settings/database/backups`);
  console.log('   2. Selecione o backup desejado');
  console.log('   3. Clique em "Restore"');
  console.log('\n   Backups lógicos não podem ser restaurados via API, apenas via Dashboard.');
}

main().catch(console.error);

