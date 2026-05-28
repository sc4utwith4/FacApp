#!/usr/bin/env node

/**
 * Script para listar e restaurar backups do Supabase via Management API
 * Requer: SUPABASE_ACCESS_TOKEN (obter em https://app.supabase.com/account/tokens)
 */

import fetch from 'node-fetch';

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
    const response = await fetch(
      `${MANAGEMENT_API_BASE}/projects/${PROJECT_REF}/database/backups/${backupId}/restore`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erro ao restaurar backup:', error);
      return false;
    }

    const result = await response.json();
    console.log('✅ Backup restaurado com sucesso!');
    return true;
  } catch (error) {
    console.error('❌ Erro:', error.message);
    return false;
  }
}

async function main() {
  const backups = await listBackups();
  
  if (!backups || backups.length === 0) {
    console.log('⚠️  Nenhum backup encontrado ou erro ao listar.');
    console.log('\n💡 Alternativa: Acesse o Dashboard:');
    console.log(`   https://app.supabase.com/project/${PROJECT_REF}/settings/database/backups`);
    return;
  }

  console.log('📋 Backups disponíveis:');
  console.log('─'.repeat(60));
  
  backups.forEach((backup, index) => {
    const date = new Date(backup.created_at);
    console.log(`${index + 1}. ${backup.id}`);
    console.log(`   Data: ${date.toLocaleString('pt-BR')}`);
    console.log(`   Tamanho: ${(backup.size / 1024 / 1024).toFixed(2)} MB`);
    console.log('');
  });

  // Tentar restaurar o backup mais recente antes da limpeza
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const recentBackup = backups.find(backup => {
    const backupDate = new Date(backup.created_at);
    return backupDate < today; // Backup de antes de hoje
  }) || backups[0]; // Se não encontrar, usar o mais recente

  if (recentBackup) {
    console.log(`\n🔄 Tentando restaurar backup mais recente: ${recentBackup.id}`);
    const success = await restoreBackup(recentBackup.id);
    
    if (success) {
      console.log('\n✅ Restauração concluída!');
    } else {
      console.log('\n⚠️  Não foi possível restaurar automaticamente.');
      console.log('   Tente restaurar via Dashboard.');
    }
  }
}

main();

