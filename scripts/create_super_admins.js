#!/usr/bin/env node

/**
 * Script para criar usuários super admins no Supabase
 * 
 * Uso:
 *   export SUPABASE_URL="https://zhsucbowsxfwmsrdvhre.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="sua-service-role-key"
 *   node scripts/create_super_admins.js
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://zhsucbowsxfwmsrdvhre.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('❌ Configure SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Obtenha em: https://app.supabase.com/project/zhsucbowsxfwmsrdvhre/settings/api');
  process.exit(1);
}

// Criar cliente com Service Role Key (permite criar usuários)
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

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
    console.error('❌ SUPER_ADMINS_JSON precisa conter um array com ao menos um usuário.');
    process.exit(1);
  }

  const hasInvalid = parsed.some((item) => !item?.email || !item?.password || !item?.nome);
  if (hasInvalid) {
    console.error('❌ Cada item de SUPER_ADMINS_JSON deve conter email, password e nome.');
    process.exit(1);
  }

  return parsed;
}

const users = parseUsersFromEnv();

async function createSuperAdmin(user) {
  console.log(`\n🔐 Criando usuário: ${user.email}`);
  
  try {
    // Criar usuário via Auth API
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true, // Confirmar email automaticamente
      user_metadata: {
        nome: user.nome
      }
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        console.log(`   ⚠️  Usuário já existe, atualizando perfil...`);
        // Buscar usuário existente
        const { data: existingUser } = await supabase.auth.admin.listUsers();
        const foundUser = existingUser?.users?.find(u => u.email === user.email);
        
        if (foundUser) {
          // Promover a super admin via função SQL
          const { error: promoteError } = await supabase.rpc('promote_to_super_admin', {
            p_email: user.email,
            p_nome: user.nome
          });
          
          if (promoteError) {
            console.error(`   ❌ Erro ao promover: ${promoteError.message}`);
            return false;
          }
          
          console.log(`   ✅ Usuário promovido a super admin`);
          return true;
        }
      } else {
        console.error(`   ❌ Erro ao criar usuário: ${authError.message}`);
        return false;
      }
    }

    if (!authData?.user) {
      console.error(`   ❌ Usuário não foi criado`);
      return false;
    }

    console.log(`   ✅ Usuário criado: ${authData.user.id}`);

    // Promover a super admin via função SQL
    const { error: promoteError } = await supabase.rpc('promote_to_super_admin', {
      p_email: user.email,
      p_nome: user.nome
    });

    if (promoteError) {
      console.error(`   ❌ Erro ao promover a super admin: ${promoteError.message}`);
      // Tentar criar perfil manualmente
      const { data: empresa } = await supabase
        .from('empresas')
        .select('id')
        .limit(1)
        .single();

      if (empresa) {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: authData.user.id,
            empresa_id: empresa.id,
            email: user.email,
            nome: user.nome,
            perfil: 'Admin',
            is_super_admin: true
          }, {
            onConflict: 'id'
          });

        if (profileError) {
          console.error(`   ❌ Erro ao criar perfil: ${profileError.message}`);
          return false;
        }
      }
    }

    console.log(`   ✅ Super admin criado com sucesso!`);
    return true;

  } catch (error) {
    console.error(`   ❌ Erro: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Criando usuários super admins...\n');
  console.log('─'.repeat(60));

  let successCount = 0;
  for (const user of users) {
    const success = await createSuperAdmin(user);
    if (success) successCount++;
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n✅ Processo concluído: ${successCount}/${users.length} usuários criados`);
  
  if (successCount === users.length) {
    console.log('\n🎉 Todos os usuários super admins foram criados com sucesso!');
  } else {
    console.log('\n⚠️  Alguns usuários não foram criados. Verifique os erros acima.');
  }
}

main().catch(console.error);

























