#!/usr/bin/env node

/**
 * Script para atualizar senhas dos usuários super admins
 * 
 * Uso:
 *   export SUPABASE_SERVICE_ROLE_KEY="sua-service-role-key"
 *   node scripts/update_passwords.js
 */

const SUPABASE_URL = 'https://zhsucbowsxfwmsrdvhre.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ Configure SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Obtenha em: https://app.supabase.com/project/zhsucbowsxfwmsrdvhre/settings/api');
  process.exit(1);
}

function parsePasswordUpdatesFromEnv() {
  const raw = process.env.SUPER_ADMIN_PASSWORD_UPDATES_JSON;
  if (!raw) {
    console.error('❌ Configure SUPER_ADMIN_PASSWORD_UPDATES_JSON para executar este script.');
    console.error(
      "   Exemplo: export SUPER_ADMIN_PASSWORD_UPDATES_JSON='[{\"email\":\"admin@example.com\",\"password\":\"<nova-senha-forte>\"}]'"
    );
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('❌ SUPER_ADMIN_PASSWORD_UPDATES_JSON inválido:', error.message);
    process.exit(1);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error('❌ SUPER_ADMIN_PASSWORD_UPDATES_JSON precisa conter ao menos um item.');
    process.exit(1);
  }

  const invalid = parsed.find((item) => !item?.email || !item?.password);
  if (invalid) {
    console.error('❌ Cada item deve conter email e password.');
    process.exit(1);
  }

  return parsed;
}

const users = parsePasswordUpdatesFromEnv();

async function updatePassword(email, newPassword) {
  console.log(`\n🔐 Atualizando senha para: ${email}`);
  
  try {
    // Primeiro, buscar o ID do usuário
    const listResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY
      }
    });

    if (!listResponse.ok) {
      const error = await listResponse.text();
      console.error(`   ❌ Erro ao buscar usuário: ${error}`);
      return false;
    }

    const { users: userList } = await listResponse.json();
    if (!userList || userList.length === 0) {
      console.error(`   ❌ Usuário não encontrado`);
      return false;
    }

    const userId = userList[0].id;
    console.log(`   📋 Usuário encontrado: ${userId}`);

    // Atualizar senha
    const updateResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY
      },
      body: JSON.stringify({
        password: newPassword
      })
    });

    if (!updateResponse.ok) {
      const error = await updateResponse.text();
      console.error(`   ❌ Erro ao atualizar senha: ${error}`);
      return false;
    }

    const data = await updateResponse.json();
    console.log(`   ✅ Senha atualizada com sucesso!`);
    return true;

  } catch (error) {
    console.error(`   ❌ Erro: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Atualizando senhas dos usuários super admins...\n');
  console.log('─'.repeat(60));

  let successCount = 0;
  for (const user of users) {
    const success = await updatePassword(user.email, user.password);
    if (success) successCount++;
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n✅ Processo concluído: ${successCount}/${users.length} senhas atualizadas`);
  
  if (successCount === users.length) {
    console.log('\n🎉 Todas as senhas foram atualizadas com sucesso!');
  }
}

main().catch(console.error);

























