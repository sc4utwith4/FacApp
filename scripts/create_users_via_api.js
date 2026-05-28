#!/usr/bin/env node

/**
 * Script para criar usuários super admins via Supabase Auth API
 * Usa as credenciais do projeto configurado
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zhsucbowsxfwmsrdvhre.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

// Para criar usuários, precisamos do Service Role Key
// Mas vamos tentar usar a API Admin Auth
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseUsersFromEnv() {
  const raw = process.env.SUPER_ADMINS_JSON;
  if (!raw) {
    console.error('❌ Configure SUPER_ADMINS_JSON para executar este script.');
    console.error(
      "   Exemplo: export SUPER_ADMINS_JSON='[{\"email\":\"admin@example.com\",\"password\":\"<senha-forte>\",\"nome\":\"Admin\"}]'"
    );
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('❌ SUPER_ADMINS_JSON inválido:', error.message);
    process.exit(1);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error('❌ SUPER_ADMINS_JSON precisa conter ao menos um usuário.');
    process.exit(1);
  }

  const invalid = parsed.find((item) => !item?.email || !item?.password || !item?.nome);
  if (invalid) {
    console.error('❌ Cada item de SUPER_ADMINS_JSON deve conter email, password e nome.');
    process.exit(1);
  }

  return parsed;
}

const users = parseUsersFromEnv();

async function createUserViaAPI(user) {
  console.log(`\n🔐 Criando usuário: ${user.email}`);
  
  if (!SERVICE_ROLE_KEY) {
    console.error('   ❌ SERVICE_ROLE_KEY não configurada');
    console.error('   Obtenha em: https://app.supabase.com/project/zhsucbowsxfwmsrdvhre/settings/api');
    return false;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY
      },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: {
          nome: user.nome
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`   ❌ Erro: ${response.status} - ${error}`);
      return false;
    }

    const data = await response.json();
    console.log(`   ✅ Usuário criado: ${data.user.id}`);
    return data.user.id;

  } catch (error) {
    console.error(`   ❌ Erro: ${error.message}`);
    return false;
  }
}

async function promoteToSuperAdmin(email, nome) {
  console.log(`\n👑 Promovendo ${email} a super admin...`);
  
  try {
    if (!SUPABASE_ANON_KEY) {
      console.error('   ❌ SUPABASE_ANON_KEY/VITE_SUPABASE_PUBLISHABLE_KEY não configurada');
      return false;
    }

    // Usar a função RPC do Supabase
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/promote_to_super_admin`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        p_email: email,
        p_nome: nome
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`   ❌ Erro ao promover: ${error}`);
      return false;
    }

    console.log(`   ✅ Promovido a super admin!`);
    return true;

  } catch (error) {
    console.error(`   ❌ Erro: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Criando usuários super admins via API...\n');
  console.log('─'.repeat(60));

  if (!SERVICE_ROLE_KEY) {
    console.error('\n❌ SERVICE_ROLE_KEY não configurada!');
    console.error('\nPara criar usuários via API, você precisa:');
    console.error('1. Obter Service Role Key em: https://app.supabase.com/project/zhsucbowsxfwmsrdvhre/settings/api');
    console.error('2. Executar: export SUPABASE_SERVICE_ROLE_KEY="sua-key"');
    console.error('3. Executar: export SUPABASE_ANON_KEY="sua-anon-key" (ou VITE_SUPABASE_PUBLISHABLE_KEY)');
    console.error('4. Executar este script novamente\n');
    process.exit(1);
  }

  let successCount = 0;
  for (const user of users) {
    const userId = await createUserViaAPI(user);
    if (userId) {
      const promoted = await promoteToSuperAdmin(user.email, user.nome);
      if (promoted) successCount++;
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n✅ Processo concluído: ${successCount}/${users.length} usuários criados`);
}

main().catch(console.error);
























